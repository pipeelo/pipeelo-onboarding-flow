import type { SupabaseClient } from '@supabase/supabase-js';
import { UPLOAD_BUCKET } from '../schemas/upload';
import type { Cadastro, UploadMeta } from '../schemas/cadastro';
import { fetchCnpj } from '../brasilapi';
import { extrairDocumentos, type ArquivoEntrada, type Extracao } from './extracao';
import { montarCampos, type EnderecoCnpj, type SessaoContrato } from './campos';
import { CamposFaltando, renderDocx } from './template';

/**
 * Orquestra a geração do contrato de uma sessão: baixa os documentos, lê com a
 * OpenAI, monta os campos e grava o `.docx` no bucket `onboarding-contratos`.
 *
 * Nunca lança — falha vira `pendente` com motivo, gravado em `contrato_erro`
 * para o `/admin` mostrar e permitir reprocessar.
 */

export const CONTRATO_BUCKET = 'onboarding-contratos';

export type ResultadoContrato =
  | { status: 'gerado'; path: string; representante: string; avisos: string[] }
  | { status: 'pendente'; motivo: string; faltando: string[] };

const MIMES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

function mimeDe(nome: string): string {
  const ext = (nome.split('.').pop() || '').toLowerCase();
  return MIMES[ext] || 'application/pdf';
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Remove acentos, pontuação e espaços — para usar em nome de arquivo. */
/** Combining diacritical marks — removidos após `normalize('NFD')`. */
const RE_ACENTOS = /[̀-ͯ]/g;

function slugArquivo(s: string): string {
  return (s || 'Cliente')
    .normalize('NFD')
    .replace(RE_ACENTOS, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'Cliente';
}

function normalizarNome(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(RE_ACENTOS, '')
    .toUpperCase()
    .replace(/\b(LTDA|ME|EPP|EIRELI|S\/?A|SA)\b/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

async function patch(supabase: SupabaseClient, id: string, data: Record<string, unknown>) {
  const { error } = await supabase.from('onboarding_sessions').update(data).eq('id', id);
  if (error) console.error('[contrato] update falhou:', error.message);
}

async function baixarUploads(
  supabase: SupabaseClient,
  metas: UploadMeta[],
): Promise<{ arquivos: ArquivoEntrada[]; erros: string[] }> {
  const arquivos: ArquivoEntrada[] = [];
  const erros: string[] = [];
  for (const m of metas) {
    try {
      const { data, error } = await supabase.storage.from(UPLOAD_BUCKET).download(m.path);
      if (error || !data) throw new Error(error?.message || 'download_vazio');
      const bytes = Buffer.from(await data.arrayBuffer());
      if (!bytes.length) throw new Error('arquivo_vazio');
      arquivos.push({ nome: m.nome_original, mime: mimeDe(m.nome_original), bytes });
    } catch (e) {
      erros.push(`${m.nome_original}: ${msg(e)}`);
    }
  }
  return { arquivos, erros };
}

/** Município/UF do CNPJ pela BrasilAPI. Falha de rede é tolerada (devolve null). */
async function municipioDoCnpj(cnpj: string): Promise<EnderecoCnpj | null> {
  try {
    const d = (await fetchCnpj(cnpj)) as Record<string, unknown>;
    const municipio = String(d?.municipio || d?.nome_municipio || '').trim();
    const uf = String(d?.uf || '').trim();
    return municipio ? { municipio, uf } : null;
  } catch (e) {
    console.warn('[contrato] BrasilAPI indisponível:', msg(e));
    return null;
  }
}

function divergencias(extracao: Extracao, cadastro: Cadastro): string[] {
  const avisos: string[] = [];
  const cnpjDoc = (extracao.cnpj || '').replace(/\D/g, '');
  const cnpjCad = (cadastro.cnpj || '').replace(/\D/g, '');
  if (cnpjDoc && cnpjCad && cnpjDoc !== cnpjCad) {
    avisos.push(`CNPJ do documento (${cnpjDoc}) diverge do cadastro (${cnpjCad}).`);
  }
  const rsDoc = normalizarNome(extracao.razao_social);
  const rsCad = normalizarNome(cadastro.razao_social);
  if (rsDoc && rsCad && rsDoc !== rsCad) {
    avisos.push(`Razão social do documento ("${extracao.razao_social}") diverge do cadastro ("${cadastro.razao_social}").`);
  }
  return avisos;
}

export async function gerarContratoParaSessao(
  supabase: SupabaseClient,
  sessao: SessaoContrato,
  cadastro: Cadastro,
): Promise<ResultadoContrato> {
  const pendente = async (motivo: string, faltando: string[], extracao?: Extracao): Promise<ResultadoContrato> => {
    await patch(supabase, sessao.id, {
      contrato_erro: motivo,
      ...(extracao ? { contrato_extracao: extracao } : {}),
    });
    return { status: 'pendente', motivo, faltando };
  };

  try {
    // 1. Documentos do cadastro.
    const metas = [...(cadastro.doc_contrato_social || []), ...(cadastro.doc_responsaveis || [])];
    if (!metas.length) return pendente('Nenhum documento enviado no cadastro.', []);

    const { arquivos, erros } = await baixarUploads(supabase, metas);
    if (!arquivos.length) {
      return pendente(`Não foi possível baixar os documentos: ${erros.join('; ') || 'bucket vazio'}`, []);
    }

    // 2. Leitura pela OpenAI.
    let extracao: Extracao;
    try {
      extracao = await extrairDocumentos(arquivos);
    } catch (e) {
      return pendente(`Falha ao ler os documentos com a IA: ${msg(e)}`, []);
    }

    const avisos = divergencias(extracao, cadastro);
    if (erros.length) avisos.push(`Documentos não lidos: ${erros.join('; ')}`);
    if (extracao.confianca !== 'alta') avisos.push(`Confiança da leitura: ${extracao.confianca} — conferir os dados do representante.`);
    if (sessao.contratou_crm) avisos.push('Cliente contratou CRM — revisar cláusula CRM (ainda não está no template).');

    // 3. Representante indefinido → não gera, pergunta no Staff (decisão 2).
    if (!extracao.representante) {
      const motivo = extracao.motivo_ambiguidade
        || 'Não foi possível identificar quem assina pelo CONTRATANTE nos documentos enviados.';
      return pendente(motivo, ['CONTRATANTE_REPRESENTANTE'], extracao);
    }

    // 4. Município do CNPJ (cidade de assinatura).
    const endereco = await municipioDoCnpj(cadastro.cnpj);

    // 5. Campos.
    const { campos, faltando } = montarCampos(sessao, cadastro, extracao, endereco);
    if (faltando.length) {
      return pendente(`Campos sem valor para o contrato: ${faltando.join(', ')}.`, faltando, extracao);
    }

    // 6. Render.
    let buffer: Buffer;
    try {
      buffer = await renderDocx(campos, { crm: Boolean(sessao.contratou_crm) });
    } catch (e) {
      if (e instanceof CamposFaltando) {
        return pendente(`Campos sem valor para o contrato: ${e.faltando.join(', ')}.`, e.faltando, extracao);
      }
      return pendente(`Falha ao montar o .docx: ${msg(e)}`, [], extracao);
    }

    // 7. Upload.
    const agora = new Date();
    const mmaaaa = `${String(agora.getMonth() + 1).padStart(2, '0')}${agora.getFullYear()}`;
    const nome = `Contrato_Pipeelo_${slugArquivo(cadastro.nome_fantasia)}_${mmaaaa}.docx`;
    const caminho = `${sessao.id}/${nome}`;

    const { error: upErr } = await supabase.storage.from(CONTRATO_BUCKET).upload(caminho, buffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true,
    });
    if (upErr) return pendente(`Falha ao salvar o contrato no storage: ${upErr.message}`, [], extracao);

    // 8. Sessão.
    await patch(supabase, sessao.id, {
      contrato_path: caminho,
      contrato_gerado_at: agora.toISOString(),
      contrato_extracao: extracao,
      contrato_erro: null,
    });

    return { status: 'gerado', path: caminho, representante: extracao.representante.nome, avisos };
  } catch (e) {
    // Rede de segurança: gerarContratoParaSessao nunca lança.
    const motivo = `Erro inesperado ao gerar o contrato: ${msg(e)}`;
    console.error('[contrato]', motivo);
    try {
      await patch(supabase, sessao.id, { contrato_erro: motivo });
    } catch { /* ignora */ }
    return { status: 'pendente', motivo, faltando: [] };
  }
}
