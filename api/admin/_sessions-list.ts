import type { VercelRequest, VercelResponse } from '@vercel/node';
import { assertAdminUser, AdminAuthError } from '../_lib/admin-auth';
import { getServiceSupabase } from '../_lib/supabase';

/**
 * GET /api/admin/sessions-list
 *   Auth: Bearer <supabase-jwt>
 *   200: { sessions: SessionRow[] }
 *   401 unauthorized | 500
 *
 * Lista todas as sessões para o painel admin (HARD-01 server-side).
 *
 * Anexa `fila` com o andamento da entrada da equipe no grupo de WhatsApp. A
 * consulta é tolerante: se a migration da fila ainda não foi aplicada, o painel
 * segue funcionando sem esse dado em vez de quebrar.
 */

type ContagemFila = { pendentes: number; feitos: number; falhados: number; total: number };

async function filaPorSessao(
  supabase: ReturnType<typeof getServiceSupabase>
): Promise<Map<string, ContagemFila>> {
  const porSessao = new Map<string, ContagemFila>();
  const { data, error } = await supabase.from('evolution_fila').select('session_id, status, tipo');
  if (error || !data) {
    if (error) console.warn('[admin/sessions-list] fila indisponível:', error.message);
    return porSessao;
  }
  for (const l of data as Array<{ session_id: string; status: string; tipo: string }>) {
    // O item de resumo é o aviso ao Staff, não trabalho do grupo.
    if (l.tipo === 'resumo') continue;
    const c = porSessao.get(l.session_id) ?? { pendentes: 0, feitos: 0, falhados: 0, total: 0 };
    c.total += 1;
    if (l.status === 'pendente' || l.status === 'processando') c.pendentes += 1;
    else if (l.status === 'feito') c.feitos += 1;
    else if (l.status === 'falhou') c.falhados += 1;
    porSessao.set(l.session_id, c);
  }
  return porSessao;
}
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    await assertAdminUser(req);
    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from('onboarding_sessions')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    const fila = await filaPorSessao(supabase);
    const sessions = (data ?? []).map((s) => ({ ...s, fila: fila.get((s as { id: string }).id) ?? null }));
    return res.status(200).json({ sessions });
  } catch (e: unknown) {
    if (e instanceof AdminAuthError) return res.status(e.status).json({ error: e.message });
    console.error('[admin/sessions-list]', e);
    return res.status(500).json({ error: 'internal' });
  }
}
