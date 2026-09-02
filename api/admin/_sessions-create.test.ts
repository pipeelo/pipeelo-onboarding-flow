import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler } from '../../tests/_helpers/handler';

vi.mock('../_lib/admin-auth', () => ({
  assertAdminUser: vi.fn(async () => ({ id: 'admin' })),
  AdminAuthError: class extends Error {},
}));
vi.mock('../_lib/supabase', () => ({ getServiceSupabase: vi.fn() }));
vi.mock('../_lib/email-sender', () => ({ sendTransactionalEmail: vi.fn(async () => ({})) }));

import { getServiceSupabase } from '../_lib/supabase';
import handler from './_sessions-create';

function sb() {
  let insertedRow: Record<string, unknown> = {};
  const single = vi.fn(async () => ({ data: { id: 's1', ...insertedRow }, error: null }));
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn((row: Record<string, unknown>) => {
    insertedRow = row;
    return { select };
  });
  (getServiceSupabase as never as ReturnType<typeof vi.fn>).mockReturnValue({
    from: () => ({ insert }),
  });
  return { insert };
}

describe('POST /api/admin/sessions-create — campos financeiros', () => {
  beforeEach(() => vi.clearAllMocks());

  it('201 aceita valor_implantacao, implantacao_vencimento e primeira_mensalidade_em', async () => {
    const { insert } = sb();
    const r = await invokeHandler(handler as never, {
      method: 'POST',
      body: {
        empresa_nome: 'Provedor X',
        valor_implantacao: 1500.5,
        implantacao_vencimento: '2026-09-15',
        primeira_mensalidade_em: '2026-10-05',
      },
      headers: { authorization: 'Bearer x' },
    });
    expect(r.statusCode).toBe(201);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        valor_implantacao: 1500.5,
        implantacao_vencimento: '2026-09-15',
        primeira_mensalidade_em: '2026-10-05',
      })
    );
  });

  it('201 sem os campos financeiros grava null', async () => {
    const { insert } = sb();
    const r = await invokeHandler(handler as never, {
      method: 'POST',
      body: { empresa_nome: 'Provedor Y' },
      headers: { authorization: 'Bearer x' },
    });
    expect(r.statusCode).toBe(201);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        valor_implantacao: null,
        implantacao_vencimento: null,
        primeira_mensalidade_em: null,
      })
    );
  });

  it('400 quando implantacao_vencimento tem formato inválido', async () => {
    sb();
    const r = await invokeHandler(handler as never, {
      method: 'POST',
      body: { empresa_nome: 'Provedor Z', implantacao_vencimento: '15/09/2026' },
      headers: { authorization: 'Bearer x' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('400 quando valor_implantacao é negativo', async () => {
    sb();
    const r = await invokeHandler(handler as never, {
      method: 'POST',
      body: { empresa_nome: 'Provedor Z', valor_implantacao: -10 },
      headers: { authorization: 'Bearer x' },
    });
    expect(r.statusCode).toBe(400);
  });
});
