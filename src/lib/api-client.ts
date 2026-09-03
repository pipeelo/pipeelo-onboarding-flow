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
  // `keepalive` garante o autosave durante pagehide, mas o Chrome limita o corpo
  // de requisições keepalive a 64 KB — upload de arquivo precisa desligar isso.
  const r = await fetch(path, {
    keepalive: true,
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
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
  // Valores do fechamento — implantação + 1ª mensalidade (pós-cadastro)
  valor_implantacao?: number | string | null;
  implantacao_vencimento?: string | null;
  primeira_mensalidade_em?: string | null;
  // Contrato automático + Conta Azul (pós-cadastro)
  contrato_path?: string | null;
  contrato_gerado_at?: string | null;
  contrato_erro?: string | null;
  ca_cliente_id?: string | null;
  ca_implantacao_url?: string | null;
  ca_mensalidade_url?: string | null;
  ca_cobrado_at?: string | null;
  ca_erro?: string | null;
  assinatura_status?: string | null;
  // Assinatura pela AssinaPDF
  contrato_pdf_path?: string | null;
  assinapdf_solicitacao_id?: number | null;
  assinapdf_link?: string | null;
  assinapdf_estado?: string | null;
  assinatura_enviada_at?: string | null;
  assinatura_assinada_at?: string | null;
  assinatura_finalizada_at?: string | null;
  assinatura_erro?: string | null;
  contrato_assinado_path?: string | null;
  cadastro?: Record<string, unknown> | null;
  cadastro_enviado_at?: string | null;
  grupo_jid?: string | null;
  grupo_invite_url?: string | null;
  grupo_criado_at?: string | null;
  grupo_erro?: string | null;
  notificacao_boas_vindas_enviada_at?: string | null;
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

export type ResultadoContratoDTO =
  | { status: 'gerado'; path: string; pdf_path?: string | null; representante: string; avisos: string[] }
  | { status: 'pendente'; motivo: string; faltando: string[] };

export type ResultadoAssinaturaDTO =
  | { status: 'enviado'; solicitacao_id: number; link: string; dm: boolean; grupo: boolean; reenvio: boolean }
  | { status: 'pendente'; motivo: string };

export type AssinaturaSignerDocDTO = { doc: string; file: string; campo: string; url: string | null };
export type AssinaturaSignerDTO = {
  id: number;
  posicao_cli: number;
  nome_cli: string;
  estado: string;
  nome: string;
  cpf: string;
  telefone?: string | null;
  assinatura_url?: string | null;
  documentos: AssinaturaSignerDocDTO[];
  localizacao?: string | null;
  ip?: string | null;
  dispositivo?: string | null;
  sisop?: string | null;
  dta?: string | null;
};
export type AssinaturaDetalhesDTO = {
  ok: true;
  estado: string;
  status: string | null;
  link: string | null;
  signers: AssinaturaSignerDTO[];
};

export type ResultadoCobrancaDTO =
  | { status: 'cobrado'; implantacao_url: string | null; mensalidade_url: string | null; recorrente: boolean }
  | { status: 'pendente'; motivo: string };

export type ResultadoGrupoDTO =
  | { status: 'criado'; jid: string; invite_url: string | null; nao_adicionados: string[]; erros?: string[]; equipe_pipeelo?: { adicionados: number; total: number } }
  // O grupo nasce em ritmo humano, em background: no envio do cadastro ele ainda
  // não existe. Recarregar a página depois mostra o link.
  | { status: 'em_andamento' }
  | { status: 'erro'; motivo: string };

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
    departamento: DepartamentoId | 'cadastro';
    pergunta_id: string;
    nome: string;
    content_type?: string;
    base64: string;
  }) =>
    api<{ path: string; nome_original: string; tamanho: number }>(
      '/api/sessions/upload-arquivo',
      // Sem keepalive: corpo em base64 passa fácil dos 64 KB que o Chrome permite.
      { method: 'POST', body: JSON.stringify(input), keepalive: false }
    ),

  cnpjLookup: (input: { slug: string; token: string; cnpj: string }) =>
    api<{ razao_social: string; nome_fantasia: string }>('/api/sessions/cnpj-lookup', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  sendMagicLink: (slug: string) =>
    api<{ ok: true; link_preview?: string }>('/api/sessions/send-magic-link', {
      method: 'POST',
      body: JSON.stringify({ slug }),
    }),

  cadastroSubmit: (input: { slug: string; token: string; cadastro: Record<string, unknown> }) =>
    api<{ ok: true; grupo: ResultadoGrupoDTO }>('/api/sessions/cadastro-submit', {
      method: 'POST',
      body: JSON.stringify(input),
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
  valor_implantacao?: number | null;
  implantacao_vencimento?: string | null;
  primeira_mensalidade_em?: string | null;
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
      valor_implantacao?: number;
      implantacao_vencimento?: string;
      primeira_mensalidade_em?: string;
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

  recriarGrupo: (authToken: string, session_id: string) =>
    adminApi<{ ok: true; grupo: ResultadoGrupoDTO }>('/api/admin/cadastro-recriar-grupo', authToken, {
      method: 'POST',
      body: JSON.stringify({ session_id }),
    }),

  gerarContrato: (authToken: string, session_id: string) =>
    adminApi<{ ok: true; contrato: ResultadoContratoDTO }>('/api/admin/cadastro-gerar-contrato', authToken, {
      method: 'POST',
      body: JSON.stringify({ session_id }),
    }),

  cobrarContaAzul: (authToken: string, session_id: string) =>
    adminApi<{ ok: true; cobranca: ResultadoCobrancaDTO }>('/api/admin/cadastro-cobrar-conta-azul', authToken, {
      method: 'POST',
      body: JSON.stringify({ session_id }),
    }),

  /** Link assinado (60 min) do contrato no bucket privado (`docx`, `pdf` ou `assinado`). */
  contratoDownloadUrl: (authToken: string, session_id: string, tipo: 'docx' | 'pdf' | 'assinado' = 'docx') =>
    adminApi<{ url: string }>(
      `/api/admin/contrato-download?session_id=${encodeURIComponent(session_id)}&tipo=${tipo}`,
      authToken
    ),

  enviarAssinatura: (authToken: string, session_id: string, apenas_reenviar = false) =>
    adminApi<{ ok: true; assinatura: ResultadoAssinaturaDTO }>('/api/admin/assinatura-enviar', authToken, {
      method: 'POST',
      body: JSON.stringify({ session_id, apenas_reenviar }),
    }),

  assinaturaDetalhes: (authToken: string, session_id: string) =>
    adminApi<AssinaturaDetalhesDTO>(
      `/api/admin/assinatura-detalhes?session_id=${encodeURIComponent(session_id)}`,
      authToken
    ),

  aprovarAssinatura: (authToken: string, session_id: string) =>
    adminApi<{ ok: true }>('/api/admin/assinatura-aprovar', authToken, {
      method: 'POST',
      body: JSON.stringify({ acao: 'aprovar', session_id }),
    }),

  corrigirAssinatura: (authToken: string, session_id: string, motivo: string, itens: string[]) =>
    adminApi<{ ok: true }>('/api/admin/assinatura-aprovar', authToken, {
      method: 'POST',
      body: JSON.stringify({ acao: 'corrigir', session_id, motivo, itens }),
    }),
};
