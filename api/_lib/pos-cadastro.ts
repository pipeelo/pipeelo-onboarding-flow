import type { SupabaseClient } from '@supabase/supabase-js';
import type { Cadastro } from './schemas/cadastro';
import { gerarContratoParaSessao, type ResultadoContrato } from './contrato';
import type { SessaoContrato } from './contrato/campos';
import { dataCurta, moeda } from './contrato/campos';
import { cobrarContaAzul, type ResultadoCobranca, type SessaoCobranca } from './conta-azul';
import { notifyStaff, notifySocios } from './staff-notify';
import { enviarParaAssinatura, type ResultadoAssinatura, type SessaoAssinatura } from './assinatura';

/**
 * Etapas que rodam depois do grupo de WhatsApp: contrato e cobrança no Conta
 * Azul, nessa ordem, e um único aviso no Staff com os dois blocos (decisão 6 do
 * design). A assinatura do contrato é assunto dos sócios: sai em aviso próprio no
 * grupo deles, nunca no Staff. Cada etapa é isolada — falha em uma não impede a
 * outra nem o aviso.
 *
 * Reexecutável: contrato já gerado sem erro é pulado; cobrança já feita também.
 */

export type SessaoPosCadastro = SessaoContrato &
  SessaoCobranca &
  Omit<SessaoAssinatura, 'id'> & {
    contrato_path?: string | null;
    contrato_erro?: string | null;
    contrato_extracao?: { endereco_sede?: string | null; representante?: { nome?: string | null } | null } | null;
    ca_cliente_id?: string | null;
    ca_implantacao_url?: string | null;
    ca_mensalidade_url?: string | null;
    ca_cobrado_at?: string | null;
  };

export type ResultadoPosCadastro = { contrato: ResultadoContrato; assinatura: ResultadoAssinatura | null; cobranca: ResultadoCobranca };

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** `2026-09-15` → `15/09`. */
function ddmm(v: unknown): string {
  return dataCurta(v).slice(0, 5);
}

function comLink(texto: string, url: string | null | undefined): string {
  return url ? `${texto} (${url})` : texto;
}

export function mensagemStaffPosCadastro(
  nomeFantasia: string,
  sessao: SessaoPosCadastro,
  contrato: ResultadoContrato,
  cobranca: ResultadoCobranca,
): string {
  const base = (process.env.PUBLIC_BASE_URL ?? 'https://onboarding.pipeelo.com').replace(/\/+$/, '');
  const linhas: string[] = [];

  if (contrato.status === 'gerado') {
    const assina = contrato.representante ? ` — assina ${contrato.representante}` : '';
    linhas.push(`📄 Contrato de ${nomeFantasia}: gerado${assina} · baixar no painel`);
  } else {
    const faltam = contrato.faltando.length ? `; faltam: ${contrato.faltando.join(', ')}` : '';
    linhas.push(`📄 Contrato de ${nomeFantasia}: ⚠️ pendente — ${contrato.motivo}${faltam}`);
  }

  const implantacaoNoAviso = (url: string | null) =>
    url
      ? comLink(`implantação ${moeda(sessao.valor_implantacao)} venc ${ddmm(sessao.implantacao_vencimento)}`, url)
      : 'implantação isenta';

  if (cobranca.status === 'cobrado') {
    const m = cobranca.mensalidade;
    const dias = m?.dias != null && m.dias < 30 ? ` (${m.dias} dias)` : '';
    const rotulo = `1ª mensalidade${dias} ${moeda(m?.valor ?? sessao.valor_mensal)} venc ${ddmm(m?.vencimento)}`;
    const partes = [
      'cliente criado',
      implantacaoNoAviso(cobranca.implantacao_url),
      comLink(rotulo, cobranca.mensalidade_url),
    ];
    if (cobranca.recorrente && sessao.dia_vencimento) {
      partes.push(`recorrente ${moeda(sessao.valor_mensal)} dia ${sessao.dia_vencimento}`);
    }
    linhas.push(`💳 Conta Azul: ${partes.join(' · ')}`);
  } else if (cobranca.status === 'aguardando_go_live') {
    linhas.push(
      `💳 Conta Azul: cliente criado · ${implantacaoNoAviso(cobranca.implantacao_url)} · ` +
        '⏳ 1ª mensalidade proporcional espera a data de go-live — registrar no painel',
    );
  } else {
    linhas.push(`💳 Conta Azul: ⚠️ pendente — ${cobranca.motivo}`);
  }

  const avisos = contrato.status === 'gerado' ? contrato.avisos : [];
  if (avisos.length) linhas.push(`Avisos: ${avisos.join(' | ')}`);
  linhas.push(`Painel: ${base}/admin`);

  return linhas.join('\n');
}

/** Aviso de assinatura para o grupo dos sócios; `null` quando não há contrato gerado. */
export function mensagemSociosAssinatura(
  nomeFantasia: string,
  contrato: ResultadoContrato,
  assinatura: ResultadoAssinatura | null,
): string | null {
  if (contrato.status !== 'gerado') return null;
  const base = (process.env.PUBLIC_BASE_URL ?? 'https://onboarding.pipeelo.com').replace(/\/+$/, '');
  if (!assinatura) return `✍️ Assinatura de ${nomeFantasia}: não enviada (sem PDF) · enviar pelo painel ${base}/admin`;
  if (assinatura.status === 'enviado') {
    const por = [assinatura.dm ? 'WhatsApp do responsável' : null, assinatura.grupo ? 'grupo' : null].filter(Boolean).join(' + ');
    return `✍️ Assinatura de ${nomeFantasia}: link enviado${por ? ` (${por})` : ''} · ${assinatura.link}`;
  }
  return `✍️ Assinatura de ${nomeFantasia}: ⚠️ pendente — ${assinatura.motivo} · ${base}/admin`;
}

export async function processarPosCadastro(
  supabase: SupabaseClient,
  sessao: SessaoPosCadastro,
  cadastro: Cadastro,
  opts: { avisarStaff?: boolean } = {},
): Promise<ResultadoPosCadastro> {
  // 1. Contrato — pula quando já existe um gerado sem erro pendente.
  let contrato: ResultadoContrato;
  if (sessao.contrato_path && !sessao.contrato_erro) {
    contrato = {
      status: 'gerado',
      path: sessao.contrato_path,
      representante: sessao.contrato_extracao?.representante?.nome ?? '',
      avisos: [],
    };
  } else {
    try {
      contrato = await gerarContratoParaSessao(supabase, sessao, cadastro);
    } catch (e) {
      contrato = { status: 'pendente', motivo: `Erro inesperado ao gerar o contrato: ${msg(e)}`, faltando: [] };
      console.error('[pos-cadastro] contrato:', e);
    }
  }

  // 1b. Assinatura — só com contrato gerado e PDF; pula quando já enviada sem erro.
  let assinatura: ResultadoAssinatura | null = null;
  if (contrato.status === 'gerado') {
    const pdfPath = contrato.pdf_path ?? sessao.contrato_pdf_path ?? null;
    const jaEnviada = Boolean(sessao.assinapdf_solicitacao_id && sessao.assinapdf_link && !sessao.assinatura_erro
      && sessao.assinatura_status && sessao.assinatura_status !== 'pendente' && sessao.assinatura_status !== 'erro');
    if (jaEnviada) {
      assinatura = { status: 'enviado', solicitacao_id: sessao.assinapdf_solicitacao_id as number, link: sessao.assinapdf_link as string, dm: true, grupo: true, reenvio: true };
    } else if (pdfPath) {
      try {
        assinatura = await enviarParaAssinatura(
          supabase,
          { ...sessao, contrato_pdf_path: pdfPath, contrato_extracao: sessao.contrato_extracao ?? null },
          cadastro,
        );
      } catch (e) {
        assinatura = { status: 'pendente', motivo: `Erro inesperado ao enviar para assinatura: ${msg(e)}` };
        console.error('[pos-cadastro] assinatura:', e);
      }
    }
  }

  // 2. Conta Azul — pula quando já cobrado.
  let cobranca: ResultadoCobranca;
  if (sessao.ca_cobrado_at) {
    cobranca = {
      status: 'cobrado',
      implantacao_url: sessao.ca_implantacao_url ?? null,
      mensalidade_url: sessao.ca_mensalidade_url ?? null,
      recorrente: Boolean(sessao.dia_vencimento),
      mensalidade: null,
    };
  } else {
    try {
      cobranca = await cobrarContaAzul(supabase, sessao, cadastro);
    } catch (e) {
      cobranca = { status: 'pendente', motivo: `Erro inesperado ao cobrar no Conta Azul: ${msg(e)}` };
      console.error('[pos-cadastro] conta azul:', e);
    }
  }

  // 3. Um aviso no Staff com contrato e cobrança; a assinatura vai só aos sócios.
  if (opts.avisarStaff !== false) {
    try {
      await notifyStaff(mensagemStaffPosCadastro(cadastro.nome_fantasia, sessao, contrato, cobranca));
    } catch (e) {
      console.error('[pos-cadastro] aviso no Staff falhou:', e);
    }
    const avisoSocios = mensagemSociosAssinatura(cadastro.nome_fantasia, contrato, assinatura);
    if (avisoSocios) {
      try {
        await notifySocios(avisoSocios);
      } catch (e) {
        console.error('[pos-cadastro] aviso aos sócios falhou:', e);
      }
    }
  }

  return { contrato, assinatura, cobranca };
}
