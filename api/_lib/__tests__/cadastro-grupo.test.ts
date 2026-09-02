import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../evolution', () => ({
  toJid: (d: string) => `55${d}@s.whatsapp.net`,
  groupSubject: (n: string) => `Pipeelo & ${n}`,
  createGroup: vi.fn(),
  updateParticipants: vi.fn(async () => undefined),
  getParticipants: vi.fn(),
  getInviteUrl: vi.fn(async () => 'https://chat.whatsapp.com/abc'),
  sendText: vi.fn(async () => ({ ok: true })),
  EvolutionApiError: class extends Error { constructor(public status: number, m: string) { super(m); } },
  EvolutionConfigError: class extends Error {},
}));
vi.mock('../short-links', () => ({
  ensureShortLink: vi.fn(async () => ({ code: 'abc123', short_url: 'https://onboarding.pipeelo.com/s/abc123' })),
  onboardingTargetUrl: () => 'https://onboarding.pipeelo.com/slug?token=t',
}));
vi.mock('../staff-notify', () => ({ notifyStaff: vi.fn(async () => ({ sent: true })) }));
vi.mock('../email-sender', () => ({ sendTransactionalEmail: vi.fn(async () => ({ skipped: false })) }));

import { createGroup, getParticipants, updateParticipants, sendText, getInviteUrl } from '../evolution';
import { notifyStaff } from '../staff-notify';
import { sendTransactionalEmail } from '../email-sender';
import { criarGrupoParaSessao } from '../cadastro-grupo';
import type { Cadastro } from '../schemas/cadastro';

const upload = { path: 'p', nome_original: 'a.pdf', tamanho: 1 };
const cadastro: Cadastro = {
  cnpj: '11222333000181', razao_social: 'X LTDA', nome_fantasia: 'Provedor X', inscricao_estadual: 'Isento',
  cobranca_email: 'f@x.com', cobranca_telefone: '4333221100', dia_vencimento: 10, contrato_email: 'j@x.com',
  doc_contrato_social: [upload], doc_responsaveis: [upload],
  responsavel_nome: 'Ana', responsavel_cargo: 'CEO', responsavel_email: 'ana@x.com', responsavel_whatsapp: '43996661541',
  contatos_extras: [{ nome: 'João', whatsapp: '43991112233' }], aceite_dados: true,
};
const sessao = { id: 's1', slug: 'slug', access_token: 't', empresa_nome: 'Provedor X', modo: 'completo' as const };

function makeSupabase() {
  const updates: unknown[] = [];
  const eq = vi.fn(async () => ({ error: null }));
  const update = vi.fn((patch: unknown) => { updates.push(patch); return { eq }; });
  const from = vi.fn(() => ({ update }));
  return { client: { from } as never, updates };
}

describe('criarGrupoParaSessao', () => {
  beforeEach(() => vi.clearAllMocks());

  it('caminho feliz: cria, promove, confere, manda boas-vindas e avisa Staff', async () => {
    (createGroup as never as ReturnType<typeof vi.fn>).mockResolvedValue({ groupJid: '1@g.us', inviteCode: 'abc' });
    (getParticipants as never as ReturnType<typeof vi.fn>).mockResolvedValue(['5543996661541@s.whatsapp.net', '5543991112233@s.whatsapp.net']);
    const sb = makeSupabase();

    const r = await criarGrupoParaSessao(sb.client, sessao, cadastro);

    expect(r).toEqual({ status: 'criado', jid: '1@g.us', invite_url: 'https://chat.whatsapp.com/abc', nao_adicionados: [] });
    expect(createGroup).toHaveBeenCalledWith('Pipeelo & Provedor X', ['5543996661541@s.whatsapp.net', '5543991112233@s.whatsapp.net']);
    expect(updateParticipants).toHaveBeenCalledWith('1@g.us', 'promote', ['5543996661541@s.whatsapp.net']);
    expect(sendText).toHaveBeenCalledWith('1@g.us', expect.stringContaining('https://onboarding.pipeelo.com/s/abc123'));
    expect(notifyStaff).toHaveBeenCalledWith(expect.stringContaining('Cadastro recebido: Provedor X'));
    expect(sb.updates.some((u) => (u as { grupo_jid?: string }).grupo_jid === '1@g.us')).toBe(true);
    expect(sb.updates.some((u) => 'notificacao_boas_vindas_enviada_at' in (u as object))).toBe(true);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it('equipe Pipeelo (membros do grupo Staff) entra no grupo do cliente, sem repetir quem já está', async () => {
    process.env.STAFF_GROUP_JID = 'staff@g.us';
    try {
      (createGroup as never as ReturnType<typeof vi.fn>).mockResolvedValue({ groupJid: '1@g.us', inviteCode: 'abc' });
      (getParticipants as never as ReturnType<typeof vi.fn>)
        // 1ª chamada: membros do Staff (inclui o número da instância, que já é dono do grupo novo)
        .mockResolvedValueOnce(['5511900000001@s.whatsapp.net', '5511900000002@s.whatsapp.net', '5543996661541@s.whatsapp.net'])
        // 2ª chamada: quem já está no grupo recém-criado
        .mockResolvedValueOnce(['5511900000001@s.whatsapp.net', '5543996661541@s.whatsapp.net', '5543991112233@s.whatsapp.net'])
        // 3ª chamada (conferência do passo 3b)
        .mockResolvedValue(['5511900000001@s.whatsapp.net', '5511900000002@s.whatsapp.net', '5543996661541@s.whatsapp.net', '5543991112233@s.whatsapp.net']);
      const sb = makeSupabase();

      const r = await criarGrupoParaSessao(sb.client, sessao, cadastro);

      expect(r.status).toBe('criado');
      expect(getParticipants).toHaveBeenCalledWith('staff@g.us');
      expect(updateParticipants).toHaveBeenCalledWith('1@g.us', 'add', ['5511900000002@s.whatsapp.net']);
      if (r.status === 'criado') expect(r.nao_adicionados).toEqual([]);
    } finally {
      delete process.env.STAFF_GROUP_JID;
    }
  });

  it('falha ao buscar o Staff não bloqueia: erro fica registrado e o fluxo segue', async () => {
    process.env.STAFF_GROUP_JID = 'staff@g.us';
    try {
      (createGroup as never as ReturnType<typeof vi.fn>).mockResolvedValue({ groupJid: '1@g.us', inviteCode: 'abc' });
      (getParticipants as never as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('staff indisponível'))
        .mockResolvedValue(['5543996661541@s.whatsapp.net', '5543991112233@s.whatsapp.net']);
      const sb = makeSupabase();

      const r = await criarGrupoParaSessao(sb.client, sessao, cadastro);

      expect(r.status).toBe('criado');
      if (r.status === 'criado') expect(r.erros).toEqual(expect.arrayContaining([expect.stringContaining('equipe pipeelo: staff indisponível')]));
      expect(sendText).toHaveBeenCalled();
      expect(notifyStaff).toHaveBeenCalledWith(expect.stringContaining('Falhas:'));
    } finally {
      delete process.env.STAFF_GROUP_JID;
    }
  });

  it('quem não entrou recebe e-mail de convite e volta em nao_adicionados', async () => {
    (createGroup as never as ReturnType<typeof vi.fn>).mockResolvedValue({ groupJid: '1@g.us', inviteCode: null });
    (getParticipants as never as ReturnType<typeof vi.fn>).mockResolvedValue(['5543991112233@s.whatsapp.net']);
    const sb = makeSupabase();

    const r = await criarGrupoParaSessao(sb.client, sessao, cadastro);

    expect(r.status).toBe('criado');
    if (r.status === 'criado') expect(r.nao_adicionados).toEqual(['43996661541']);
    expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({
      template: 'ConviteGrupo', to: 'ana@x.com', sessionId: 's1',
      props: expect.objectContaining({ inviteUrl: 'https://chat.whatsapp.com/abc' }),
    }));
  });

  it('falha na criação: grava grupo_erro, avisa Staff, devolve erro sem lançar', async () => {
    (createGroup as never as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('evolution 500'));
    const sb = makeSupabase();

    const r = await criarGrupoParaSessao(sb.client, sessao, cadastro);

    expect(r).toEqual({ status: 'erro', motivo: 'evolution 500' });
    expect(sb.updates.some((u) => (u as { grupo_erro?: string }).grupo_erro === 'evolution 500')).toBe(true);
    expect(notifyStaff).toHaveBeenCalledWith(expect.stringContaining('falhou'));
    expect(sendText).not.toHaveBeenCalled();
  });

  it('falha ao promover não bloqueia; fica registrada em grupo_erro', async () => {
    (createGroup as never as ReturnType<typeof vi.fn>).mockResolvedValue({ groupJid: '1@g.us', inviteCode: 'abc' });
    (updateParticipants as never as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('promote falhou'));
    (getParticipants as never as ReturnType<typeof vi.fn>).mockResolvedValue(['5543996661541@s.whatsapp.net', '5543991112233@s.whatsapp.net']);
    const sb = makeSupabase();

    const r = await criarGrupoParaSessao(sb.client, sessao, cadastro);

    expect(r.status).toBe('criado');
    expect(sb.updates.some((u) => String((u as { grupo_erro?: string }).grupo_erro ?? '').includes('promote falhou'))).toBe(true);
    expect(sendText).toHaveBeenCalled();
    if (r.status === 'criado') expect(r.erros).toEqual(['promote: promote falhou']);
    expect(notifyStaff).toHaveBeenCalledWith(expect.stringContaining('Falhas:'));
    expect(notifyStaff).toHaveBeenCalledWith(expect.stringContaining('promote falhou'));
  });

  it('contato extra sem e-mail que não entrou aparece como "chamar manualmente" pro Staff', async () => {
    (createGroup as never as ReturnType<typeof vi.fn>).mockResolvedValue({ groupJid: '1@g.us', inviteCode: 'abc' });
    // Só a admin (Ana) entrou; o contato extra (João, sem e-mail no Cadastro) ficou de fora.
    (getParticipants as never as ReturnType<typeof vi.fn>).mockResolvedValue(['5543996661541@s.whatsapp.net']);
    const sb = makeSupabase();

    const r = await criarGrupoParaSessao(sb.client, sessao, cadastro);

    expect(r.status).toBe('criado');
    if (r.status === 'criado') expect(r.nao_adicionados).toEqual(['43991112233']);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(notifyStaff).toHaveBeenCalledWith(expect.stringContaining('Sem e-mail para convite (chamar manualmente): 43991112233'));
  });

  it('getInviteUrl falha: grupo continua criado, participantes seguem sendo conferidos, erro isolado', async () => {
    (createGroup as never as ReturnType<typeof vi.fn>).mockResolvedValue({ groupJid: '1@g.us', inviteCode: null });
    (getInviteUrl as never as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('invite indisponível'));
    (getParticipants as never as ReturnType<typeof vi.fn>).mockResolvedValue(['5543996661541@s.whatsapp.net']);
    const sb = makeSupabase();

    const r = await criarGrupoParaSessao(sb.client, sessao, cadastro);

    expect(r.status).toBe('criado');
    if (r.status === 'criado') {
      expect(r.jid).toBe('1@g.us');
      expect(r.nao_adicionados).toEqual(['43991112233']); // conferência de participantes rodou normalmente
      expect(r.erros).toEqual(expect.arrayContaining([expect.stringContaining('convite: invite indisponível')]));
    }
    // sem inviteUrl, não há como convidar por e-mail quem ficou de fora
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(notifyStaff).toHaveBeenCalledWith(expect.stringContaining('Falhas:'));
    expect(notifyStaff).toHaveBeenCalledWith(expect.stringContaining('invite indisponível'));
  });

  it('falha ao enviar e-mail de convite é isolada: fica em erros mas não impede o restante do fluxo', async () => {
    (createGroup as never as ReturnType<typeof vi.fn>).mockResolvedValue({ groupJid: '1@g.us', inviteCode: 'abc' });
    (getParticipants as never as ReturnType<typeof vi.fn>).mockResolvedValue(['5543991112233@s.whatsapp.net']); // só o João entrou
    (sendTransactionalEmail as never as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('e-mail indisponível'));
    const sb = makeSupabase();

    const r = await criarGrupoParaSessao(sb.client, sessao, cadastro);

    expect(r.status).toBe('criado');
    if (r.status === 'criado') {
      expect(r.erros).toEqual(expect.arrayContaining([expect.stringContaining(`email ${cadastro.responsavel_whatsapp}: e-mail indisponível`)]));
    }
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1); // único elegível: só o responsável tem e-mail no Cadastro
    expect(sendText).toHaveBeenCalled(); // boas-vindas segue mandada normalmente
    expect(notifyStaff).toHaveBeenCalledWith(expect.stringContaining('Falhas:'));
  });

  it('reaproveita grupo existente quando a sessão já tem grupo_jid', async () => {
    (getParticipants as never as ReturnType<typeof vi.fn>).mockResolvedValue(['5543996661541@s.whatsapp.net', '5543991112233@s.whatsapp.net']);
    const sb = makeSupabase();

    const r = await criarGrupoParaSessao(sb.client, { ...sessao, grupo_jid: '9@g.us', notificacao_boas_vindas_enviada_at: '2026-09-01' }, cadastro);

    expect(createGroup).not.toHaveBeenCalled();
    expect(updateParticipants).toHaveBeenCalledWith('9@g.us', 'add', expect.any(Array));
    expect(sendText).not.toHaveBeenCalled(); // boas-vindas já enviada
    expect(r.status).toBe('criado');
  });
});
