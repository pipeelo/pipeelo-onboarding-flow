import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { assertAdminUser, AdminAuthError } from '../_lib/admin-auth';
import { getServiceSupabase } from '../_lib/supabase';
import { sendTransactionalEmail } from '../_lib/email-sender';

const ERP_OPTIONS = ['IXC', 'SGP', 'MK Solution', 'RBX', 'Topp Sap', 'Hubsoft', 'Voalle', 'Outros'] as const;
const MAPAS_OPTIONS = ['OZMap', 'Geogrid', 'Geosite', 'IXC Maps', 'KMZ (Google Maps)', 'Outros'] as const;
const REDE_OPTIONS = ['Smart OLT', 'Anlix', 'OLT Cloud', 'Made 4 Graph', 'IXC-ACS', 'Outros'] as const;
const GATEWAY_OPTIONS = ['7AZ (Bemobi)', 'Outros'] as const;

const optionalEnum = <T extends readonly [string, ...string[]]>(vals: T) =>
  z.enum(vals).optional().or(z.literal('').transform(() => undefined)).or(z.null().transform(() => undefined));

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const optionalIsoDate = z
  .string()
  .regex(ISO_DATE, 'formato de data inválido (YYYY-MM-DD)')
  .optional()
  .nullable()
  .or(z.literal('').transform(() => undefined));

const Body = z.object({
  empresa_nome: z.string().min(2).max(160),
  ceo_email: z.string().email().optional().or(z.literal('').transform(() => undefined)),
  erp: optionalEnum(ERP_OPTIONS),
  mapas: optionalEnum(MAPAS_OPTIONS),
  gerenciamento_rede: optionalEnum(REDE_OPTIONS),
  gateway_pagamento: optionalEnum(GATEWAY_OPTIONS),
  modo: z.enum(['completo', 'comercial']).optional().default('completo'),
  contratou_crm: z.boolean().optional().default(false),
  // Dados comerciais do deal — opcionais, vão no payload final (session.comercial)
  valor_sessao: z.number().positive().max(99999999.99).optional().nullable(),
  qtd_sessoes: z.number().int().positive().max(100000000).optional().nullable(),
  valor_mensal: z.number().positive().max(9999999999.99).optional().nullable(),
  dia_vencimento: z.number().int().min(1).max(31).optional().nullable(),
  observacoes: z.string().max(4000).optional().nullable(),
  // Valores do fechamento — implantação + 1ª mensalidade (Design pós-cadastro, decisão 4)
  valor_implantacao: z.number().nonnegative().max(99999999.99).optional().nullable(),
  implantacao_vencimento: optionalIsoDate,
  primeira_mensalidade_em: optionalIsoDate,
});

/**
 * POST /api/admin/sessions-create
 *   Auth: Bearer <supabase-jwt>
 *   body: { empresa_nome, ceo_email? }
 *   201: { session: SessionRow }
 *   400 invalid_payload | 401 unauthorized | 500
 *
 * Variante admin de create — não exige CNPJ (gerência manual de links).
 * O CNPJ pode ser preenchido depois pelo cliente em Identificação.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    await assertAdminUser(req);
    const body = Body.parse(req.body);
    const supabase = getServiceSupabase();
    const slug = nanoid(12);
    const access_token = nanoid(32);

    const isComercial = body.modo === 'comercial';
    // Modo comercial só pede Identificação + Vendas; outros 3 deptos
    // ficam como 'nao_aplicavel' e não entram na contagem de progresso.
    const statusDeptoExtra = isComercial ? 'nao_aplicavel' : 'pendente';

    const { data, error } = await supabase
      .from('onboarding_sessions')
      .insert({
        slug,
        access_token,
        empresa_nome: body.empresa_nome,
        ceo_email: body.ceo_email ?? null,
        erp: body.erp ?? null,
        mapas: body.mapas ?? null,
        gerenciamento_rede: body.gerenciamento_rede ?? null,
        gateway_pagamento: body.gateway_pagamento ?? null,
        modo: body.modo,
        // Modo comercial JÁ é CRM por definição; no completo é escolha do admin.
        contratou_crm: isComercial ? true : body.contratou_crm,
        valor_sessao: body.valor_sessao ?? null,
        qtd_sessoes: body.qtd_sessoes ?? null,
        valor_mensal: body.valor_mensal ?? null,
        dia_vencimento: body.dia_vencimento ?? null,
        observacoes: body.observacoes?.trim() || null,
        valor_implantacao: body.valor_implantacao ?? null,
        implantacao_vencimento: body.implantacao_vencimento ?? null,
        primeira_mensalidade_em: body.primeira_mensalidade_em ?? null,
        status_identificacao: 'pendente',
        status_sac_geral: statusDeptoExtra,
        status_financeiro: statusDeptoExtra,
        status_suporte: statusDeptoExtra,
        status_vendas: 'pendente',
      })
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Plan 05-02 / UI-04: dispara WelcomeCEO assíncrono se ceo_email presente.
    // Não bloqueia create — falha de email cai em retry manual via painel
    // (Plan 05-03). Idempotente via email_log (Pitfall 7).
    const created = data as {
      id: string;
      slug: string;
      access_token: string;
      ceo_email: string | null;
      empresa_nome: string;
    };
    if (created?.ceo_email) {
      const baseUrl =
        process.env.PUBLIC_APP_URL ??
        process.env.ONBOARDING_BASE_URL ??
        'https://onboarding.pipeelo.com';
      void sendTransactionalEmail({
        template: 'WelcomeCEO',
        sessionId: created.id,
        to: created.ceo_email,
        props: {
          ceoNome: 'CEO',
          empresaNome: created.empresa_nome,
          magicLink: `${baseUrl}/?session=${created.slug}&token=${created.access_token}`,
        },
      }).catch((err) => {
        console.error('[admin/sessions-create] welcome email failed', {
          sessionId: created.id,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }

    return res.status(201).json({ session: data });
  } catch (e: unknown) {
    if (e instanceof AdminAuthError) return res.status(e.status).json({ error: e.message });
    const err = e as { name?: string; flatten?: () => unknown };
    if (err.name === 'ZodError')
      return res.status(400).json({ error: 'invalid_payload', details: err.flatten?.() });
    console.error('[admin/sessions-create]', e);
    return res.status(500).json({ error: 'internal' });
  }
}
