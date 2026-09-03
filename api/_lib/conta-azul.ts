import type { SupabaseClient } from '@supabase/supabase-js';
import type { Cadastro } from './schemas/cadastro';

/**
 * Cliente HTTP da action `cadastro` do router de Conta Azul do site de vendas.
 *
 * O onboarding não fala com o Conta Azul direto: quem tem o OAuth é o site
 * (`pipeelo.com/api/conta-azul`). Aqui só mandamos os valores do fechamento e
 * guardamos o resultado na sessão. Nunca lança — falha vira `pendente` com
 * motivo, gravado em `ca_erro` para o `/admin` mostrar e permitir reprocessar.
 */

export type SessaoCobranca = {
  id: string;
  slug?: string | null;
  valor_implantacao?: number | string | null;
  implantacao_vencimento?: string | null;
  valor_mensal?: number | string | null;
  primeira_mensalidade_em?: string | null;
  dia_vencimento?: number | string | null;
  /** Endereço da sede lido dos documentos (quando o contrato já foi gerado). */
  contrato_extracao?: { endereco_sede?: string | null } | null;
};

export type ResultadoCobranca =
  | { status: 'cobrado'; implantacao_url: string | null; mensalidade_url: string | null; recorrente: boolean }
  | { status: 'pendente'; motivo: string };

type RespostaSite = {
  ok?: boolean;
  etapa?: string;
  erro?: string;
  cliente_id?: string;
  implantacao?: { venda_id?: string; vencimento?: string; url?: string | null } | null;
  mensalidade?: { venda_id?: string; vencimento?: string; url?: string | null } | null;
  recorrente?: { contrato_id?: string } | null;
};

/** Base do site de vendas. `pipeelo.com` é o domínio primário; `vendas.` só redireciona. */
export function baseVendas(): string {
  return (process.env.VENDAS_API_URL || 'https://pipeelo.com').replace(/\/+$/, '');
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function presente(v: unknown): boolean {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

/**
 * Número vindo do banco ou de um campo de texto. Aceita `1234.56`, `"1234,56"`,
 * `"1.234,56"` e `"1,234.56"`. Devolve null quando não dá para interpretar —
 * quem chama trata como pendente, nunca manda `valor: null` para o Conta Azul.
 */
export function numero(v: unknown): number | null {
  if (!presente(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;

  let s = String(v).trim().replace(/\s/g, '').replace(/^R\$/i, '');
  const temVirgula = s.includes(',');
  const temPonto = s.includes('.');

  if (temVirgula && temPonto) {
    // O último separador é o decimal; o outro é milhar.
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (temVirgula) {
    s = s.replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    // Só pontos e em grupos de 3: é milhar ("1.234" = 1234, não 1,234).
    s = s.replace(/\./g, '');
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function patch(supabase: SupabaseClient, id: string, data: Record<string, unknown>) {
  const { error } = await supabase.from('onboarding_sessions').update(data).eq('id', id);
  if (error) console.error('[conta-azul] update falhou:', error.message);
}

/**
 * Marca em `ca_erro` que a cobrança está em curso. É a trava contra cobrança
 * dupla: só quem consegue trocar a marca segue para o site. A condição
 * `ca_cobrado_at is null` cobre a sessão já cobrada; a condição sobre `ca_erro`
 * cobre duas execuções simultâneas (background do cadastro + botão do admin).
 */
export const EM_ANDAMENTO = 'processando';

async function reservar(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('onboarding_sessions')
    .update({ ca_erro: EM_ANDAMENTO })
    .eq('id', id)
    .is('ca_cobrado_at', null)
    .or(`ca_erro.is.null,ca_erro.neq.${EM_ANDAMENTO}`)
    .select('id');
  if (error) {
    // Sem conseguir reservar, não cobra: repetir é pior do que atrasar.
    console.error('[conta-azul] reserva falhou:', error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

/** Campos do fechamento sem os quais não dá para cobrar. */
const OBRIGATORIOS: Array<[keyof SessaoCobranca, string]> = [
  ['valor_implantacao', 'valor da implantação'],
  ['implantacao_vencimento', 'vencimento da implantação'],
  ['valor_mensal', 'valor mensal'],
  ['primeira_mensalidade_em', 'data da 1ª mensalidade'],
  ['dia_vencimento', 'dia de vencimento'],
];

/** Implantação 0 = isenta: sem boleto de implantação e sem exigir o vencimento dela. */
export function implantacaoIsenta(sessao: SessaoCobranca): boolean {
  return numero(sessao.valor_implantacao) === 0;
}

export function faltamDadosDoFechamento(sessao: SessaoCobranca): string[] {
  const isenta = implantacaoIsenta(sessao);
  return OBRIGATORIOS
    .filter(([k]) => !(isenta && k === 'implantacao_vencimento'))
    .filter(([k]) => !presente(sessao[k]))
    .map(([, rotulo]) => rotulo);
}

export async function cobrarContaAzul(
  supabase: SupabaseClient,
  sessao: SessaoCobranca,
  cadastro: Cadastro,
): Promise<ResultadoCobranca> {
  const pendente = async (motivo: string, gravar = false): Promise<ResultadoCobranca> => {
    if (gravar) await patch(supabase, sessao.id, { ca_erro: motivo });
    return { status: 'pendente', motivo };
  };

  try {
    const faltando = faltamDadosDoFechamento(sessao);
    if (faltando.length) {
      return pendente(`faltam dados do fechamento: ${faltando.join(', ')}`, true);
    }

    const valorImplantacao = numero(sessao.valor_implantacao);
    const valorMensal = numero(sessao.valor_mensal);
    const diaVencimento = numero(sessao.dia_vencimento);
    const invalidos = [
      valorImplantacao === null ? 'valor da implantação' : '',
      valorMensal === null ? 'valor mensal' : '',
      diaVencimento === null ? 'dia de vencimento' : '',
    ].filter(Boolean);
    if (invalidos.length) {
      return pendente(`valores inválidos no fechamento: ${invalidos.join(', ')}`, true);
    }

    const secret = process.env.CA_INTERNAL_SECRET;
    if (!secret) return pendente('CA_INTERNAL_SECRET não configurado', true);

    // Trava contra cobrança dupla — depois das validações locais, antes da rede.
    if (!(await reservar(supabase, sessao.id))) {
      return { status: 'pendente', motivo: 'cobrança em andamento ou já feita' };
    }

    const payload = {
      secret,
      sessao_slug: sessao.slug ?? null,
      empresa: {
        razao_social: cadastro.razao_social,
        cnpj: cadastro.cnpj,
        email_cobranca: cadastro.cobranca_email,
        telefone: cadastro.cobranca_telefone,
        ...(sessao.contrato_extracao?.endereco_sede
          ? { endereco: sessao.contrato_extracao.endereco_sede }
          : {}),
      },
      // Isenta → o site não cria venda nem boleto de implantação.
      implantacao: valorImplantacao === 0
        ? null
        : { valor: valorImplantacao, vencimento: sessao.implantacao_vencimento },
      mensalidade: {
        valor: valorMensal,
        primeira_em: sessao.primeira_mensalidade_em,
        dia_vencimento: diaVencimento,
      },
    };

    let resposta: Response;
    try {
      resposta = await fetch(`${baseVendas()}/api/conta-azul?action=cadastro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return pendente(`Não foi possível falar com o Conta Azul: ${msg(e)}`, true);
    }

    const corpo = (await resposta.json().catch(() => ({}))) as RespostaSite;

    // 409: outra execução já está criando as cobranças. Não é erro — só esperar.
    // Libera a marca de "processando" para o próximo reprocesso poder tentar.
    if (resposta.status === 409) {
      await patch(supabase, sessao.id, { ca_erro: null });
      return { status: 'pendente', motivo: 'cobrança já em andamento no Conta Azul; tentar de novo em instantes' };
    }
    if (resposta.status === 400 || resposta.status === 401) {
      const detalhe = corpo.erro || `HTTP ${resposta.status}`;
      return pendente(`Conta Azul recusou o pedido: ${detalhe}`, true);
    }

    // 200 com ok:false é falha de etapa — grava para o /admin mostrar.
    if (corpo.ok === false) {
      const motivo = `Conta Azul falhou em "${corpo.etapa || 'desconhecida'}": ${corpo.erro || 'sem detalhe'}`;
      return pendente(motivo, true);
    }

    if (resposta.status !== 201 || !corpo.ok) {
      return pendente(`Resposta inesperada do Conta Azul (HTTP ${resposta.status})`, true);
    }

    const implantacao_url = corpo.implantacao?.url ?? null;
    const mensalidade_url = corpo.mensalidade?.url ?? null;

    await patch(supabase, sessao.id, {
      ca_cliente_id: corpo.cliente_id ?? null,
      ca_implantacao_url: implantacao_url,
      ca_mensalidade_url: mensalidade_url,
      ca_cobrado_at: new Date().toISOString(),
      ca_erro: null,
    });

    return {
      status: 'cobrado',
      implantacao_url,
      mensalidade_url,
      recorrente: Boolean(corpo.recorrente?.contrato_id),
    };
  } catch (e) {
    // Rede de segurança: cobrarContaAzul nunca lança.
    const motivo = `Erro inesperado ao cobrar no Conta Azul: ${msg(e)}`;
    console.error('[conta-azul]', motivo);
    try {
      await patch(supabase, sessao.id, { ca_erro: motivo });
    } catch { /* ignora */ }
    return { status: 'pendente', motivo };
  }
}
