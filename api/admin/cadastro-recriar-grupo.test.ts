import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler } from '../../tests/_helpers/handler';

vi.mock('../_lib/admin-auth', () => ({ assertAdminUser: vi.fn(async () => ({ id: 'admin' })), AdminAuthError: class extends Error {} }));
vi.mock('../_lib/supabase', () => ({ getServiceSupabase: vi.fn() }));
vi.mock('../_lib/cadastro-grupo', () => ({ criarGrupoParaSessao: vi.fn(async () => ({ status: 'criado', jid: '1@g.us', invite_url: null, nao_adicionados: [] })) }));
import { getServiceSupabase } from '../_lib/supabase';
import { criarGrupoParaSessao } from '../_lib/cadastro-grupo';
import handler from './_cadastro-recriar-grupo';

const upload = { path: 'p', nome_original: 'a.pdf', tamanho: 1 };
const cadastro = {
  cnpj: '11222333000181', razao_social: 'X LTDA', nome_fantasia: 'Provedor X', inscricao_estadual: 'Isento',
  cobranca_email: 'f@x.com', cobranca_telefone: '4333221100', dia_vencimento: 10, contrato_email: 'j@x.com',
  doc_contrato_social: [upload], doc_responsaveis: [upload],
  responsavel_nome: 'Ana', responsavel_cargo: 'CEO', responsavel_email: 'ana@x.com', responsavel_whatsapp: '43996661541',
  contatos_extras: [], aceite_dados: true,
};

function sb(row: unknown) {
  const maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), maybeSingle };
  (getServiceSupabase as never as ReturnType<typeof vi.fn>).mockReturnValue({ from: () => chain });
}

describe('POST /api/admin/cadastro-recriar-grupo', () => {
  beforeEach(() => vi.clearAllMocks());
  it('200 reexecuta a criação com o cadastro salvo', async () => {
    sb({ id: 's1', slug: 's', access_token: 't', empresa_nome: 'X', modo: 'completo', cadastro, cadastro_enviado_at: '2026-09-01', grupo_jid: null });
    const r = await invokeHandler(handler as never, { method: 'POST', body: { session_id: 's1' }, headers: { authorization: 'Bearer x' } });
    expect(r.statusCode).toBe(200);
    expect(criarGrupoParaSessao).toHaveBeenCalled();
  });
  it('409 quando o cadastro ainda não foi enviado', async () => {
    sb({ id: 's1', cadastro: null, cadastro_enviado_at: null });
    const r = await invokeHandler(handler as never, { method: 'POST', body: { session_id: 's1' }, headers: { authorization: 'Bearer x' } });
    expect(r.statusCode).toBe(409);
  });
  it('404 sessão inexistente', async () => {
    sb(null);
    const r = await invokeHandler(handler as never, { method: 'POST', body: { session_id: 'nope' }, headers: { authorization: 'Bearer x' } });
    expect(r.statusCode).toBe(404);
  });
});
