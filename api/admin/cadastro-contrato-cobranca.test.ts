import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler } from '../../tests/_helpers/handler';

vi.mock('../_lib/admin-auth', () => ({
  assertAdminUser: vi.fn(async () => ({ id: 'admin' })),
  AdminAuthError: class extends Error {},
}));
vi.mock('../_lib/supabase', () => ({ getServiceSupabase: vi.fn() }));
vi.mock('../_lib/contrato', () => ({
  CONTRATO_BUCKET: 'onboarding-contratos',
  gerarContratoParaSessao: vi.fn(async () => ({ status: 'gerado', path: 's1/c.docx', representante: 'Ana', avisos: [] })),
}));
vi.mock('../_lib/conta-azul', () => ({
  criarClienteContaAzul: vi.fn(async () => ({ status: 'cliente_criado', cliente_id: 'ca-1' })),
}));

import { getServiceSupabase } from '../_lib/supabase';
import { gerarContratoParaSessao } from '../_lib/contrato';
import { criarClienteContaAzul } from '../_lib/conta-azul';
import gerarContratoHandler from './_cadastro-gerar-contrato';
import cobrarHandler from './_cadastro-cobrar-conta-azul';
import downloadHandler from './_contrato-download';

const upload = { path: 'p', nome_original: 'a.pdf', tamanho: 1 };
const cadastro = {
  cnpj: '11222333000181', razao_social: 'X LTDA', nome_fantasia: 'Provedor X', inscricao_estadual: 'Isento',
  cobranca_email: 'f@x.com', cobranca_telefone: '4333221100', dia_vencimento: 10, contrato_email: 'j@x.com',
  doc_contrato_social: [upload], doc_responsaveis: [upload],
  responsavel_nome: 'Ana', responsavel_cargo: 'CEO', responsavel_email: 'ana@x.com', responsavel_whatsapp: '43996661541',
  contatos_extras: [], aceite_dados: true,
};

const auth = { authorization: 'Bearer x' };

function sb(row: unknown, signed?: { data: unknown; error: unknown }) {
  const updates: Array<Record<string, unknown>> = [];
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data: row, error: null })),
    update: vi.fn((patch: Record<string, unknown>) => {
      updates.push(patch);
      return { eq: vi.fn(async () => ({ error: null })) };
    }),
  };
  const createSignedUrl = vi.fn(async () => signed ?? { data: { signedUrl: 'https://storage/assinado' }, error: null });
  (getServiceSupabase as never as ReturnType<typeof vi.fn>).mockReturnValue({
    from: () => chain,
    storage: { from: () => ({ createSignedUrl }) },
  });
  return { createSignedUrl, updates };
}

const sessaoOk = {
  id: 's1', slug: 'provedor-x', empresa_nome: 'X', erp: 'IXC', contratou_crm: false,
  valor_sessao: 0.95, qtd_sessoes: 2640, valor_mensal: 2508, dia_vencimento: 10,
  valor_implantacao: 4000, implantacao_vencimento: '2026-09-15', go_live_em: null,
  cadastro, cadastro_enviado_at: '2026-09-02T12:00:00.000Z',
};

describe('POST /api/admin/cadastro-gerar-contrato', () => {
  beforeEach(() => vi.clearAllMocks());

  it('200 regera o contrato com o cadastro salvo', async () => {
    sb(sessaoOk);
    const r = await invokeHandler(gerarContratoHandler as never, { method: 'POST', body: { session_id: 's1' }, headers: auth });
    expect(r.statusCode).toBe(200);
    expect(gerarContratoParaSessao).toHaveBeenCalled();
    expect(r.body).toMatchObject({ ok: true, contrato: { status: 'gerado', path: 's1/c.docx' } });
  });

  it('409 quando o cadastro ainda não foi enviado', async () => {
    sb({ id: 's1', cadastro: null, cadastro_enviado_at: null });
    const r = await invokeHandler(gerarContratoHandler as never, { method: 'POST', body: { session_id: 's1' }, headers: auth });
    expect(r.statusCode).toBe(409);
  });

  it('404 sessão inexistente', async () => {
    sb(null);
    const r = await invokeHandler(gerarContratoHandler as never, { method: 'POST', body: { session_id: 'x' }, headers: auth });
    expect(r.statusCode).toBe(404);
  });

  it('405 em GET', async () => {
    sb(sessaoOk);
    const r = await invokeHandler(gerarContratoHandler as never, { method: 'GET', headers: auth });
    expect(r.statusCode).toBe(405);
  });
});

describe('POST /api/admin/cadastro-cobrar-conta-azul', () => {
  beforeEach(() => vi.clearAllMocks());

  it('200 devolve o cliente criado', async () => {
    sb(sessaoOk);
    const r = await invokeHandler(cobrarHandler as never, { method: 'POST', body: { session_id: 's1' }, headers: auth });
    expect(r.statusCode).toBe(200);
    expect(criarClienteContaAzul).toHaveBeenCalled();
    expect(r.body).toMatchObject({ ok: true, cobranca: { status: 'cliente_criado', cliente_id: 'ca-1' } });
  });

  it('409 sem cadastro enviado', async () => {
    sb({ id: 's1', cadastro: null, cadastro_enviado_at: null });
    const r = await invokeHandler(cobrarHandler as never, { method: 'POST', body: { session_id: 's1' }, headers: auth });
    expect(r.statusCode).toBe(409);
    expect(criarClienteContaAzul).not.toHaveBeenCalled();
  });

  it('grava o go-live na sessão (para o contrato)', async () => {
    const { updates } = sb(sessaoOk);
    const r = await invokeHandler(cobrarHandler as never, {
      method: 'POST', body: { session_id: 's1', go_live_em: '2026-09-20' }, headers: auth,
    });
    expect(r.statusCode).toBe(200);
    expect(updates).toEqual([{ go_live_em: '2026-09-20' }]);
    const sessaoCobrada = (criarClienteContaAzul as never as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(sessaoCobrada.go_live_em).toBe('2026-09-20');
  });

  it('400 quando o go-live vem em formato errado', async () => {
    sb(sessaoOk);
    const r = await invokeHandler(cobrarHandler as never, {
      method: 'POST', body: { session_id: 's1', go_live_em: '20/09/2026' }, headers: auth,
    });
    expect(r.statusCode).toBe(400);
    expect(criarClienteContaAzul).not.toHaveBeenCalled();
  });

  it('400 sem session_id', async () => {
    sb(sessaoOk);
    const r = await invokeHandler(cobrarHandler as never, { method: 'POST', body: {}, headers: auth });
    expect(r.statusCode).toBe(400);
  });

  it('409 ja_criado quando a sessão já tem ca_cliente_id', async () => {
    sb({ ...sessaoOk, ca_cliente_id: 'ca-9' });
    const r = await invokeHandler(cobrarHandler as never, { method: 'POST', body: { session_id: 's1' }, headers: auth });
    expect(r.statusCode).toBe(409);
    expect(r.body).toEqual({ error: 'ja_criado', ca_cliente_id: 'ca-9' });
    expect(criarClienteContaAzul).not.toHaveBeenCalled();
  });

  it('force: true libera a trava e refaz mesmo com cliente criado', async () => {
    const { updates } = sb({ ...sessaoOk, ca_cliente_id: 'ca-9' });
    const r = await invokeHandler(cobrarHandler as never, {
      method: 'POST', body: { session_id: 's1', force: true }, headers: auth,
    });
    expect(r.statusCode).toBe(200);
    expect(updates).toEqual([{ ca_cliente_id: null }]);
    expect(criarClienteContaAzul).toHaveBeenCalled();
  });
});

describe('GET /api/admin/contrato-download', () => {
  beforeEach(() => vi.clearAllMocks());

  it('200 devolve o link assinado de 60 minutos', async () => {
    const { createSignedUrl } = sb({ id: 's1', contrato_path: 's1/c.docx' });
    const r = await invokeHandler(downloadHandler as never, { method: 'GET', query: { session_id: 's1' }, headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ url: 'https://storage/assinado' });
    expect(createSignedUrl).toHaveBeenCalledWith('s1/c.docx', 3600);
  });

  it('302 com redirect=1', async () => {
    sb({ id: 's1', contrato_path: 's1/c.docx' });
    const r = await invokeHandler(downloadHandler as never, { method: 'GET', query: { session_id: 's1', redirect: '1' }, headers: auth });
    expect(r.statusCode).toBe(302);
    expect(r.setHeader).toHaveBeenCalledWith('Location', 'https://storage/assinado');
  });

  it('409 quando o contrato ainda não foi gerado', async () => {
    sb({ id: 's1', contrato_path: null });
    const r = await invokeHandler(downloadHandler as never, { method: 'GET', query: { session_id: 's1' }, headers: auth });
    expect(r.statusCode).toBe(409);
  });

  it('400 sem session_id', async () => {
    sb({ id: 's1', contrato_path: 's1/c.docx' });
    const r = await invokeHandler(downloadHandler as never, { method: 'GET', headers: auth });
    expect(r.statusCode).toBe(400);
  });
});
