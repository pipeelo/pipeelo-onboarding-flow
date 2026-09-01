import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { assertAdminUser, AdminAuthError } from '../_lib/admin-auth';
import { getServiceSupabase } from '../_lib/supabase';
import { CadastroSchema } from '../_lib/schemas/cadastro';
import { criarGrupoParaSessao, type SessaoGrupo } from '../_lib/cadastro-grupo';

const Body = z.object({ session_id: z.string().min(1) });

/** POST /api/admin/cadastro-recriar-grupo — reexecuta a criação do grupo com o cadastro salvo. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    await assertAdminUser(req);
    const { session_id } = Body.parse(req.body);
    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from('onboarding_sessions')
      .select('id, slug, access_token, empresa_nome, modo, cadastro, cadastro_enviado_at, grupo_jid, notificacao_boas_vindas_enviada_at')
      .eq('id', session_id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'session_not_found' });
    if (!data.cadastro_enviado_at || !data.cadastro) return res.status(409).json({ error: 'cadastro_nao_enviado' });

    const cadastro = CadastroSchema.parse(data.cadastro);
    const grupo = await criarGrupoParaSessao(supabase, data as SessaoGrupo, cadastro, {
      host: req.headers.host,
      proto: req.headers['x-forwarded-proto'] as string | undefined,
    });
    return res.status(200).json({ ok: true, grupo });
  } catch (e: unknown) {
    if (e instanceof AdminAuthError) return res.status(e.status).json({ error: e.message });
    const err = e as { name?: string; flatten?: () => unknown };
    if (err.name === 'ZodError') return res.status(400).json({ error: 'invalid_payload', details: err.flatten?.() });
    console.error('[admin/cadastro-recriar-grupo]', e);
    return res.status(500).json({ error: 'internal' });
  }
}
