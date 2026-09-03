import type { SupabaseClient } from '@supabase/supabase-js';
import type { InstanciaEvolution } from './evolution';

/**
 * Fila cadenciada das ações de grupo na Evolution.
 *
 * Este módulo só fala com o banco — quem executa a ação na Evolution é o worker
 * em `api/cron/evolution-fila.ts`. A separação existe para o ritmo ser testável
 * sem nenhuma chamada HTTP.
 *
 * O teto é GLOBAL, e é isso que resolve o problema: `evolution_fila_estado` tem
 * uma linha só, então dois cadastros no mesmo dia dividem o mesmo ritmo em vez
 * de dispararem duas rajadas independentes (era o que o `esperar(1500)` local em
 * cadastro-grupo.ts não conseguia impedir).
 */

export type TipoFila = 'add' | 'texto' | 'resumo';
export type StatusFila = 'pendente' | 'processando' | 'feito' | 'falhou';

export type PayloadFila = {
  /** 'add': JID a adicionar. */
  jid?: string;
  /** 'texto': mensagem a enviar no grupo. */
  texto?: string;
  /** Rótulo humano para o resumo ao Staff (nome da pessoa/etapa). */
  rotulo?: string;
  /** 'resumo': nome fantasia da empresa, para a mensagem final. */
  empresa?: string;
  /** 'resumo': quem deveria estar no grupo, para conferir e convidar por e-mail quem ficou de fora. */
  esperados?: Array<{ jid: string; nome: string; email?: string }>;
  /** 'resumo': link do convite, usado no e-mail de quem a privacidade do WhatsApp barrou. */
  inviteUrl?: string;
};

export type ItemFila = {
  id: string;
  session_id: string;
  tipo: TipoFila;
  grupo_jid: string;
  instancia: InstanciaEvolution;
  payload: PayloadFila;
  chave: string;
  status: StatusFila;
  tentativas: number;
  max_tentativas: number;
};

export type NovoItem = {
  sessionId: string;
  tipo: TipoFila;
  grupoJid: string;
  instancia: InstanciaEvolution;
  /** Idempotência: mesma chave nunca entra duas vezes. */
  chave: string;
  payload?: PayloadFila;
};

const COLUNAS = 'id, session_id, tipo, grupo_jid, instancia, payload, chave, status, tentativas, max_tentativas';

function num(env: string | undefined, padrao: number): number {
  const n = Number(env);
  return Number.isFinite(n) && n >= 0 ? n : padrao;
}

/** Intervalo entre duas ações, em segundos. Aleatório de propósito: cadência fixa é digital de bot. */
export function intervaloSegundos(): { min: number; max: number } {
  const min = num(process.env.EVOLUTION_FILA_MIN_SEGUNDOS, 45);
  const max = num(process.env.EVOLUTION_FILA_MAX_SEGUNDOS, 120);
  return max >= min ? { min, max } : { min: max, max: min };
}

function sorteioIntervaloMs(): number {
  const { min, max } = intervaloSegundos();
  return (min + Math.random() * (max - min)) * 1000;
}

/**
 * Insere os itens. Já espaça o `proxima_tentativa_at` pelo intervalo mínimo, o que
 * garante ordem determinística entre itens enfileirados no mesmo instante (o
 * 'resumo' entra por último) e evita que a fila fique toda liberada de uma vez.
 * Ignora duplicatas por `chave`, então reprocessar uma sessão não duplica nada.
 */
export async function enfileirar(supabase: SupabaseClient, itens: NovoItem[]): Promise<number> {
  if (itens.length === 0) return 0;
  const { min } = intervaloSegundos();
  const agora = Date.now();
  const linhas = itens.map((item, i) => ({
    session_id: item.sessionId,
    tipo: item.tipo,
    grupo_jid: item.grupoJid,
    instancia: item.instancia,
    chave: item.chave,
    payload: item.payload ?? {},
    proxima_tentativa_at: new Date(agora + i * min * 1000).toISOString(),
  }));
  const { error } = await supabase
    .from('evolution_fila')
    .upsert(linhas, { onConflict: 'chave', ignoreDuplicates: true });
  if (error) {
    console.error('[evolution-fila] enfileirar falhou:', error.message);
    return 0;
  }
  return linhas.length;
}

/**
 * Tenta tomar o slot global. O UPDATE com guard `proxima_liberacao_at <= now()` é
 * a trava: dois workers concorrentes, só um consegue avançar a linha e executar.
 * Devolve false quando ainda não é hora ou a fila está pausada pelo disjuntor.
 */
export async function ganharSlot(supabase: SupabaseClient): Promise<boolean> {
  const agoraIso = new Date().toISOString();
  const proxima = new Date(Date.now() + sorteioIntervaloMs()).toISOString();
  const { data, error } = await supabase
    .from('evolution_fila_estado')
    .update({ proxima_liberacao_at: proxima })
    .eq('id', 1)
    .lte('proxima_liberacao_at', agoraIso)
    .or(`pausado_ate.is.null,pausado_ate.lte.${agoraIso}`)
    .select('id');
  if (error) {
    console.error('[evolution-fila] ganharSlot falhou:', error.message);
    return false;
  }
  return Boolean(data && data.length > 0);
}

/** Próximo item liberado, ou null. Não reivindica — só espia. */
export async function proximoItem(supabase: SupabaseClient): Promise<ItemFila | null> {
  const { data, error } = await supabase
    .from('evolution_fila')
    .select(COLUNAS)
    .eq('status', 'pendente')
    .lte('proxima_tentativa_at', new Date().toISOString())
    .order('proxima_tentativa_at', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) {
    console.error('[evolution-fila] proximoItem falhou:', error.message);
    return null;
  }
  return (data?.[0] as ItemFila | undefined) ?? null;
}

/** Marca 'processando' só se ainda estiver 'pendente'. False = outro worker levou. */
export async function reivindicar(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('evolution_fila')
    .update({ status: 'processando' })
    .eq('id', id)
    .eq('status', 'pendente')
    .select('id');
  if (error) {
    console.error('[evolution-fila] reivindicar falhou:', error.message);
    return false;
  }
  return Boolean(data && data.length > 0);
}

export async function concluir(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase
    .from('evolution_fila')
    .update({ status: 'feito', executado_at: new Date().toISOString(), ultimo_erro: null })
    .eq('id', id);
  if (error) console.error('[evolution-fila] concluir falhou:', error.message);
}

/**
 * Devolve o item para a fila com backoff exponencial (30s * 2^n, jitter 30%, teto 1h),
 * ou marca 'falhou' quando estourou as tentativas. Mesma curva do webhook_outbox.
 */
export async function falhar(supabase: SupabaseClient, item: ItemFila, erro: string): Promise<void> {
  const tentativas = item.tentativas + 1;
  const motivo = erro.slice(0, 500);
  if (tentativas >= item.max_tentativas) {
    const { error } = await supabase
      .from('evolution_fila')
      .update({ status: 'falhou', tentativas, ultimo_erro: motivo })
      .eq('id', item.id);
    if (error) console.error('[evolution-fila] falhar (terminal) falhou:', error.message);
    return;
  }
  const base = 30_000 * Math.pow(2, tentativas);
  const atraso = Math.min(base + Math.random() * 0.3 * base, 60 * 60 * 1000);
  const { error } = await supabase
    .from('evolution_fila')
    .update({
      status: 'pendente',
      tentativas,
      ultimo_erro: motivo,
      proxima_tentativa_at: new Date(Date.now() + atraso).toISOString(),
    })
    .eq('id', item.id);
  if (error) console.error('[evolution-fila] falhar falhou:', error.message);
}

/**
 * Disjuntor: para a fila inteira por N minutos. Usado quando a instância cai ou o
 * WhatsApp devolve rate-overlimit — martelar um número que acabou de cair é
 * exatamente o que provoca o bloqueio seguinte.
 */
export async function pausarFila(supabase: SupabaseClient, minutos: number, motivo: string): Promise<void> {
  const ate = new Date(Date.now() + minutos * 60_000).toISOString();
  const { error } = await supabase
    .from('evolution_fila_estado')
    .update({ pausado_ate: ate, pausa_motivo: motivo.slice(0, 300) })
    .eq('id', 1);
  if (error) console.error('[evolution-fila] pausarFila falhou:', error.message);
}

export type ResumoFila = { pendentes: number; feitos: number; falhados: number; total: number };

/** Quanto falta da fila de uma sessão — alimenta o card do admin e a mensagem final. */
export async function resumoDaSessao(supabase: SupabaseClient, sessionId: string): Promise<ResumoFila> {
  const vazio: ResumoFila = { pendentes: 0, feitos: 0, falhados: 0, total: 0 };
  const { data, error } = await supabase
    .from('evolution_fila')
    .select('status, tipo')
    .eq('session_id', sessionId);
  if (error || !data) {
    if (error) console.error('[evolution-fila] resumoDaSessao falhou:', error.message);
    return vazio;
  }
  // O 'resumo' é o aviso final ao Staff, não trabalho do grupo: não entra na conta.
  const linhas = (data as Array<{ status: StatusFila; tipo: TipoFila }>).filter((l) => l.tipo !== 'resumo');
  return {
    pendentes: linhas.filter((l) => l.status === 'pendente' || l.status === 'processando').length,
    feitos: linhas.filter((l) => l.status === 'feito').length,
    falhados: linhas.filter((l) => l.status === 'falhou').length,
    total: linhas.length,
  };
}
