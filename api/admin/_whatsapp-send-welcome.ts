import type { VercelRequest, VercelResponse } from '@vercel/node';
import { assertAdminUser, AdminAuthError } from '../_lib/admin-auth';
import { getServiceSupabase } from '../_lib/supabase';
import {
  findGroupByName,
  sendText,
  EvolutionConfigError,
  EvolutionApiError,
} from '../_lib/evolution';
import { ensureShortLink, onboardingTargetUrl } from '../_lib/short-links';
import { WELCOME_TEMPLATE } from '../_lib/welcome-template';

/**
 * POST /api/admin/whatsapp-send-welcome
 *   Auth: Bearer <supabase-jwt>
 *   Body: { session_id: string, modo: 'completo' | 'comercial' }
 *   200:  { ok: true, group: { id, name }, short_url, message_preview }
 *   400 invalid_input
 *   404 group_not_found  (grupo com nome = empresa_nome não existe)
 *   401 unauthorized
 *   502 evolution_error  | 503 evolution_unconfigured
 *
 * Fluxo:
 *  1. Hidrata sessão pra pegar empresa_nome + access_token + slug.
 *  2. Resolve/cria shortlink (tabela short_links) pro modo escolhido.
 *  3. Busca grupo no Evolution (`group.subject` == empresa_nome), ou usa o
 *     `grupo_jid` salvo na sessão quando disponível.
 *  4. Manda mensagem de boas-vindas com link curto.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    await assertAdminUser(req);

    const { session_id, modo } = req.body ?? {};
    if (typeof session_id !== 'string' || (modo !== 'completo' && modo !== 'comercial')) {
      return res.status(400).json({ error: 'invalid_input' });
    }

    const supabase = getServiceSupabase();

    // 1. Hidratar sessão
    const { data: session, error: sessErr } = await supabase
      .from('onboarding_sessions')
      .select('id, slug, empresa_nome, access_token, grupo_jid')
      .eq('id', session_id)
      .maybeSingle();
    if (sessErr || !session) {
      return res.status(404).json({ error: 'session_not_found' });
    }

    // Atualiza modo da sessão (último link enviado define qual mensagem
    // de conclusão será disparada quando o cliente terminar).
    await supabase
      .from('onboarding_sessions')
      .update({ modo })
      .eq('id', session_id);

    const targetUrl = onboardingTargetUrl({
      slug: session.slug,
      access_token: (session as { access_token?: string }).access_token,
      modo,
    });
    const { short_url: shortUrl } = await ensureShortLink(supabase, {
      session_id, modo, target_url: targetUrl,
      host: req.headers.host, proto: req.headers['x-forwarded-proto'] as string | undefined,
    });

    // 3. Buscar grupo WhatsApp: usa o grupo_jid salvo na sessão se existir,
    // senão cai pra busca por nome (fluxo legado).
    const grupoJid = (session as { grupo_jid?: string | null }).grupo_jid;
    const group = grupoJid
      ? { id: grupoJid, subject: `(grupo salvo) ${session.empresa_nome}` }
      : await findGroupByName(session.empresa_nome);
    if (!group) {
      return res.status(404).json({
        error: 'group_not_found',
        message: `Nenhum grupo WhatsApp encontrado pra "${session.empresa_nome}". Esperado padrão "Pipeelo & ${session.empresa_nome}" (ou variantes "e", "-", "+"). Confira o nome do grupo na instância Avisos.`,
      });
    }

    // 4. Mandar mensagem
    const messageText = WELCOME_TEMPLATE(shortUrl);
    await sendText(group.id, messageText);

    return res.status(200).json({
      ok: true,
      group: { id: group.id, name: group.subject, size: group.size },
      short_url: shortUrl,
      message_preview: messageText,
    });
  } catch (e: unknown) {
    if (e instanceof AdminAuthError) return res.status(e.status).json({ error: e.message });
    if (e instanceof EvolutionConfigError) {
      console.error('[whatsapp-send-welcome] config:', e.message);
      return res.status(503).json({ error: 'evolution_unconfigured', message: e.message });
    }
    if (e instanceof EvolutionApiError) {
      console.error('[whatsapp-send-welcome] evolution:', e.status, e.message);
      return res.status(502).json({ error: 'evolution_error', status: e.status, detail: e.message });
    }
    console.error('[whatsapp-send-welcome]', e);
    return res.status(500).json({ error: 'internal' });
  }
}
