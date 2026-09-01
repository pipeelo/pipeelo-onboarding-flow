import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../evolution', () => ({
  toJid: (d: string) => `55${d}@s.whatsapp.net`,
  updateParticipants: vi.fn(async () => undefined),
  getParticipants: vi.fn(),
  getInviteUrl: vi.fn(async () => 'https://chat.whatsapp.com/abc'),
  groupSubject: (n: string) => `Pipeelo & ${n}`,
}));
vi.mock('../staff-notify', () => ({ notifyStaff: vi.fn(async () => ({ sent: true })) }));
vi.mock('../email-sender', () => ({ sendTransactionalEmail: vi.fn(async () => ({ skipped: false })) }));
import { updateParticipants, getParticipants } from '../evolution';
import { notifyStaff } from '../staff-notify';
import { sendTransactionalEmail } from '../email-sender';
import { addTeamToGroup } from '../equipe-grupo';

const pessoas = [
  { nome: 'Ana', email: 'ana@x.com', whatsapp: '(43) 99666-1541', adicionar_grupo: 'sim' },
  { nome: 'Bia', email: 'bia@x.com', whatsapp: '(43) 99111-2233', adicionar_grupo: 'sim' },
  { nome: 'Caio', email: 'caio@x.com', whatsapp: '', adicionar_grupo: 'sim' },
  { nome: 'Dani', email: 'dani@x.com', whatsapp: '(43) 99000-0000', adicionar_grupo: 'nao' },
];
function sb(respostas: Array<{ pergunta_id: string; valor: unknown }>) {
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), in: vi.fn(async () => ({ data: respostas, error: null })) };
  return { from: vi.fn(() => chain) } as never;
}

describe('addTeamToGroup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adiciona quem tem whatsapp e marcou sim; relata quem não entrou', async () => {
    (getParticipants as never as ReturnType<typeof vi.fn>).mockResolvedValue(['5543996661541@s.whatsapp.net']);
    const r = await addTeamToGroup(sb([{ pergunta_id: 'equipe_pessoas', valor: pessoas }]), 's1', '1@g.us', 'Provedor X');
    expect(updateParticipants).toHaveBeenCalledWith('1@g.us', 'add', ['5543996661541@s.whatsapp.net', '5543991112233@s.whatsapp.net']);
    expect(r).toEqual({ adicionados: 1, total: 2, nao_adicionados: ['Bia'] });
    expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'bia@x.com', template: 'ConviteGrupo' }));
    expect(notifyStaff).toHaveBeenCalledWith(expect.stringContaining('1 de 2'));
  });
  it('sem equipe cadastrada não chama a Evolution', async () => {
    const r = await addTeamToGroup(sb([]), 's1', '1@g.us', 'Provedor X');
    expect(r).toEqual({ adicionados: 0, total: 0, nao_adicionados: [] });
    expect(updateParticipants).not.toHaveBeenCalled();
  });
  it('ignora número inválido sem derrubar os outros', async () => {
    (getParticipants as never as ReturnType<typeof vi.fn>).mockResolvedValue(['5543996661541@s.whatsapp.net']);
    const r = await addTeamToGroup(sb([{ pergunta_id: 'equipe_pessoas', valor: [pessoas[0], { nome: 'Zé', email: 'z@x.com', whatsapp: '123', adicionar_grupo: 'sim' }] }]), 's1', '1@g.us', 'X');
    expect(r.total).toBe(1);
  });
});
