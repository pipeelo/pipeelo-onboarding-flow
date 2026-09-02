import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { assertAdminUser, AdminAuthError } from '../_lib/admin-auth';
import { getServiceSupabase } from '../_lib/supabase';
import { CadastroSchema } from '../_lib/schemas/cadastro';
import { gerarContratoParaSessao } from '../_lib/contrato';
import type { SessaoContrato } from '../_lib/contrato/campos';

const Body = z.object({ session_id: z.string().min(1) });

/**
 * POST /api/admin/cadastro-gerar-contrato — regera o contrato da sessão com o
 * cadastro salvo. Sempre refaz (a leitura dos documentos e o `.docx` são
 * sobrescritos), para servir de botão de reprocesso no `/admin`.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    await assertAdminUser(req);
    const { session_id } = Body.parse(req.body);
    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from('onboarding_sessions')
      .select('id, slug, empresa_nome, erp, contratou_crm, valor_sessao, qtd_sessoes, valor_mensal, dia_vencimento, valor_implantacao, implantacao_vencimento, primeira_mensalidade_em, cadastro, cadastro_enviado_at')
      .eq('id', session_id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'session_not_found' });
    if (!data.cadastro_enviado_at || !data.cadastro) return res.status(409).json({ error: 'cadastro_nao_enviado' });

    const cadastro = CadastroSchema.parse(data.cadastro);
    const contrato = await gerarContratoParaSessao(supabase, data as SessaoContrato, cadastro);
    return res.status(200).json({ ok: true, contrato });
  } catch (e: unknown) {
    if (e instanceof AdminAuthError) return res.status(e.status).json({ error: e.message });
    const err = e as { name?: string; flatten?: () => unknown };
    if (err.name === 'ZodError') return res.status(400).json({ error: 'invalid_payload', details: err.flatten?.() });
    console.error('[admin/cadastro-gerar-contrato]', e);
    return res.status(500).json({ error: 'internal' });
  }
}
