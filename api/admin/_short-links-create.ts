import type { VercelRequest, VercelResponse } from '@vercel/node';
import { assertAdminUser, AdminAuthError } from '../_lib/admin-auth';
import { getServiceSupabase } from '../_lib/supabase';
import { ensureShortLink } from '../_lib/short-links';

/**
 * POST /api/admin/short-links-create
 *   Auth: Bearer <supabase-jwt>
 *   Body: { session_id: string, modo: 'completo' | 'comercial', target_url: string }
 *   200:  { code: string, short_url: string }
 *   400 invalid_input | 401 unauthorized | 500
 *
 * Idempotente por (session_id, modo): se já existe shortlink pra essa combinação,
 * retorna o mesmo. Senão gera novo code de 6 chars (alfabeto sem caracteres
 * confundíveis).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    await assertAdminUser(req);

    const { session_id, modo, target_url } = req.body ?? {};
    if (
      typeof session_id !== 'string' ||
      typeof target_url !== 'string' ||
      (modo !== 'completo' && modo !== 'comercial')
    ) {
      return res.status(400).json({ error: 'invalid_input' });
    }

    const supabase = getServiceSupabase();

    // Atualiza o modo da sessão (último link gerado define qual mensagem
    // de conclusão será disparada quando o cliente terminar).
    await supabase
      .from('onboarding_sessions')
      .update({ modo })
      .eq('id', session_id);

    let result: { code: string; short_url: string };
    try {
      result = await ensureShortLink(supabase, {
        session_id, modo, target_url,
        host: req.headers.host, proto: req.headers['x-forwarded-proto'] as string | undefined,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'shortlink_generation_failed') {
        return res.status(500).json({ error: 'code_generation_exhausted' });
      }
      const message = (err as { message?: string })?.message ?? 'internal';
      console.error('[short-links-create]', err);
      return res.status(500).json({ error: message });
    }

    return res.status(200).json(result);
  } catch (e: unknown) {
    if (e instanceof AdminAuthError) return res.status(e.status).json({ error: e.message });
    console.error('[admin/short-links-create]', e);
    return res.status(500).json({ error: 'internal' });
  }
}
