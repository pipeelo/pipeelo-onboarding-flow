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
  /** Endereço da sede lido dos documentos (quando o contrato já foi gerado). */
  contrato_extracao?: { endereco_sede?: string | null } | null;
};

/**
 * Desde 15/09/2026 o onboarding só CRIA O CLIENTE no Conta Azul. Implantação,
 * 1ª mensalidade (proporcional ao go-live) e contrato recorrente são lançados à
 * mão pelo financeiro — acertar a data do go-live automaticamente complicava mais
 * do que ajudava.
 */
export type ResultadoCobranca =
  | { status: 'cliente_criado'; cliente_id: string | null }
  | { status: 'pendente'; motivo: string };

type RespostaSite = {
  ok?: boolean;
  etapa?: string;
  erro?: string;
  cliente_id?: string;
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
 * Marca em `ca_erro` que a criação está em curso. É a trava contra cliente
 * duplicado: só quem consegue trocar a marca segue para o site. A condição
 * `ca_cliente_id is null` cobre a sessão já criada; a condição sobre `ca_erro`
 * cobre duas execuções simultâneas (background do cadastro + botão do admin).
 */
export const EM_ANDAMENTO = 'processando';

async function reservar(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('onboarding_sessions')
    .update({ ca_erro: EM_ANDAMENTO })
    .eq('id', id)
    .is('ca_cliente_id', null)
    .or(`ca_erro.is.null,ca_erro.neq.${EM_ANDAMENTO}`)
    .select('id');
  if (error) {
    // Sem conseguir reservar, não segue: repetir é pior do que atrasar.
    console.error('[conta-azul] reserva falhou:', error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

export async function criarClienteContaAzul(
  supabase: SupabaseClient,
  sessao: SessaoCobranca,
  cadastro: Cadastro,
): Promise<ResultadoCobranca> {
  const pendente = async (motivo: string, gravar = false): Promise<ResultadoCobranca> => {
    if (gravar) await patch(supabase, sessao.id, { ca_erro: motivo });
    return { status: 'pendente', motivo };
  };

  try {
    const secret = process.env.CA_INTERNAL_SECRET;
    if (!secret) return pendente('CA_INTERNAL_SECRET não configurado', true);

    // Trava contra cliente duplicado — antes da rede.
    if (!(await reservar(supabase, sessao.id))) {
      return { status: 'pendente', motivo: 'criação em andamento ou cliente já criado' };
    }

    // Sem `implantacao` e sem `mensalidade`: o site cria só a pessoa, sem venda,
    // boleto nem contrato recorrente.
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
      implantacao: null,
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

    // 409: outra execução já está criando o cliente. Não é erro — só esperar.
    // Libera a marca de "processando" para o próximo reprocesso poder tentar.
    if (resposta.status === 409) {
      await patch(supabase, sessao.id, { ca_erro: null });
      return { status: 'pendente', motivo: 'criação já em andamento no Conta Azul; tentar de novo em instantes' };
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

    if (resposta.status !== 201 || !corpo.ok || !corpo.cliente_id) {
      return pendente(`Resposta inesperada do Conta Azul (HTTP ${resposta.status})`, true);
    }

    await patch(supabase, sessao.id, { ca_cliente_id: corpo.cliente_id, ca_erro: null });
    return { status: 'cliente_criado', cliente_id: corpo.cliente_id };
  } catch (e) {
    // Rede de segurança: criarClienteContaAzul nunca lança.
    const motivo = `Erro inesperado ao criar o cliente no Conta Azul: ${msg(e)}`;
    console.error('[conta-azul]', motivo);
    try {
      await patch(supabase, sessao.id, { ca_erro: motivo });
    } catch { /* ignora */ }
    return { status: 'pendente', motivo };
  }
}
