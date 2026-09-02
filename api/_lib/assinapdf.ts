/**
 * Cliente da API da AssinaPDF (https://wiki.assinapdf.com.br/pt-br/api/solicitacoes).
 *
 * Só existem endpoints de solicitação; empresa, categoria, layout e tipo são
 * configurados no painel e entram por env. Sem webhook: o status é consultado.
 *
 * Estados conhecidos: `pt1` criada → (assinando) → `pt7` aguardando validação → `fin`.
 */

export class AssinaPdfConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssinaPdfConfigError';
  }
}

export class AssinaPdfApiError extends Error {
  constructor(public status: number, public body: string, public endpoint: string) {
    super(`AssinaPDF ${endpoint} → HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = 'AssinaPdfApiError';
  }
}

export type AssinaPdfConfig = {
  baseUrl: string;
  token: string;
  empresaId: number;
  categoriaId: number;
  layoutId: number;
  tipo: string;
};

export function getAssinaPdfConfig(env: NodeJS.ProcessEnv = process.env): AssinaPdfConfig {
  const token = env.ASSINAPDF_TOKEN?.trim();
  if (!token) throw new AssinaPdfConfigError('ASSINAPDF_TOKEN não configurado');
  const baseUrl = (env.ASSINAPDF_BASE_URL?.trim() || 'https://pipeelo.assinapdf.com.br').replace(/\/+$/, '');
  const num = (v: string | undefined, padrao: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : padrao;
  };
  return {
    baseUrl,
    token,
    empresaId: num(env.ASSINAPDF_EMPRESA_ID, 1),
    categoriaId: num(env.ASSINAPDF_CATEGORIA_ID, 2),
    layoutId: num(env.ASSINAPDF_LAYOUT_ID, 2),
    tipo: env.ASSINAPDF_TIPO?.trim() || 'Contratação',
  };
}

export type Solicitacao = {
  id: number;
  estado: string;
  cpfcliente?: string;
  nomecliente?: string;
  documentos?: string;
  telefones?: string | null;
  correcao?: string | null;
  ult_att?: string;
  [k: string]: unknown;
};

export type SignerDoc = { doc: string; file: string; campo: string };

export type Signer = {
  id: number;
  posicao_cli: number;
  nome_cli: string;
  estado: string;
  nome: string;
  cpf: string;
  telefone?: string | null;
  email?: string | null;
  assinatura_url?: string | null;
  documentos?: SignerDoc[] | Record<string, string>;
  localizacao?: string | null;
  ip?: string | null;
  dispositivo?: string | null;
  sisop?: string | null;
  meio_acesso?: string | null;
  dta?: string | null;
};

export type SignerDocs = { solicitacao_id: number; total_signers: number; signers: Signer[] };

type Envelope<T> = { status: string; message?: string; data: T; errors?: unknown; skipped?: unknown };

async function chamar<T>(
  cfg: AssinaPdfConfig,
  endpoint: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<Envelope<T>> {
  const { json, ...rest } = init;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: 'application/json',
    ...((rest.headers as Record<string, string>) ?? {}),
  };
  let body = rest.body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    body = JSON.stringify(json);
  }
  const r = await fetch(`${cfg.baseUrl}/api/v1${endpoint}`, { ...rest, headers, body });
  const texto = await r.text();
  if (!r.ok) throw new AssinaPdfApiError(r.status, texto, endpoint);
  let parsed: Envelope<T>;
  try {
    parsed = JSON.parse(texto) as Envelope<T>;
  } catch {
    throw new AssinaPdfApiError(r.status, `resposta não é JSON: ${texto.slice(0, 120)}`, endpoint);
  }
  if (parsed.status && parsed.status !== 'success') {
    throw new AssinaPdfApiError(r.status, parsed.message ?? texto, endpoint);
  }
  return parsed;
}

export type NovaSolicitacao = {
  cpf: string;
  nome: string;
  endereco: string;
  telefone: string;
  email?: string;
  plano?: string;
};

function digitos(s: string): string {
  return (s || '').replace(/\D/g, '');
}

export async function criarSolicitacao(cfg: AssinaPdfConfig, s: NovaSolicitacao): Promise<Solicitacao> {
  const r = await chamar<Solicitacao>(cfg, '/solicitacoes', {
    method: 'POST',
    json: {
      cpfcliente: digitos(s.cpf),
      nomecliente: s.nome.trim().toUpperCase(),
      enderecocliente: s.endereco.trim(),
      telefone: digitos(s.telefone),
      email: s.email?.trim() || undefined,
      plano: s.plano?.trim() || undefined,
      empresa_id: cfg.empresaId,
      categoria_id: cfg.categoriaId,
      tipo: cfg.tipo,
      permanencia: '0',
    },
  });
  return r.data;
}

export async function anexarPdf(
  cfg: AssinaPdfConfig,
  solicitacaoId: number,
  pdf: Buffer,
  nomeArquivo: string,
): Promise<{ documento: string; layout: string }> {
  const form = new FormData();
  form.append('document', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), nomeArquivo);
  form.append('layout', String(cfg.layoutId));
  const r = await chamar<{ documento: string; layout: string }>(cfg, `/solicitacoes/${solicitacaoId}/add-document`, {
    method: 'POST',
    body: form,
  });
  return r.data;
}

export async function obterLinkInicial(cfg: AssinaPdfConfig, solicitacaoId: number, posicaoCli = 0): Promise<string> {
  const r = await chamar<{ link: string }>(cfg, `/solicitacoes/${solicitacaoId}/get-initial-link`, {
    method: 'POST',
    json: { posicaoCli, meio_acesso: 'w' },
  });
  if (!r.data?.link) throw new AssinaPdfApiError(200, 'resposta sem link', 'get-initial-link');
  return r.data.link;
}

export async function consultarSolicitacao(cfg: AssinaPdfConfig, solicitacaoId: number): Promise<Solicitacao> {
  const r = await chamar<Solicitacao>(cfg, `/solicitacoes/${solicitacaoId}`);
  return r.data;
}

export async function documentosDosAssinantes(cfg: AssinaPdfConfig, solicitacaoId: number): Promise<SignerDocs> {
  const r = await chamar<SignerDocs | unknown[]>(cfg, `/solicitacoes/${solicitacaoId}/signer-docs`);
  // Sem assinante ainda a API devolve `data: []`.
  if (Array.isArray(r.data)) return { solicitacao_id: solicitacaoId, total_signers: 0, signers: [] };
  return r.data;
}

export async function validarSolicitacao(cfg: AssinaPdfConfig, solicitacaoId: number): Promise<unknown> {
  const r = await chamar<unknown>(cfg, `/solicitacoes/${solicitacaoId}/validate-request`, { method: 'POST', json: {} });
  return r.data;
}

export type PedidoCorrecao = { posicao_cli: number; motivo: string; rejected_items: string[]; telefone?: string };

export async function pedirCorrecao(cfg: AssinaPdfConfig, solicitacaoId: number, signers: PedidoCorrecao[]): Promise<unknown> {
  const r = await chamar<unknown>(cfg, `/solicitacoes/${solicitacaoId}/fix-request`, { method: 'POST', json: { signers } });
  return r.data;
}

export async function documentosAssinados(cfg: AssinaPdfConfig, solicitacaoId: number): Promise<string[]> {
  const r = await chamar<string[]>(cfg, `/solicitacoes/${solicitacaoId}/get-signed-documents`);
  return Array.isArray(r.data) ? r.data : [];
}

export async function deletarSolicitacao(cfg: AssinaPdfConfig, solicitacaoId: number): Promise<void> {
  await chamar<unknown>(cfg, `/solicitacoes/${solicitacaoId}`, { method: 'DELETE' });
}

/** Onde a instância serve os arquivos das solicitações (descoberto em 02/09/2026). */
export function urlArquivo(cfg: AssinaPdfConfig, nome: string): string {
  return `${cfg.baseUrl}/img/cliente/${encodeURIComponent(nome)}`;
}

export async function baixarArquivo(cfg: AssinaPdfConfig, nome: string): Promise<Buffer> {
  const r = await fetch(urlArquivo(cfg, nome), { headers: { Authorization: `Bearer ${cfg.token}` } });
  if (!r.ok) throw new AssinaPdfApiError(r.status, await r.text(), `img/cliente/${nome}`);
  return Buffer.from(await r.arrayBuffer());
}

/** Escolhe o PDF final entre os nomes devolvidos por `get-signed-documents`. */
export function escolherAssinado(nomes: string[]): string | null {
  if (!nomes.length) return null;
  const assinados = nomes.filter((n) => /assinado/i.test(n));
  const lista = assinados.length ? assinados : nomes;
  // Com mais de um, o nome mais longo costuma ser o mais processado (`_assinado_assinado`).
  return [...lista].sort((a, b) => b.length - a.length)[0];
}

export const ESTADO = {
  CRIADA: 'pt1',
  AGUARDANDO_VALIDACAO: 'pt7',
  FINALIZADA: 'fin',
} as const;
