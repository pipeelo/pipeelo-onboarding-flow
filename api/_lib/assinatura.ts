import type { SupabaseClient } from '@supabase/supabase-js';
import type { Cadastro } from './schemas/cadastro';
import { CONTRATO_BUCKET } from './contrato';
import {
  AssinaPdfConfigError, ESTADO, anexarPdf, baixarArquivo, consultarSolicitacao, criarSolicitacao,
  documentosAssinados, documentosDosAssinantes, escolherAssinado, getAssinaPdfConfig, obterLinkInicial,
  pedirCorrecao as pedirCorrecaoApi, validarSolicitacao, type AssinaPdfConfig, type PedidoCorrecao, type SignerDocs,
} from './assinapdf';
import { sendText, toJid } from './evolution';
import { notifyStaff } from './staff-notify';

/**
 * Assinatura do contrato pela AssinaPDF (design 2026-09-02-assinatura-assinapdf).
 *
 * `enviarParaAssinatura` nunca lança: falha vira `assinatura_status='erro'` com o
 * motivo em `assinatura_erro`, e o `/admin` reprocessa. `consultarAssinatura` é o
 * polling; `aprovarAssinatura` / `pedirCorrecao` são as ações do painel.
 */

export type StatusAssinatura = 'pendente' | 'enviado' | 'aguardando_validacao' | 'correcao' | 'finalizado' | 'erro';

export type SessaoAssinatura = {
  id: string;
  slug?: string | null;
  contrato_pdf_path?: string | null;
  contrato_extracao?: { endereco_sede?: string | null; representante?: { nome?: string | null; cpf?: string | null } | null } | null;
  assinapdf_solicitacao_id?: number | null;
  assinapdf_link?: string | null;
  assinatura_status?: string | null;
  assinatura_erro?: string | null;
  grupo_jid?: string | null;
};

export type ResultadoAssinatura =
  | { status: 'enviado'; solicitacao_id: number; link: string; dm: boolean; grupo: boolean; reenvio: boolean }
  | { status: 'pendente'; motivo: string };

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function patch(supabase: SupabaseClient, id: string, data: Record<string, unknown>) {
  const { error } = await supabase.from('onboarding_sessions').update(data).eq('id', id);
  if (error) console.error('[assinatura] update falhou:', error.message);
}

function primeiroNome(nome: string): string {
  return (nome || '').trim().split(/\s+/)[0] || '';
}

export function mensagemLinkResponsavel(cadastro: Cadastro, representante: string, link: string): string {
  const quem = primeiroNome(cadastro.responsavel_nome);
  return [
    `Olá${quem ? `, ${quem}` : ''}! Aqui é a Pipeelo. 👋`,
    '',
    `O contrato de prestação de serviços da ${cadastro.nome_fantasia} está pronto para assinatura digital.`,
    `Quem assina pela empresa é *${representante}* (representante legal no contrato social).`,
    '',
    `Link para assinar: ${link}`,
    '',
    'Na hora de assinar, a plataforma pede uma selfie e uma foto do documento de identificação. Leva uns 3 minutos.',
    'Qualquer dúvida é só responder aqui.',
  ].join('\n');
}

export function mensagemLinkGrupo(cadastro: Cadastro, representante: string, link: string): string {
  return [
    `📄 *Contrato para assinatura*`,
    '',
    `O contrato da ${cadastro.nome_fantasia} está pronto. Assina *${representante}*.`,
    `Link: ${link}`,
    '',
    `A plataforma pede selfie + documento de identificação na hora de assinar.`,
  ].join('\n');
}

async function grupoJidAtual(supabase: SupabaseClient, sessao: SessaoAssinatura): Promise<string | null> {
  if (sessao.grupo_jid) return sessao.grupo_jid;
  // O pós-cadastro recebe a sessão de ANTES do grupo existir; relê.
  const { data } = await supabase
    .from('onboarding_sessions')
    .select('grupo_jid')
    .eq('id', sessao.id)
    .maybeSingle<{ grupo_jid: string | null }>();
  return data?.grupo_jid ?? null;
}

async function enviarMensagens(
  supabase: SupabaseClient,
  sessao: SessaoAssinatura,
  cadastro: Cadastro,
  representante: string,
  link: string,
): Promise<{ dm: boolean; grupo: boolean; erros: string[] }> {
  const erros: string[] = [];
  let dm = false;
  let grupo = false;
  try {
    await sendText(toJid(cadastro.responsavel_whatsapp), mensagemLinkResponsavel(cadastro, representante, link));
    dm = true;
  } catch (e) {
    erros.push(`DM ao responsável: ${msg(e)}`);
  }
  const jid = await grupoJidAtual(supabase, sessao);
  if (jid) {
    try {
      await sendText(jid, mensagemLinkGrupo(cadastro, representante, link));
      grupo = true;
    } catch (e) {
      erros.push(`grupo: ${msg(e)}`);
    }
  } else {
    erros.push('grupo: sessão sem grupo_jid');
  }
  return { dm, grupo, erros };
}

/**
 * Cria a solicitação na AssinaPDF (uma vez), anexa o PDF, obtém o link e manda
 * as mensagens. Reexecutável: com `assinapdf_solicitacao_id` já salvo, só reenvia.
 */
export async function enviarParaAssinatura(
  supabase: SupabaseClient,
  sessao: SessaoAssinatura,
  cadastro: Cadastro,
  opts: { apenasReenviar?: boolean } = {},
): Promise<ResultadoAssinatura> {
  const pendente = async (motivo: string): Promise<ResultadoAssinatura> => {
    await patch(supabase, sessao.id, { assinatura_status: 'erro', assinatura_erro: motivo });
    return { status: 'pendente', motivo };
  };

  try {
    let cfg: AssinaPdfConfig;
    try {
      cfg = getAssinaPdfConfig();
    } catch (e) {
      if (e instanceof AssinaPdfConfigError) return pendente(e.message);
      throw e;
    }

    const rep = sessao.contrato_extracao?.representante;
    if (!rep?.nome || !rep?.cpf) return pendente('Contrato sem representante identificado (nome e CPF) — gere o contrato primeiro.');
    if (!sessao.contrato_pdf_path) return pendente('Contrato sem PDF gerado — gere o contrato de novo.');

    let solicitacaoId = sessao.assinapdf_solicitacao_id ?? null;
    let link = sessao.assinapdf_link ?? null;
    const reenvio = Boolean(solicitacaoId && link);

    if (!solicitacaoId) {
      const { data: pdf, error } = await supabase.storage.from(CONTRATO_BUCKET).download(sessao.contrato_pdf_path);
      if (error || !pdf) return pendente(`Não consegui baixar o PDF do contrato: ${error?.message ?? 'vazio'}`);
      const bytes = Buffer.from(await pdf.arrayBuffer());

      const criada = await criarSolicitacao(cfg, {
        cpf: rep.cpf,
        nome: rep.nome,
        endereco: sessao.contrato_extracao?.endereco_sede || cadastro.razao_social,
        telefone: cadastro.responsavel_whatsapp,
        email: cadastro.contrato_email,
        plano: cadastro.nome_fantasia,
      });
      solicitacaoId = criada.id;
      await patch(supabase, sessao.id, { assinapdf_solicitacao_id: solicitacaoId, assinapdf_estado: criada.estado });

      const nomeArquivo = sessao.contrato_pdf_path.split('/').pop() || 'contrato.pdf';
      await anexarPdf(cfg, solicitacaoId, bytes, nomeArquivo);
    }

    if (!link || !opts.apenasReenviar) {
      link = await obterLinkInicial(cfg, solicitacaoId, 0);
    }

    const { dm, grupo, erros } = await enviarMensagens(supabase, sessao, cadastro, rep.nome, link);
    const agora = new Date().toISOString();
    await patch(supabase, sessao.id, {
      assinapdf_link: link,
      assinatura_status: 'enviado',
      assinatura_enviada_at: agora,
      assinatura_erro: erros.length ? `Link gerado, mas: ${erros.join('; ')}` : null,
    });
    return { status: 'enviado', solicitacao_id: solicitacaoId, link, dm, grupo, reenvio };
  } catch (e) {
    const motivo = `Falha ao enviar para assinatura: ${msg(e)}`;
    console.error('[assinatura]', motivo);
    return pendente(motivo);
  }
}

// ─── Polling ─────────────────────────────────────────────────

export type MudancaAssinatura =
  | { mudou: false; estado: string }
  | { mudou: true; estado: string; status: StatusAssinatura; assinado_path?: string | null };

async function guardarAssinado(
  supabase: SupabaseClient,
  sessao: SessaoAssinatura,
  cfg: AssinaPdfConfig,
  solicitacaoId: number,
): Promise<string | null> {
  const nomes = await documentosAssinados(cfg, solicitacaoId);
  const nome = escolherAssinado(nomes);
  if (!nome) return null;
  const bytes = await baixarArquivo(cfg, nome);
  const base = (sessao.contrato_pdf_path?.split('/').pop() || 'Contrato.pdf').replace(/\.pdf$/i, '');
  const caminho = `${sessao.id}/${base}_assinado.pdf`;
  const { error } = await supabase.storage.from(CONTRATO_BUCKET).upload(caminho, bytes, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (error) throw new Error(`salvar assinado no storage: ${error.message}`);
  return caminho;
}

/**
 * Consulta o estado na AssinaPDF e atualiza a sessão quando ele muda.
 * Lança em falha de rede/API (quem chama decide se registra ou ignora).
 */
export async function consultarAssinatura(
  supabase: SupabaseClient,
  sessao: SessaoAssinatura,
  opts: { avisarStaff?: boolean; nomeEmpresa?: string } = {},
): Promise<MudancaAssinatura> {
  const cfg = getAssinaPdfConfig();
  const id = sessao.assinapdf_solicitacao_id;
  if (!id) throw new Error('sessão sem assinapdf_solicitacao_id');

  const sol = await consultarSolicitacao(cfg, id);
  const agora = new Date().toISOString();
  const estadoAnterior = (sessao as { assinapdf_estado?: string | null }).assinapdf_estado ?? null;
  const base = (process.env.PUBLIC_BASE_URL ?? 'https://onboarding.pipeelo.com').replace(/\/+$/, '');
  const empresa = opts.nomeEmpresa || sessao.slug || sessao.id;

  if (sol.estado === ESTADO.FINALIZADA && sessao.assinatura_status !== 'finalizado') {
    let assinadoPath: string | null = null;
    let erro: string | null = null;
    try {
      assinadoPath = await guardarAssinado(supabase, sessao, cfg, id);
    } catch (e) {
      erro = `Contrato finalizado, mas não consegui guardar o PDF assinado: ${msg(e)}`;
    }
    await patch(supabase, sessao.id, {
      assinapdf_estado: sol.estado,
      assinatura_status: 'finalizado',
      assinatura_finalizada_at: agora,
      assinatura_consultada_at: agora,
      contrato_assinado_path: assinadoPath,
      assinatura_erro: erro,
    });
    if (opts.avisarStaff !== false) {
      await notifyStaff(
        `✅ Contrato de ${empresa} assinado e finalizado na AssinaPDF.` +
        (assinadoPath ? ` PDF assinado disponível no painel: ${base}/admin` : ` ⚠️ ${erro}`),
      );
    }
    return { mudou: true, estado: sol.estado, status: 'finalizado', assinado_path: assinadoPath };
  }

  if (sol.estado === ESTADO.AGUARDANDO_VALIDACAO && sessao.assinatura_status !== 'aguardando_validacao') {
    await patch(supabase, sessao.id, {
      assinapdf_estado: sol.estado,
      assinatura_status: 'aguardando_validacao',
      assinatura_assinada_at: agora,
      assinatura_consultada_at: agora,
      assinatura_erro: null,
    });
    if (opts.avisarStaff !== false) {
      await notifyStaff(
        `✍️ ${empresa} assinou o contrato. Falta conferir selfie e documento e aprovar: ${base}/admin`,
      );
    }
    return { mudou: true, estado: sol.estado, status: 'aguardando_validacao' };
  }

  // Sem mudança de etapa: só registra a consulta (e o estado cru, se mudou).
  await patch(supabase, sessao.id, {
    assinatura_consultada_at: agora,
    ...(sol.estado !== estadoAnterior ? { assinapdf_estado: sol.estado } : {}),
  });
  return { mudou: false, estado: sol.estado };
}

/** Sessões em andamento; o polling passa por elas. */
export const STATUS_EM_ANDAMENTO: StatusAssinatura[] = ['enviado', 'correcao', 'aguardando_validacao'];

export async function consultarAssinaturasPendentes(
  supabase: SupabaseClient,
): Promise<{ consultadas: number; mudaram: number; erros: string[] }> {
  const { data, error } = await supabase
    .from('onboarding_sessions')
    .select('id, slug, empresa_nome, contrato_pdf_path, contrato_extracao, assinapdf_solicitacao_id, assinapdf_link, assinapdf_estado, assinatura_status, grupo_jid')
    .in('assinatura_status', STATUS_EM_ANDAMENTO)
    .not('assinapdf_solicitacao_id', 'is', null);
  if (error) throw new Error(`listar sessões: ${error.message}`);

  const erros: string[] = [];
  let mudaram = 0;
  for (const s of (data ?? []) as Array<SessaoAssinatura & { empresa_nome?: string | null }>) {
    try {
      const r = await consultarAssinatura(supabase, s, { nomeEmpresa: s.empresa_nome ?? undefined });
      if (r.mudou) mudaram++;
    } catch (e) {
      erros.push(`${s.slug ?? s.id}: ${msg(e)}`);
    }
  }
  return { consultadas: data?.length ?? 0, mudaram, erros };
}

// ─── Ações do /admin ─────────────────────────────────────────

export async function detalhesAssinatura(sessao: SessaoAssinatura): Promise<SignerDocs> {
  const cfg = getAssinaPdfConfig();
  if (!sessao.assinapdf_solicitacao_id) throw new Error('sessão sem solicitação na AssinaPDF');
  return documentosDosAssinantes(cfg, sessao.assinapdf_solicitacao_id);
}

/** Aprova a validação (validate-request), finaliza e guarda o PDF assinado. */
export async function aprovarAssinatura(
  supabase: SupabaseClient,
  sessao: SessaoAssinatura,
  opts: { nomeEmpresa?: string } = {},
): Promise<MudancaAssinatura> {
  const cfg = getAssinaPdfConfig();
  const id = sessao.assinapdf_solicitacao_id;
  if (!id) throw new Error('sessão sem solicitação na AssinaPDF');
  await validarSolicitacao(cfg, id);
  return consultarAssinatura(supabase, sessao, { ...opts, avisarStaff: false });
}

export async function pedirCorrecao(
  supabase: SupabaseClient,
  sessao: SessaoAssinatura,
  cadastro: Cadastro,
  pedido: { motivo: string; itens: string[]; posicao_cli?: number },
): Promise<void> {
  const cfg = getAssinaPdfConfig();
  const id = sessao.assinapdf_solicitacao_id;
  if (!id) throw new Error('sessão sem solicitação na AssinaPDF');
  const signers: PedidoCorrecao[] = [{
    posicao_cli: pedido.posicao_cli ?? 0,
    motivo: pedido.motivo,
    rejected_items: pedido.itens.length ? pedido.itens : ['ass'],
  }];
  await pedirCorrecaoApi(cfg, id, signers);
  await patch(supabase, sessao.id, {
    assinatura_status: 'correcao',
    assinatura_consultada_at: new Date().toISOString(),
    assinatura_erro: null,
  });
  // O WhatsApp da AssinaPDF está desconectado: avisamos nós.
  if (sessao.assinapdf_link) {
    try {
      await sendText(
        toJid(cadastro.responsavel_whatsapp),
        [
          `Olá${primeiroNome(cadastro.responsavel_nome) ? `, ${primeiroNome(cadastro.responsavel_nome)}` : ''}! Aqui é a Pipeelo.`,
          '',
          `Precisamos de um ajuste na assinatura do contrato da ${cadastro.nome_fantasia}: ${pedido.motivo}`,
          `Refaça pelo mesmo link: ${sessao.assinapdf_link}`,
        ].join('\n'),
      );
    } catch (e) {
      console.error('[assinatura] aviso de correção falhou:', e);
    }
  }
}
