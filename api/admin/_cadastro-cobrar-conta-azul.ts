import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { assertAdminUser, AdminAuthError } from '../_lib/admin-auth';
import { getServiceSupabase } from '../_lib/supabase';
import { CadastroSchema } from '../_lib/schemas/cadastro';
import { criarClienteContaAzul, type SessaoCobranca } from '../_lib/conta-azul';

const Body = z.object({
  session_id: z.string().min(1),
  force: z.boolean().optional(),
  /** Data do go-live. Só grava na sessão (o contrato lê daí); não gera cobrança. */
  go_live_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').optional(),
});

/**
 * POST /api/admin/cadastro-cobrar-conta-azul — cria SÓ o cliente no Conta Azul
 * (pessoa com os dados do cadastro). Botão de reprocesso do `/admin`. O nome da
 * rota ficou do tempo em que também cobrava: desde 15/09/2026 implantação e 1ª
 * mensalidade proporcional são lançadas à mão.
 *
 * Sessão com cliente já criado responde 409 `ja_criado`. Com `force: true` no
 * corpo, refaz (o site reaproveita a pessoa pelo CNPJ).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    await assertAdminUser(req);
    const { session_id, force, go_live_em } = Body.parse(req.body);
    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from('onboarding_sessions')
      .select('id, slug, go_live_em, contrato_extracao, ca_cliente_id, cadastro, cadastro_enviado_at')
      .eq('id', session_id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'session_not_found' });
    if (!data.cadastro_enviado_at || !data.cadastro) return res.status(409).json({ error: 'cadastro_nao_enviado' });
    if (data.ca_cliente_id && force !== true) {
      return res.status(409).json({ error: 'ja_criado', ca_cliente_id: data.ca_cliente_id });
    }

    // Go-live informado agora fica gravado (o contrato lê daí).
    if (go_live_em && go_live_em !== data.go_live_em) {
      const { error: erroGoLive } = await supabase
        .from('onboarding_sessions')
        .update({ go_live_em })
        .eq('id', session_id);
      if (erroGoLive) return res.status(500).json({ error: erroGoLive.message });
      data.go_live_em = go_live_em;
    }

    const cadastro = CadastroSchema.parse(data.cadastro);
    // force: libera a trava de "já criado" para o reprocesso passar.
    if (data.ca_cliente_id && force === true) {
      const { error: erroForce } = await supabase
        .from('onboarding_sessions')
        .update({ ca_cliente_id: null })
        .eq('id', session_id);
      if (erroForce) return res.status(500).json({ error: erroForce.message });
    }
    const cobranca = await criarClienteContaAzul(supabase, data as SessaoCobranca, cadastro);
    return res.status(200).json({ ok: true, cobranca });
  } catch (e: unknown) {
    if (e instanceof AdminAuthError) return res.status(e.status).json({ error: e.message });
    const err = e as { name?: string; flatten?: () => unknown };
    if (err.name === 'ZodError') return res.status(400).json({ error: 'invalid_payload', details: err.flatten?.() });
    console.error('[admin/cadastro-cobrar-conta-azul]', e);
    return res.status(500).json({ error: 'internal' });
  }
}
