import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler } from '../../tests/_helpers/handler';

vi.mock('../_lib/auth-session', async () => {
  const actual = await vi.importActual<typeof import('../_lib/auth-session')>(
    '../_lib/auth-session'
  );
  return { ...actual, assertSessionAccess: vi.fn() };
});
vi.mock('../_lib/supabase', () => ({
  getServiceSupabase: vi.fn(),
  requireSupabase: vi.fn(),
}));
import { getServiceSupabase } from '../_lib/supabase';
import { assertSessionAccess, HttpError } from '../_lib/auth-session';
import handler from './_upload-arquivo';

function makeStorageMock(uploadResult: { data: unknown; error: null | { message: string } }) {
  const upload = vi.fn(async () => uploadResult);
  const from = vi.fn(() => ({ upload }));
  return { client: { storage: { from } }, upload, from };
}

describe('POST /api/sessions/upload-arquivo', () => {
  beforeEach(() => vi.clearAllMocks());

  const validBody = {
    slug: 's',
    token: 'tok-32-chars-xxxxxxxxxxxxxxxxxx',
    departamento: 'sac_geral',
    pergunta_id: 'equipe_planilha_upload',
    nome: 'equipe da empresa.xlsx',
    content_type:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: Buffer.from('conteudo-planilha').toString('base64'),
  };

  it('200 happy path — retorna path com session_id e metadata', async () => {
    (assertSessionAccess as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sess-1',
    });
    const m = makeStorageMock({ data: { path: 'x' }, error: null });
    (getServiceSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue(m.client);

    const r = await invokeHandler(handler as never, {
      method: 'POST',
      body: validBody,
    });
    expect(r.statusCode).toBe(200);
    const body = r.body as { path: string; nome_original: string; tamanho: number };
    expect(body.path).toMatch(/^sess-1\/equipe_planilha_upload\/\d+-equipe_da_empresa\.xlsx$/);
    expect(body.nome_original).toBe('equipe da empresa.xlsx');
    expect(body.tamanho).toBe(Buffer.from('conteudo-planilha').length);
    expect(m.from).toHaveBeenCalledWith('onboarding-uploads');
  });

  it('400 quando extensão não permitida', async () => {
    (assertSessionAccess as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sess-1',
    });
    const r = await invokeHandler(handler as never, {
      method: 'POST',
      body: { ...validBody, nome: 'malware.exe' },
    });
    expect(r.statusCode).toBe(400);
    expect((r.body as { error: string }).error).toBe('extensao_nao_permitida');
  });

  it('413 quando arquivo maior que 5MB', async () => {
    (assertSessionAccess as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sess-1',
    });
    const big = Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64');
    const r = await invokeHandler(handler as never, {
      method: 'POST',
      body: { ...validBody, base64: big },
    });
    expect(r.statusCode).toBe(413);
  });

  it('401 quando token inválido', async () => {
    (assertSessionAccess as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new HttpError(401, 'invalid_session')
    );
    const r = await invokeHandler(handler as never, {
      method: 'POST',
      body: validBody,
    });
    expect(r.statusCode).toBe(401);
  });

  it('405 quando método != POST', async () => {
    const r = await invokeHandler(handler as never, { method: 'PUT' });
    expect(r.statusCode).toBe(405);
  });

  it('500 quando storage falha', async () => {
    (assertSessionAccess as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sess-1',
    });
    const m = makeStorageMock({ data: null, error: { message: 'bucket down' } });
    (getServiceSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue(m.client);
    const r = await invokeHandler(handler as never, {
      method: 'POST',
      body: validBody,
    });
    expect(r.statusCode).toBe(500);
  });
});
