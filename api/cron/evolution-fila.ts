import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase } from '../_lib/supabase';
import {
  updateParticipants, sendText, getParticipants, chaveNumero, groupSubject, EvolutionConfigError,
} from '../_lib/evolution';
import { notifyStaff } from '../_lib/staff-notify';
import { sendTransactionalEmail } from '../_lib/email-sender';
import {
  ganharSlot, proximoItem, reivindicar, concluir, falhar, pausarFila, resumoDaSessao, type ItemFila,
} from '../_lib/evolution-fila';

/**
 * GET/POST /api/cron/evolution-fila — drena UMA ação da fila de grupos.
 *
 * Auth: Authorization Bearer ${CRON_SECRET}. No EasyPanel o `server/index.ts`
 * chama `drenarFilaEvolution` direto por intervalo; este endpoint serve para
 * disparo manual e para a Vercel.
 *
 * Uma ação por rodada, de propósito: o ritmo vem do slot global em
 * `evolution_fila_estado`, não de sleeps dentro do processo. Assim o worker
 * sobrevive a restart do container sem perder a cadência.
 */

const PAUSA_RATE_MINUTOS = 10;
const PAUSA_QUEDA_MINUTOS = 15;

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** O WhatsApp pedindo trégua. Não é erro de código: é para desacelerar. */
function ehRateLimit(e: unknown): boolean {
  return /rate.?overlimit|too many|429/i.test(msg(e));
}

/** Instância fora do ar / desconectada. Insistir aqui é o que provoca o bloqueio seguinte. */
function ehQueda(e: unknown): boolean {
  if (e instanceof EvolutionConfigError) return true;
  return /connection closed|not connected|disconnect|ECONNREFUSED|ENOTFOUND|fetch failed|"status":\s*5\d{2}/i.test(msg(e));
}

async function executar(supabase: ReturnType<typeof getServiceSupabase>, item: ItemFila): Promise<void> {
  if (item.tipo === 'add') {
    const jid = item.payload.jid;
    if (!jid) return;
    // Na primeira tentativa vai direto: cada JID tem seu próprio item, e quem já
    // estava no grupo entrou no createGroup. A conferência só vale a pena na
    // retentativa, onde o add anterior pode ter passado e devolvido erro.
    if (item.tentativas > 0) {
      const dentro = await getParticipants(item.grupo_jid, item.instancia);
      if (dentro.some((p) => chaveNumero(p) === chaveNumero(jid))) return;
    }
    await updateParticipants(item.grupo_jid, 'add', [jid], item.instancia);
    return;
  }

  if (item.tipo === 'texto') {
    const texto = item.payload.texto;
    if (!texto) return;
    await sendText(item.grupo_jid, texto, item.instancia);
    return;
  }

  // 'resumo': fecha a fila da sessão. É aqui, e só aqui, que dá para saber quem a
  // privacidade do WhatsApp barrou: o add não falha, a pessoa simplesmente não
  // entra. Uma leitura de participantes no fim resolve, e quem ficou de fora
  // recebe o convite por e-mail.
  const r = await resumoDaSessao(supabase, item.session_id);
  const empresa = item.payload.empresa ?? 'cliente';
  const esperados = item.payload.esperados ?? [];
  let fora: Array<{ jid: string; nome: string; email?: string }> = [];

  if (esperados.length > 0) {
    const dentro = await getParticipants(item.grupo_jid, item.instancia);
    fora = esperados.filter((p) => !dentro.some((d) => chaveNumero(d) === chaveNumero(p.jid)));
    const url = item.payload.inviteUrl;
    if (url) {
      for (const p of fora) {
        if (!p.email) continue;
        try {
          await sendTransactionalEmail({
            template: 'ConviteGrupo',
            sessionId: item.session_id,
            to: p.email,
            idempotencyKey: `convite-grupo:${item.session_id}:${chaveNumero(p.jid)}`,
            props: { nome: p.nome, empresaNome: empresa, grupoNome: groupSubject(empresa), inviteUrl: url },
          });
        } catch (e) {
          console.error('[cron/evolution-fila] convite por e-mail falhou:', msg(e));
        }
      }
    }
  }

  const linhas = [`👥 Grupo de ${empresa}: fila concluída — ${r.feitos} de ${r.total} entraram.`];
  if (fora.length > 0) {
    const comEmail = item.payload.inviteUrl ? ' — convite enviado por e-mail a quem tem e-mail' : '';
    linhas.push(`Não entraram (privacidade do WhatsApp): ${fora.map((f) => f.nome).join(', ')}${comEmail}`);
  }
  if (r.falhados > 0) linhas.push(`⚠️ ${r.falhados} add(s) falharam de vez — ver evolution_fila.`);
  await notifyStaff(linhas.join('\n'));
}

export async function drenarFilaEvolution(): Promise<{
  processado: number; tipo?: string; erro?: string; pausada?: boolean;
}> {
  const supabase = getServiceSupabase();

  // Espia antes de tomar o slot: fila vazia não deve gastar a janela de tempo.
  const item = await proximoItem(supabase);
  if (!item) return { processado: 0 };

  if (!(await ganharSlot(supabase))) return { processado: 0 };
  if (!(await reivindicar(supabase, item.id))) return { processado: 0 };

  try {
    await executar(supabase, item);
    await concluir(supabase, item.id);
    return { processado: 1, tipo: item.tipo };
  } catch (e) {
    const erro = msg(e);
    await falhar(supabase, item, erro);
    if (ehRateLimit(e)) {
      await pausarFila(supabase, PAUSA_RATE_MINUTOS, `rate limit: ${erro}`);
      return { processado: 0, erro, pausada: true };
    }
    if (ehQueda(e)) {
      await pausarFila(supabase, PAUSA_QUEDA_MINUTOS, `instância indisponível: ${erro}`);
      await notifyStaff(
        `🛑 Fila de grupos pausada por ${PAUSA_QUEDA_MINUTOS} min — a instância dos grupos não respondeu.\n${erro.slice(0, 200)}`
      );
      return { processado: 0, erro, pausada: true };
    }
    return { processado: 0, erro };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (!expected || req.headers.authorization !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const r = await drenarFilaEvolution();
    return res.status(200).json({ ok: true, ...r });
  } catch (e) {
    console.error('[cron/evolution-fila]', e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'internal' });
  }
}
