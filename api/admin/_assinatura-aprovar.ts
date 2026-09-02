import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { assertAdminUser, AdminAuthError } from '../_lib/admin-auth';
import { getServiceSupabase } from '../_lib/supabase';
import { CadastroSchema } from '../_lib/schemas/cadastro';
import { aprovarAssinatura, pedirCorrecao, type SessaoAssinatura } from '../_lib/assinatura';
import { SELECT_ASSINATURA } from './_assinatura-enviar';

const Body = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('aprovar'), session_id: z.string().min(1) }),
  z.object({
    acao: z.literal('corrigir'),
    session_id: z.string().min(1),
    motivo: z.string().trim().min(3).max(300),
    itens: z.array(z.string().min(1)).default([]),
  }),
]);

/**
 * POST /api/admin/assinatura-aprovar
 *   { acao: 'aprovar', session_id }                 → validate-request, finaliza, guarda o PDF assinado
 *   { acao: 'corrigir', session_id, motivo, itens } → fix-request e avisa o responsável no WhatsApp
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    await assertAdminUser(req);
    const body = Body.parse(req.body);
    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from('onboarding_sessions')
      .select(SELECT_ASSINATURA)
      .eq('id', body.session_id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'session_not_found' });
    if (!data.assinapdf_solicitacao_id) return res.status(409).json({ error: 'assinatura_nao_enviada' });

    const sessao = data as SessaoAssinatura & { empresa_nome?: string | null; cadastro?: unknown };

    if (body.acao === 'aprovar') {
      const r = await aprovarAssinatura(supabase, sessao, { nomeEmpresa: sessao.empresa_nome ?? undefined });
      return res.status(200).json({ ok: true, resultado: r });
    }

    const cadastro = CadastroSchema.parse(sessao.cadastro);
    await pedirCorrecao(supabase, sessao, cadastro, { motivo: body.motivo, itens: body.itens });
    return res.status(200).json({ ok: true, status: 'correcao' });
  } catch (e: unknown) {
    if (e instanceof AdminAuthError) return res.status(e.status).json({ error: e.message });
    const err = e as { name?: string; flatten?: () => unknown };
    if (err.name === 'ZodError') return res.status(400).json({ error: 'invalid_payload', details: err.flatten?.() });
    console.error('[admin/assinatura-aprovar]', e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'internal' });
  }
}
