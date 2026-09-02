import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { assertAdminUser, AdminAuthError } from '../_lib/admin-auth';
import { getServiceSupabase } from '../_lib/supabase';
import { CadastroSchema } from '../_lib/schemas/cadastro';
import { enviarParaAssinatura, type SessaoAssinatura } from '../_lib/assinatura';

const Body = z.object({ session_id: z.string().min(1), apenas_reenviar: z.boolean().optional() });

export const SELECT_ASSINATURA =
  'id, slug, empresa_nome, cadastro, cadastro_enviado_at, contrato_path, contrato_pdf_path, contrato_extracao, assinapdf_solicitacao_id, assinapdf_link, assinapdf_estado, assinatura_status, assinatura_erro, grupo_jid';

/**
 * POST /api/admin/assinatura-enviar { session_id, apenas_reenviar? }
 * Cria a solicitação na AssinaPDF (se ainda não existe), anexa o PDF e manda o
 * link. Com `apenas_reenviar` só repete as mensagens com o link já salvo.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    await assertAdminUser(req);
    const { session_id, apenas_reenviar } = Body.parse(req.body);
    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from('onboarding_sessions')
      .select(SELECT_ASSINATURA)
      .eq('id', session_id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'session_not_found' });
    if (!data.cadastro_enviado_at || !data.cadastro) return res.status(409).json({ error: 'cadastro_nao_enviado' });
    if (!data.contrato_pdf_path) return res.status(409).json({ error: 'contrato_nao_gerado' });

    const cadastro = CadastroSchema.parse(data.cadastro);
    const assinatura = await enviarParaAssinatura(supabase, data as SessaoAssinatura, cadastro, { apenasReenviar: apenas_reenviar });
    return res.status(200).json({ ok: true, assinatura });
  } catch (e: unknown) {
    if (e instanceof AdminAuthError) return res.status(e.status).json({ error: e.message });
    const err = e as { name?: string; flatten?: () => unknown };
    if (err.name === 'ZodError') return res.status(400).json({ error: 'invalid_payload', details: err.flatten?.() });
    console.error('[admin/assinatura-enviar]', e);
    return res.status(500).json({ error: 'internal' });
  }
}
