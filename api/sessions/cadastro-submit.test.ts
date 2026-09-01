import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler } from '../../tests/_helpers/handler';

vi.mock('../_lib/auth-session', async () => {
  const actual = await vi.importActual<typeof import('../_lib/auth-session')>('../_lib/auth-session');
  return { ...actual, assertSessionAccess: vi.fn() };
});
vi.mock('../_lib/supabase', () => ({ getServiceSupabase: vi.fn() }));
vi.mock('../_lib/cadastro-grupo', () => ({ criarGrupoParaSessao: vi.fn() }));
vi.mock('../_lib/ratelimit', () => ({ createSessionLimiter: () => ({ limit: vi.fn(async () => ({ success: true })) }) }));

import { assertSessionAccess } from '../_lib/auth-session';
import { getServiceSupabase } from '../_lib/supabase';
import { criarGrupoParaSessao } from '../_lib/cadastro-grupo';
import handler from './_cadastro-submit';

const upload = { path: 'p', nome_original: 'a.pdf', tamanho: 1 };
const cadastro = {
  cnpj: '11.222.333/0001-81', razao_social: 'X LTDA', nome_fantasia: 'Provedor X', inscricao_estadual: 'Isento',
  cobranca_email: 'f@x.com', cobranca_telefone: '(43) 3322-1100', dia_vencimento: 10, contrato_email: 'j@x.com',
  doc_contrato_social: [upload], doc_responsaveis: [upload],
  responsavel_nome: 'Ana Souza', responsavel_cargo: 'CEO', responsavel_email: 'ana@x.com', responsavel_whatsapp: '(43) 99666-1541',
  contatos_extras: [], aceite_dados: true,
};
const body = { slug: 's', token: 'tok-32-chars-xxxxxxxxxxxxxxxxxx', cadastro };
const sessao = { id: 's1', slug: 's', access_token: 'tok', empresa_nome: 'Provedor X', modo: 'completo', cadastro_enviado_at: null, grupo_jid: null };

function makeSupabase() {
  const eq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq }));
  return { client: { from: vi.fn(() => ({ update })) }, update };
}

describe('POST /api/sessions/cadastro-submit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('200: salva cadastro, cria grupo e devolve resultado', async () => {
    (assertSessionAccess as never as ReturnType<typeof vi.fn>).mockResolvedValue(sessao);
    const sb = makeSupabase();
    (getServiceSupabase as never as ReturnType<typeof vi.fn>).mockReturnValue(sb.client);
    (criarGrupoParaSessao as never as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'criado', jid: '1@g.us', invite_url: null, nao_adicionados: [] });

    const r = await invokeHandler(handler as never, { method: 'POST', body, headers: { host: 'onboarding.pipeelo.com' } });

    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ ok: true, grupo: { status: 'criado', jid: '1@g.us', invite_url: null, nao_adicionados: [] } });
    const saved = (sb.update.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(saved.cadastro).toMatchObject({ cnpj: '11222333000181', responsavel_whatsapp: '43996661541' });
    expect(saved.cadastro_enviado_at).toBeTruthy();
  });

  it('idempotente: cadastro já enviado devolve estado atual sem recriar grupo', async () => {
    (assertSessionAccess as never as ReturnType<typeof vi.fn>).mockResolvedValue({ ...sessao, cadastro_enviado_at: '2026-09-01', grupo_jid: '1@g.us', grupo_invite_url: 'https://chat.whatsapp.com/x' });
    const r = await invokeHandler(handler as never, { method: 'POST', body });
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ ok: true, grupo: { status: 'criado', jid: '1@g.us', invite_url: 'https://chat.whatsapp.com/x', nao_adicionados: [] } });
    expect(criarGrupoParaSessao).not.toHaveBeenCalled();
  });

  it('400 com payload inválido', async () => {
    (assertSessionAccess as never as ReturnType<typeof vi.fn>).mockResolvedValue(sessao);
    const r = await invokeHandler(handler as never, { method: 'POST', body: { ...body, cadastro: { ...cadastro, aceite_dados: false } } });
    expect(r.statusCode).toBe(400);
  });

  it('500 se salvar falhar; grupo não é criado', async () => {
    (assertSessionAccess as never as ReturnType<typeof vi.fn>).mockResolvedValue(sessao);
    const eq = vi.fn(async () => ({ error: { message: 'db down' } }));
    (getServiceSupabase as never as ReturnType<typeof vi.fn>).mockReturnValue({ from: () => ({ update: () => ({ eq }) }) });
    const r = await invokeHandler(handler as never, { method: 'POST', body });
    expect(r.statusCode).toBe(500);
    expect(criarGrupoParaSessao).not.toHaveBeenCalled();
  });
});
