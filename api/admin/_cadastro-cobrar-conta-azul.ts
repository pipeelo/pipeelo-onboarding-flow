import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { assertAdminUser, AdminAuthError } from '../_lib/admin-auth';
import { getServiceSupabase } from '../_lib/supabase';
import { CadastroSchema } from '../_lib/schemas/cadastro';
import { cobrarContaAzul, type SessaoCobranca } from '../_lib/conta-azul';

const Body = z.object({ session_id: z.string().min(1), force: z.boolean().optional() });

/**
 * POST /api/admin/cadastro-cobrar-conta-azul — cria o cliente e as cobranças no
 * Conta Azul com os valores do fechamento. Botão de reprocesso do `/admin`.
 *
 * Sessão já cobrada responde 409 `ja_cobrado`: cobrar de novo geraria boleto
 * duplicado. Com `force: true` no corpo, refaz mesmo assim.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    await assertAdminUser(req);
    const { session_id, force } = Body.parse(req.body);
    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from('onboarding_sessions')
      .select('id, slug, valor_implantacao, implantacao_vencimento, valor_mensal, primeira_mensalidade_em, dia_vencimento, contrato_extracao, ca_cobrado_at, cadastro, cadastro_enviado_at')
      .eq('id', session_id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'session_not_found' });
    if (!data.cadastro_enviado_at || !data.cadastro) return res.status(409).json({ error: 'cadastro_nao_enviado' });
    if (data.ca_cobrado_at && force !== true) {
      return res.status(409).json({ error: 'ja_cobrado', ca_cobrado_at: data.ca_cobrado_at });
    }

    const cadastro = CadastroSchema.parse(data.cadastro);
    const cobranca = await cobrarContaAzul(supabase, data as SessaoCobranca, cadastro);
    return res.status(200).json({ ok: true, cobranca });
  } catch (e: unknown) {
    if (e instanceof AdminAuthError) return res.status(e.status).json({ error: e.message });
    const err = e as { name?: string; flatten?: () => unknown };
    if (err.name === 'ZodError') return res.status(400).json({ error: 'invalid_payload', details: err.flatten?.() });
    console.error('[admin/cadastro-cobrar-conta-azul]', e);
    return res.status(500).json({ error: 'internal' });
  }
}
