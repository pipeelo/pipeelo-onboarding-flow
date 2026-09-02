import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler } from '../../tests/_helpers/handler';

vi.mock('../_lib/admin-auth', () => ({
  assertAdminUser: vi.fn(async () => ({ id: 'admin' })),
  AdminAuthError: class extends Error {},
}));
vi.mock('../_lib/supabase', () => ({ getServiceSupabase: vi.fn() }));

import { getServiceSupabase } from '../_lib/supabase';
import handler from './_sessions-update';

function sb() {
  let updatedPatch: Record<string, unknown> = {};
  const single = vi.fn(async () => ({ data: { id: 's1', ...updatedPatch }, error: null }));
  const eq = vi.fn(() => ({ select: () => ({ single }) }));
  const update = vi.fn((patch: Record<string, unknown>) => {
    updatedPatch = patch;
    return { eq };
  });
  (getServiceSupabase as never as ReturnType<typeof vi.fn>).mockReturnValue({
    from: () => ({ update }),
  });
  return { update };
}

const SESSION_ID = '11111111-1111-1111-1111-111111111111';

describe('POST /api/admin/sessions-update — campos financeiros', () => {
  beforeEach(() => vi.clearAllMocks());

  it('200 atualiza valor_implantacao, implantacao_vencimento e primeira_mensalidade_em', async () => {
    const { update } = sb();
    const r = await invokeHandler(handler as never, {
      method: 'POST',
      body: {
        session_id: SESSION_ID,
        valor_implantacao: 2000,
        implantacao_vencimento: '2026-09-20',
        primeira_mensalidade_em: '2026-10-10',
      },
      headers: { authorization: 'Bearer x' },
    });
    expect(r.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        valor_implantacao: 2000,
        implantacao_vencimento: '2026-09-20',
        primeira_mensalidade_em: '2026-10-10',
      })
    );
  });

  it('200 passando null limpa os campos', async () => {
    const { update } = sb();
    const r = await invokeHandler(handler as never, {
      method: 'POST',
      body: {
        session_id: SESSION_ID,
        valor_implantacao: null,
        implantacao_vencimento: null,
        primeira_mensalidade_em: null,
      },
      headers: { authorization: 'Bearer x' },
    });
    expect(r.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        valor_implantacao: null,
        implantacao_vencimento: null,
        primeira_mensalidade_em: null,
      })
    );
  });

  it('400 quando primeira_mensalidade_em tem formato inválido', async () => {
    sb();
    const r = await invokeHandler(handler as never, {
      method: 'POST',
      body: { session_id: SESSION_ID, primeira_mensalidade_em: '10-10-2026' },
      headers: { authorization: 'Bearer x' },
    });
    expect(r.statusCode).toBe(400);
  });
});
