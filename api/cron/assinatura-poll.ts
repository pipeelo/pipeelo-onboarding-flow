import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase } from '../_lib/supabase';
import { consultarAssinaturasPendentes } from '../_lib/assinatura';

/**
 * GET/POST /api/cron/assinatura-poll — consulta na AssinaPDF as sessões com
 * assinatura em andamento e atualiza o status (a AssinaPDF não tem webhook).
 *
 * Auth: Authorization Bearer ${CRON_SECRET}. No EasyPanel o `server/index.ts`
 * chama `executarPollAssinatura` direto por intervalo; este endpoint serve para
 * a Vercel e para disparo manual.
 */
export async function executarPollAssinatura() {
  const supabase = getServiceSupabase();
  return consultarAssinaturasPendentes(supabase);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (!expected || req.headers.authorization !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const r = await executarPollAssinatura();
    return res.status(200).json({ ok: true, ...r });
  } catch (e) {
    console.error('[cron/assinatura-poll]', e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'internal' });
  }
}
