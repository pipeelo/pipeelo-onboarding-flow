import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sessionApi, ApiError } from './api-client';

describe('sessionApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('get monta querystring com slug+token URL-encoded', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ session: {}, respostas: [] }), { status: 200 })
    );
    await sessionApi.get('s/lug', 'to k+en');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('slug=s%2Flug&token=to%20k%2Ben'),
      expect.objectContaining({ keepalive: true })
    );
  });

  it('throws ApiError com status em response não-ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_session' }), { status: 401 })
    );
    await expect(sessionApi.get('s', 't')).rejects.toMatchObject({
      status: 401,
      message: 'invalid_session',
    });
  });

  it('saveResposta usa method PUT com body JSON', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, saved_at: 'now' }), { status: 200 })
    );
    await sessionApi.saveResposta({
      slug: 's',
      token: 't',
      departamento: 'identificacao',
      pergunta_id: 'q1',
      valor: 'v',
    });
    const call = fetchSpy.mock.calls[0];
    expect(call[1]).toMatchObject({ method: 'PUT' });
    expect(JSON.parse(call[1]!.body as string)).toMatchObject({ pergunta_id: 'q1' });
  });

  it('create usa POST e retorna slug + access_token', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ slug: 'abc123', access_token: 'tk' }), { status: 201 })
    );
    const result = await sessionApi.create({
      empresa_nome: 'Pipeelo',
      cnpj: '12345678000100',
      turnstileToken: 'turnstile-xyz',
    });
    expect(result.slug).toBe('abc123');
    expect(result.access_token).toBe('tk');
    const call = fetchSpy.mock.calls[0];
    expect(call[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(call[1]!.body as string)).toMatchObject({
      empresa_nome: 'Pipeelo',
      cnpj: '12345678000100',
      turnstileToken: 'turnstile-xyz',
    });
  });

  it('completeDepartment envia POST com responsavel_nome', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    await sessionApi.completeDepartment({
      slug: 's',
      token: 't',
      departamento: 'sac_geral',
      responsavel_nome: 'Felipe',
    });
    const call = fetchSpy.mock.calls[0];
    expect(call[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(call[1]!.body as string)).toMatchObject({
      departamento: 'sac_geral',
      responsavel_nome: 'Felipe',
    });
  });

  it('ApiError preserva code do body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'identification_gate', code: 'gate' }), { status: 403 })
    );
    try {
      await sessionApi.completeDepartment({
        slug: 's',
        token: 't',
        departamento: 'financeiro',
        responsavel_nome: 'X',
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(403);
      expect((e as ApiError).code).toBe('gate');
    }
  });
});

describe('sessionApi.uploadArquivo', () => {
  it('não usa keepalive (corpo acima de 64 KB seria recusado pelo Chrome)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ path: 'p', nome_original: 'a.pdf', tamanho: 1 }) }));
    vi.stubGlobal('fetch', fetchMock);
    await sessionApi.uploadArquivo({ slug: 's', token: 't'.repeat(32), departamento: 'cadastro', pergunta_id: 'doc_contrato_social', nome: 'a.pdf', base64: 'QUJD' });
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/upload-arquivo', expect.objectContaining({ keepalive: false }));
    vi.unstubAllGlobals();
  });
});
