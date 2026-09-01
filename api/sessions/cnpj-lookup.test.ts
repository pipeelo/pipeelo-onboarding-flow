import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler } from '../../tests/_helpers/handler';

vi.mock('../_lib/auth-session', async () => {
  const actual = await vi.importActual<typeof import('../_lib/auth-session')>('../_lib/auth-session');
  return { ...actual, assertSessionAccess: vi.fn() };
});
vi.mock('../_lib/brasilapi', () => ({ fetchCnpj: vi.fn() }));
import { assertSessionAccess, HttpError } from '../_lib/auth-session';
import { fetchCnpj } from '../_lib/brasilapi';
import handler from './_cnpj-lookup';

const body = { slug: 's', token: 'tok-32-chars-xxxxxxxxxxxxxxxxxx', cnpj: '11.222.333/0001-81' };

describe('POST /api/sessions/cnpj-lookup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('200 com razão social e fantasia da BrasilAPI', async () => {
    (assertSessionAccess as never as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 's1' });
    (fetchCnpj as never as ReturnType<typeof vi.fn>).mockResolvedValue({ razao_social: 'X LTDA', nome_fantasia: 'X' });
    const r = await invokeHandler(handler as never, { method: 'POST', body });
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ razao_social: 'X LTDA', nome_fantasia: 'X' });
  });
  it('200 com campos vazios quando o provedor está fora', async () => {
    (assertSessionAccess as never as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 's1' });
    (fetchCnpj as never as ReturnType<typeof vi.fn>).mockRejectedValue(new HttpError(503, 'cnpj_lookup_unavailable'));
    const r = await invokeHandler(handler as never, { method: 'POST', body });
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ razao_social: '', nome_fantasia: '' });
  });
  it('lê o formato da ReceitaWS (nome/fantasia)', async () => {
    (assertSessionAccess as never as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 's1' });
    (fetchCnpj as never as ReturnType<typeof vi.fn>).mockResolvedValue({ nome: 'Y LTDA', fantasia: 'Y' });
    const r = await invokeHandler(handler as never, { method: 'POST', body });
    expect(r.body).toEqual({ razao_social: 'Y LTDA', nome_fantasia: 'Y' });
  });
  it('400 com CNPJ inválido', async () => {
    (assertSessionAccess as never as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 's1' });
    const r = await invokeHandler(handler as never, { method: 'POST', body: { ...body, cnpj: '123' } });
    expect(r.statusCode).toBe(400);
  });
  it('401 sem sessão', async () => {
    (assertSessionAccess as never as ReturnType<typeof vi.fn>).mockRejectedValue(new HttpError(401, 'invalid_session'));
    const r = await invokeHandler(handler as never, { method: 'POST', body });
    expect(r.statusCode).toBe(401);
  });
});
