import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../evolution', () => ({
  toJid: (d: string) => `55${d}@s.whatsapp.net`,
  chaveNumero: (j: string) => {
    let d = j.replace(/@.*$/, '').replace(/\D/g, '');
    if ((d.length === 10 || d.length === 11) && !d.startsWith('55')) d = `55${d}`;
    if (d.length === 13 && d.startsWith('55') && d[4] === '9') d = d.slice(0, 4) + d.slice(5);
    return d;
  },
  fmtTelefone: (d: string) => {
    const n = d.replace(/\D/g, '');
    if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
    if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
    return d;
  },
  groupSubject: (n: string) => `Pipeelo & ${n}`,
  temInstanciaDeGrupos: vi.fn(() => false),
  createGroup: vi.fn(),
  updateParticipants: vi.fn(async () => undefined),
  getParticipants: vi.fn(),
  getInviteUrl: vi.fn(async () => 'https://chat.whatsapp.com/abc'),
  sendText: vi.fn(async () => ({ ok: true })),
  EvolutionApiError: class extends Error { constructor(public status: number, m: string) { super(m); } },
  EvolutionConfigError: class extends Error {},
}));
vi.mock('../evolution-fila', () => ({ enfileirar: vi.fn(async () => 0) }));
vi.mock('../short-links', () => ({
  ensureShortLink: vi.fn(async () => ({ code: 'abc123', short_url: 'https://onboarding.pipeelo.com/s/abc123' })),
  onboardingTargetUrl: () => 'https://onboarding.pipeelo.com/slug?token=t',
}));
vi.mock('../staff-notify', () => ({ notifyStaff: vi.fn(async () => ({ sent: true })) }));
vi.mock('../email-sender', () => ({ sendTransactionalEmail: vi.fn(async () => ({ skipped: false })) }));

import { createGroup, getParticipants, updateParticipants, sendText, getInviteUrl, temInstanciaDeGrupos } from '../evolution';
import { enfileirar } from '../evolution-fila';
import type { NovoItem } from '../evolution-fila';
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

const ANA = '5543996661541@s.whatsapp.net';
const JOAO = '5543991112233@s.whatsapp.net';

const mock = (f: unknown) => f as never as ReturnType<typeof vi.fn>;
/** Itens que foram parar na fila, achatados das chamadas de enfileirar. */
const enfileirados = (): NovoItem[] => mock(enfileirar).mock.calls.flatMap((c) => c[1] as NovoItem[]);
/** Texto do último aviso mandado ao Staff. */
const avisoStaff = (): string => String(mock(notifyStaff).mock.calls.at(-1)?.[0] ?? '');

function makeSupabase() {
  const updates: unknown[] = [];
  const eq = vi.fn(async () => ({ error: null }));
  const update = vi.fn((patch: unknown) => { updates.push(patch); return { eq }; });
  const from = vi.fn(() => ({ update }));
  return { client: { from } as never, updates };
}

describe('criarGrupoParaSessao', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock(temInstanciaDeGrupos).mockReturnValue(false);
    mock(getInviteUrl).mockResolvedValue('https://chat.whatsapp.com/abc');
    mock(updateParticipants).mockResolvedValue(undefined);
  });
  afterEach(() => { delete process.env.GRUPO_SOMENTE_RESPONSAVEL; });

  it('caminho feliz: cria, promove, confere e ENFILEIRA as boas-vindas em vez de mandar na hora', async () => {
    mock(createGroup).mockResolvedValue({ groupJid: '1@g.us', inviteCode: 'abc' });
    mock(getParticipants).mockResolvedValue([ANA, JOAO]);
    const sb = makeSupabase();

    const r = await criarGrupoParaSessao(sb.client, sessao, cadastro);

    expect(r).toEqual({ status: 'criado', jid: '1@g.us', invite_url: 'https://chat.whatsapp.com/abc', nao_adicionados: [] });
    expect(createGroup).toHaveBeenCalledWith('Pipeelo & Provedor X', [ANA, JOAO], 'padrao');
    expect(updateParticipants).toHaveBeenCalledWith('1@g.us', 'promote', [ANA], 'padrao');
    // A rajada acabou: nada é enviado dentro do request.
    expect(sendText).not.toHaveBeenCalled();
    const texto = enfileirados().find((i) => i.tipo === 'texto');
    expect(texto?.chave).toBe('boas-vindas:s1');
    expect(texto?.payload?.texto).toContain('https://onboarding.pipeelo.com/s/abc123');
    expect(sb.updates.some((u) => (u as { grupo_jid?: string }).grupo_jid === '1@g.us')).toBe(true);
    expect(sb.updates.some((u) => 'notificacao_boas_vindas_enviada_at' in (u as object))).toBe(true);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it('a equipe Pipeelo não é adicionada: o Staff recebe o link e entra sozinho', async () => {
    process.env.STAFF_GROUP_JID = 'staff@g.us';
    try {
      mock(createGroup).mockResolvedValue({ groupJid: '1@g.us', inviteCode: 'abc' });
      mock(getParticipants).mockResolvedValue([ANA, JOAO]);
      const sb = makeSupabase();

      await criarGrupoParaSessao(sb.client, sessao, cadastro);

      // Uma única leitura de participantes — a do grupo. O grupo Staff não é mais lido.
      expect(getParticipants).toHaveBeenCalledTimes(1);
      expect(getParticipants).toHaveBeenCalledWith('1@g.us', 'padrao');
      expect(enfileirados().some((i) => i.tipo === 'add')).toBe(false);
      expect(avisoStaff()).toContain('Equipe Pipeelo entra por aqui: https://chat.whatsapp.com/abc');
    } finally {
      delete process.env.STAFF_GROUP_JID;
    }
  });

  it('sem link de convite, o Staff é avisado de que precisa pegar o link à mão', async () => {
    mock(createGroup).mockResolvedValue({ groupJid: '1@g.us', inviteCode: null });
    mock(getInviteUrl).mockRejectedValue(new Error('invite indisponível'));
    mock(getParticipants).mockResolvedValue([ANA, JOAO]);
    const sb = makeSupabase();

    await criarGrupoParaSessao(sb.client, sessao, cadastro);

    expect(avisoStaff()).toContain('Link do convite não veio');
  });

  it('grupo novo usa o número dedicado quando ele está configurado, e grava o dono na sessão', async () => {
    mock(temInstanciaDeGrupos).mockReturnValue(true);
    mock(createGroup).mockResolvedValue({ groupJid: '1@g.us', inviteCode: 'abc' });
    mock(getParticipants).mockResolvedValue([ANA, JOAO]);
    const sb = makeSupabase();

    await criarGrupoParaSessao(sb.client, sessao, cadastro);

    expect(createGroup).toHaveBeenCalledWith('Pipeelo & Provedor X', expect.anything(), 'grupos');
    expect(sb.updates.some((u) => (u as { grupo_instancia?: string }).grupo_instancia === 'grupos')).toBe(true);
  });

  it('grupo que já existe continua no número que o criou — o novo não é admin dele', async () => {
    mock(temInstanciaDeGrupos).mockReturnValue(true);
    mock(getParticipants).mockResolvedValue([]);
    const sb = makeSupabase();

    const r = await criarGrupoParaSessao(
      sb.client, { ...sessao, grupo_jid: 'velho@g.us', grupo_instancia: 'padrao' }, cadastro
    );

    expect(r.status).toBe('criado');
    expect(createGroup).not.toHaveBeenCalled();
    expect(getParticipants).toHaveBeenCalledWith('velho@g.us', 'padrao');
    expect(enfileirados().filter((i) => i.tipo === 'add').every((i) => i.instancia === 'padrao')).toBe(true);
  });

  it('quem deveria estar no grupo e não está volta pra fila, com resumo pra conferir depois', async () => {
    mock(createGroup).mockResolvedValue({ groupJid: '1@g.us', inviteCode: 'abc' });
    // Só o João entrou; a Ana ficou de fora.
    mock(getParticipants).mockResolvedValue([JOAO]);
    const sb = makeSupabase();

    await criarGrupoParaSessao(sb.client, sessao, cadastro);

    const adds = enfileirados().filter((i) => i.tipo === 'add');
    expect(adds.map((a) => a.payload?.jid)).toEqual([ANA]);
    const resumo = enfileirados().find((i) => i.tipo === 'resumo');
    expect(resumo?.payload?.esperados).toEqual([{ jid: ANA, nome: 'Ana', email: 'ana@x.com' }]);
    expect(resumo?.payload?.inviteUrl).toBe('https://chat.whatsapp.com/abc');
  });

  it('sem ninguém para adicionar, não enfileira resumo', async () => {
    mock(createGroup).mockResolvedValue({ groupJid: '1@g.us', inviteCode: 'abc' });
    mock(getParticipants).mockResolvedValue([ANA, JOAO]);
    const sb = makeSupabase();

    await criarGrupoParaSessao(sb.client, sessao, cadastro);

    expect(enfileirados().some((i) => i.tipo === 'resumo')).toBe(false);
  });

  describe('modo contenção (GRUPO_SOMENTE_RESPONSAVEL)', () => {
    beforeEach(() => { process.env.GRUPO_SOMENTE_RESPONSAVEL = 'true'; });

    it('o grupo nasce só com o responsável', async () => {
      mock(createGroup).mockResolvedValue({ groupJid: '1@g.us', inviteCode: 'abc' });
      mock(getParticipants).mockResolvedValue([ANA]);
      const sb = makeSupabase();

      await criarGrupoParaSessao(sb.client, sessao, cadastro);

      expect(createGroup).toHaveBeenCalledWith('Pipeelo & Provedor X', [ANA], 'padrao');
    });

    it('os contatos extras viram pedido ao responsável, não add nosso', async () => {
      mock(createGroup).mockResolvedValue({ groupJid: '1@g.us', inviteCode: 'abc' });
      mock(getParticipants).mockResolvedValue([ANA]);
      const sb = makeSupabase();

      const r = await criarGrupoParaSessao(sb.client, sessao, cadastro);

      expect(enfileirados().some((i) => i.tipo === 'add')).toBe(false);
      const pedido = enfileirados().find((i) => i.chave === 'pedido-adicionar:s1');
      expect(pedido?.payload?.texto).toContain('Ana, pode adicionar aqui no grupo');
      expect(pedido?.payload?.texto).toContain('João — (43) 99111-2233');
      // O João não entrou de propósito: não é "não adicionado" nem recebe e-mail.
      if (r.status === 'criado') expect(r.nao_adicionados).toEqual([]);
      expect(sendTransactionalEmail).not.toHaveBeenCalled();
      expect(avisoStaff()).toContain('Modo contenção');
    });

    it('sem contatos extras não pede nada', async () => {
      mock(createGroup).mockResolvedValue({ groupJid: '1@g.us', inviteCode: 'abc' });
      mock(getParticipants).mockResolvedValue([ANA]);
      const sb = makeSupabase();

      await criarGrupoParaSessao(sb.client, { ...sessao }, { ...cadastro, contatos_extras: [] });

      expect(enfileirados().some((i) => i.chave === 'pedido-adicionar:s1')).toBe(false);
    });
  });

  it('reconhece quem entrou mesmo quando o WhatsApp devolve o número sem o nono dígito', async () => {
    mock(createGroup).mockResolvedValue({ groupJid: '1@g.us', inviteCode: 'abc' });
    mock(getParticipants).mockResolvedValue(['554396661541@s.whatsapp.net', '554391112233@s.whatsapp.net']);
    const sb = makeSupabase();

    const r = await criarGrupoParaSessao(sb.client, sessao, cadastro);

    if (r.status === 'criado') expect(r.nao_adicionados).toEqual([]);
    expect(updateParticipants).toHaveBeenCalledWith('1@g.us', 'promote', ['554396661541@s.whatsapp.net'], 'padrao');
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it('quem não entrou recebe e-mail de convite, volta em nao_adicionados e entra na fila', async () => {
    mock(createGroup).mockResolvedValue({ groupJid: '1@g.us', inviteCode: null });
    mock(getParticipants).mockResolvedValue([JOAO]);
    const sb = makeSupabase();

    const r = await criarGrupoParaSessao(sb.client, sessao, cadastro);

    expect(r.status).toBe('criado');
    if (r.status === 'criado') expect(r.nao_adicionados).toEqual(['43996661541']);
    expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({
      template: 'ConviteGrupo', to: 'ana@x.com', sessionId: 's1',
      // Mesma chave do item de resumo: o convite não sai duas vezes.
      idempotencyKey: 'convite-grupo:s1:554396661541',
      props: expect.objectContaining({ inviteUrl: 'https://chat.whatsapp.com/abc' }),
    }));
    expect(enfileirados().some((i) => i.tipo === 'add' && i.payload?.jid === ANA)).toBe(true);
  });

  it('falha na criação: grava grupo_erro, avisa Staff, devolve erro sem lançar', async () => {
    mock(createGroup).mockRejectedValue(new Error('evolution 500'));
    const sb = makeSupabase();

    const r = await criarGrupoParaSessao(sb.client, sessao, cadastro);

    expect(r).toEqual({ status: 'erro', motivo: 'evolution 500' });
    expect(sb.updates.some((u) => (u as { grupo_erro?: string }).grupo_erro === 'evolution 500')).toBe(true);
    expect(notifyStaff).toHaveBeenCalledWith(expect.stringContaining('NÃO foi criado'));
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it('falha ao promover não bloqueia; fica registrada em grupo_erro', async () => {
    mock(createGroup).mockResolvedValue({ groupJid: '1@g.us', inviteCode: 'abc' });
    mock(updateParticipants).mockRejectedValueOnce(new Error('promote falhou'));
    mock(getParticipants).mockResolvedValue([ANA, JOAO]);
    const sb = makeSupabase();

    const r = await criarGrupoParaSessao(sb.client, sessao, cadastro);

    expect(r.status).toBe('criado');
    expect(sb.updates.some((u) => String((u as { grupo_erro?: string }).grupo_erro ?? '').includes('promote falhou'))).toBe(true);
    if (r.status === 'criado') expect(r.erros).toEqual(['promote: promote falhou']);
    expect(avisoStaff()).toContain('promote falhou');
  });

  it('contato extra sem e-mail que não entrou aparece como "chamar manualmente" pro Staff', async () => {
    mock(createGroup).mockResolvedValue({ groupJid: '1@g.us', inviteCode: 'abc' });
    // Só a admin (Ana) entrou; o contato extra (João, sem e-mail no Cadastro) ficou de fora.
    mock(getParticipants).mockResolvedValue([ANA]);
    const sb = makeSupabase();

    const r = await criarGrupoParaSessao(sb.client, sessao, cadastro);

    expect(r.status).toBe('criado');
    if (r.status === 'criado') expect(r.nao_adicionados).toEqual(['43991112233']);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(avisoStaff()).toContain('João — (43) 99111-2233 — sem convite por e-mail, chamar manualmente');
  });

  it('getInviteUrl falha: grupo continua criado, participantes seguem sendo conferidos, erro isolado', async () => {
    mock(createGroup).mockResolvedValue({ groupJid: '1@g.us', inviteCode: null });
    mock(getInviteUrl).mockRejectedValue(new Error('invite indisponível'));
    mock(getParticipants).mockResolvedValue([ANA]);
    const sb = makeSupabase();

    const r = await criarGrupoParaSessao(sb.client, sessao, cadastro);

    expect(r.status).toBe('criado');
    if (r.status === 'criado') {
      expect(r.jid).toBe('1@g.us');
      expect(r.nao_adicionados).toEqual(['43991112233']);
      expect(r.erros).toEqual(expect.arrayContaining([expect.stringContaining('convite: invite indisponível')]));
    }
    // sem inviteUrl, não há como convidar por e-mail quem ficou de fora
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(avisoStaff()).toContain('Falhas:');
  });
});
