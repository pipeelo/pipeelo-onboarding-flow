import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { assertAdminUser, AdminAuthError } from '../_lib/admin-auth';
import { getServiceSupabase } from '../_lib/supabase';

const ERP_OPTIONS = ['IXC', 'SGP', 'MK Solution', 'RBX', 'Topp Sap', 'Hubsoft', 'Voalle', 'Outros'] as const;
const MAPAS_OPTIONS = ['OZMap', 'Geogrid', 'Geosite', 'IXC Maps', 'KMZ (Google Maps)', 'Outros'] as const;
const REDE_OPTIONS = ['Smart OLT', 'Anlix', 'OLT Cloud', 'Made 4 Graph', 'IXC-ACS', 'Outros'] as const;
const GATEWAY_OPTIONS = ['7AZ (Bemobi)', 'Outros'] as const;

const nullableEnum = <T extends readonly [string, ...string[]]>(vals: T) =>
  z.enum(vals).nullable().or(z.literal('').transform(() => null));

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const nullableIsoDate = z
  .string()
  .regex(ISO_DATE, 'formato de data inválido (YYYY-MM-DD)')
  .nullable()
  .or(z.literal('').transform(() => null));

const Body = z.object({
  session_id: z.string().uuid(),
  erp: nullableEnum(ERP_OPTIONS).optional(),
  mapas: nullableEnum(MAPAS_OPTIONS).optional(),
  gerenciamento_rede: nullableEnum(REDE_OPTIONS).optional(),
  gateway_pagamento: nullableEnum(GATEWAY_OPTIONS).optional(),
  contratou_crm: z.boolean().optional(),
  // Dados comerciais — `null` limpa o campo (mesma semântica da stack)
  valor_sessao: z.number().positive().max(99999999.99).nullable().optional(),
  qtd_sessoes: z.number().int().positive().max(100000000).nullable().optional(),
  valor_mensal: z.number().positive().max(9999999999.99).nullable().optional(),
  dia_vencimento: z.number().int().min(1).max(31).nullable().optional(),
  observacoes: z.string().max(4000).nullable().optional(),
  // Valores do fechamento — implantação + 1ª mensalidade (Design pós-cadastro, decisão 4)
  valor_implantacao: z.number().positive().max(99999999.99).nullable().optional(),
  implantacao_vencimento: nullableIsoDate.optional(),
  primeira_mensalidade_em: nullableIsoDate.optional(),
});

/**
 * POST /api/admin/sessions-update
 *   Auth: Bearer <supabase-jwt>
 *   body: { session_id, erp?, mapas?, gerenciamento_rede? }
 *   200: { session: SessionRow }
 *
 * Atualiza a stack tecnológica (campos preenchidos pelo admin).
 * Passe `null` ou string vazia para limpar um campo.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    await assertAdminUser(req);
    const body = Body.parse(req.body);
    const supabase = getServiceSupabase();

    const patch: Record<string, string | boolean | number | null> = {};
    if ('erp' in body) patch.erp = body.erp ?? null;
    if ('mapas' in body) patch.mapas = body.mapas ?? null;
    if ('gerenciamento_rede' in body) patch.gerenciamento_rede = body.gerenciamento_rede ?? null;
    if ('gateway_pagamento' in body) patch.gateway_pagamento = body.gateway_pagamento ?? null;
    if ('contratou_crm' in body && typeof body.contratou_crm === 'boolean')
      patch.contratou_crm = body.contratou_crm;
    if ('valor_sessao' in body) patch.valor_sessao = body.valor_sessao ?? null;
    if ('qtd_sessoes' in body) patch.qtd_sessoes = body.qtd_sessoes ?? null;
    if ('valor_mensal' in body) patch.valor_mensal = body.valor_mensal ?? null;
    if ('dia_vencimento' in body) patch.dia_vencimento = body.dia_vencimento ?? null;
    if ('observacoes' in body) patch.observacoes = body.observacoes?.trim() || null;
    if ('valor_implantacao' in body) patch.valor_implantacao = body.valor_implantacao ?? null;
    if ('implantacao_vencimento' in body)
      patch.implantacao_vencimento = body.implantacao_vencimento ?? null;
    if ('primeira_mensalidade_em' in body)
      patch.primeira_mensalidade_em = body.primeira_mensalidade_em ?? null;

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'no_fields_to_update' });
    }

    const { data, error } = await supabase
      .from('onboarding_sessions')
      .update(patch)
      .eq('id', body.session_id)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ session: data });
  } catch (e: unknown) {
    if (e instanceof AdminAuthError) return res.status(e.status).json({ error: e.message });
    const err = e as { name?: string; flatten?: () => unknown };
    if (err.name === 'ZodError')
      return res.status(400).json({ error: 'invalid_payload', details: err.flatten?.() });
    console.error('[admin/sessions-update]', e);
    return res.status(500).json({ error: 'internal' });
  }
}
