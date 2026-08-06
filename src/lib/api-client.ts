/**
 * API Client tipado para /api/sessions/*.
 * Substitui call sites diretos `supabase.from('onboarding_*')` (HARD-01).
 *
 * Todos os requests usam `keepalive: true` — crítico para autosave debounced
 * que pode disparar durante `pagehide`/`beforeunload` (Pitfall 6).
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    keepalive: true,
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({} as { error?: string; code?: string }));
    throw new ApiError(r.status, body.error ?? r.statusText, body.code);
  }
  return r.json() as Promise<T>;
}

export type SessionDTO = {
  id: string;
  slug: string;
  empresa_nome: string;
  status_identificacao: string | null;
  status_sac_geral: string | null;
  status_financeiro: string | null;
  status_suporte: string | null;
  status_vendas: string | null;
  modo?: 'completo' | 'comercial' | null;
  responsavel_identificacao?: string | null;
  responsavel_sac_geral?: string | null;
  responsavel_financeiro?: string | null;
  responsavel_suporte?: string | null;
  responsavel_vendas?: string | null;
  concluido_identificacao_at?: string | null;
  concluido_sac_geral_at?: string | null;
  concluido_financeiro_at?: string | null;
  concluido_suporte_at?: string | null;
  concluido_vendas_at?: string | null;
  tenant_id?: string | null;
  ceo_email?: string | null;
  erp?: string | null;
  mapas?: string | null;
  gerenciamento_rede?: string | null;
  gateway_pagamento?: string | null;
  contratou_crm?: boolean | null;
  valor_sessao?: number | string | null;
  qtd_sessoes?: number | null;
  valor_mensal?: number | string | null;
  dia_vencimento?: number | null;
  observacoes?: string | null;
  created_at?: string;
  updated_at?: string;
  [k: string]: unknown;
};

export type RespostaDTO = {
  departamento: string;
  pergunta_id: string;
  valor: unknown;
  updated_at: string;
};

export type DepartamentoId =
  | 'identificacao'
  | 'sac_geral'
  | 'financeiro'
  | 'suporte'
  | 'vendas';

export const sessionApi = {
  create: (input: { empresa_nome: string; cnpj: string; turnstileToken: string }) =>
    api<{ slug: string; access_token: string }>('/api/sessions/create', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  get: (slug: string, token: string) =>
    api<{ session: SessionDTO; respostas: RespostaDTO[] }>(
      `/api/sessions/get?slug=${encodeURIComponent(slug)}&token=${encodeURIComponent(token)}`
    ),

  saveResposta: (input: {
    slug: string;
    token: string;
    departamento: DepartamentoId;
    pergunta_id: string;
    valor: unknown;
  }) =>
    api<{ ok: true; saved_at: string }>('/api/sessions/save-resposta', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  completeDepartment: (input: {
    slug: string;
    token: string;
    departamento: DepartamentoId;
    responsavel_nome: string;
  }) =>
    api<{ ok: true }>('/api/sessions/complete-department', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  uploadArquivo: (input: {
    slug: string;
    token: string;
    departamento: DepartamentoId;
    pergunta_id: string;
    nome: string;
    content_type?: string;
    base64: string;
  }) =>
    api<{ path: string; nome_original: string; tamanho: number }>(
      '/api/sessions/upload-arquivo',
      { method: 'POST', body: JSON.stringify(input) }
    ),

  sendMagicLink: (slug: string) =>
    api<{ ok: true; link_preview?: string }>('/api/sessions/send-magic-link', {
      method: 'POST',
      body: JSON.stringify({ slug }),
    }),
};

/**
 * API client para endpoints `/api/admin/*` — sempre envia Bearer JWT do
 * Supabase Auth (validação server-side via assertAdminUser).
 */
async function adminApi<T>(
  path: string,
  authToken: string,
  init?: RequestInit
): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({} as { error?: string; code?: string }));
    throw new ApiError(r.status, body.error ?? r.statusText, body.code);
  }
  return r.json() as Promise<T>;
}

export type StackPatch = {
  erp?: string | null;
  mapas?: string | null;
  gerenciamento_rede?: string | null;
  gateway_pagamento?: string | null;
  contratou_crm?: boolean;
};

export type ComercialPatch = {
  valor_sessao?: number | null;
  qtd_sessoes?: number | null;
  valor_mensal?: number | null;
  dia_vencimento?: number | null;
  observacoes?: string | null;
};

export const ERP_OPTIONS = ['IXC', 'SGP', 'MK Solution', 'RBX', 'Topp Sap', 'Hubsoft', 'Voalle', 'Outros'] as const;
export const MAPAS_OPTIONS = ['OZMap', 'Geogrid', 'Geosite', 'IXC Maps', 'KMZ (Google Maps)', 'Outros'] as const;
export const REDE_OPTIONS = ['Smart OLT', 'Anlix', 'OLT Cloud', 'Made 4 Graph', 'IXC-ACS', 'Outros'] as const;
export const GATEWAY_OPTIONS = ['7AZ (Bemobi)', 'Outros'] as const;

export const adminSessionApi = {
  list: (authToken: string) =>
    adminApi<{ sessions: SessionDTO[] }>('/api/admin/sessions-list', authToken),

  create: (
    authToken: string,
    input: {
      empresa_nome: string;
      ceo_email?: string;
      erp?: string;
      mapas?: string;
      gerenciamento_rede?: string;
      gateway_pagamento?: string;
      modo?: 'completo' | 'comercial';
      contratou_crm?: boolean;
      valor_sessao?: number;
      qtd_sessoes?: number;
      valor_mensal?: number;
      dia_vencimento?: number;
      observacoes?: string;
    }
  ) =>
    adminApi<{ session: SessionDTO }>('/api/admin/sessions-create', authToken, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  update: (authToken: string, session_id: string, patch: StackPatch & ComercialPatch) =>
    adminApi<{ session: SessionDTO }>('/api/admin/sessions-update', authToken, {
      method: 'POST',
      body: JSON.stringify({ session_id, ...patch }),
    }),

  delete: (authToken: string, session_id: string) =>
    adminApi<{ ok: true }>('/api/admin/sessions-delete', authToken, {
      method: 'POST',
      body: JSON.stringify({ session_id }),
    }),

  createShortLink: (
    authToken: string,
    input: { session_id: string; modo: 'completo' | 'comercial'; target_url: string }
  ) =>
    adminApi<{ code: string; short_url: string }>(
      '/api/admin/short-links-create',
      authToken,
      {
        method: 'POST',
        body: JSON.stringify(input),
      }
    ),

  sendWelcomeWhatsApp: (
    authToken: string,
    input: { session_id: string; modo: 'completo' | 'comercial' }
  ) =>
    adminApi<{
      ok: true;
      group: { id: string; name: string; size?: number };
      short_url: string;
      message_preview: string;
    }>('/api/admin/whatsapp-send-welcome', authToken, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
