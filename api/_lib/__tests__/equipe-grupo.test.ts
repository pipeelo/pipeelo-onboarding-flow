import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../evolution', () => ({
  groupSubject: (n: string) => `Pipeelo & ${n}`,
  updateParticipants: vi.fn(),
  getParticipants: vi.fn(),
  getInviteUrl: vi.fn(),
}));
vi.mock('../staff-notify', () => ({ notifyStaff: vi.fn(async () => ({ sent: true })) }));
import { updateParticipants, getParticipants, getInviteUrl } from '../evolution';
import { notifyStaff } from '../staff-notify';
import { pedirEquipeNoGrupo, mensagemEquipeNoGrupo } from '../equipe-grupo';

const pessoas = [
  { nome: 'Ana', email: 'ana@x.com', whatsapp: '(43) 99666-1541', adicionar_grupo: 'sim', papel: 'gestor', departamentos: 'Comercial' },
  { nome: 'Bia', email: 'bia@x.com', whatsapp: '+55 43 99111-2233', adicionar_grupo: 'sim' },
  { nome: 'Caio', email: 'caio@x.com', whatsapp: '', adicionar_grupo: 'sim' },
  { nome: 'Dani', email: 'dani@x.com', whatsapp: '(43) 99000-0000', adicionar_grupo: 'nao' },
  {},
];
function sb(respostas: Array<{ pergunta_id: string; valor: unknown }>) {
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), in: vi.fn(async () => ({ data: respostas, error: null })) };
  return { from: vi.fn(() => chain) } as never;
}

describe('pedirEquipeNoGrupo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('manda no Staff só quem marcou sim e tem whatsapp, sem tocar no grupo', async () => {
    const r = await pedirEquipeNoGrupo(sb([{ pergunta_id: 'equipe_pessoas', valor: pessoas }]), 's1', 'Provedor X');
    expect(r).toEqual({ total: 2, enviado: true });
    const texto = (notifyStaff as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(texto).toContain('*Lucas*');
    expect(texto).toContain('Pipeelo & Provedor X');
    expect(texto).toContain('• Ana (gestor(a), Comercial) — (43) 99666-1541');
    expect(texto).toContain('• Bia — (43) 99111-2233');
    expect(texto).not.toContain('Caio');
    expect(texto).not.toContain('Dani');
    expect(updateParticipants).not.toHaveBeenCalled();
    expect(getParticipants).not.toHaveBeenCalled();
    expect(getInviteUrl).not.toHaveBeenCalled();
  });

  it('sem ninguém para entrar, não manda nada', async () => {
    const r = await pedirEquipeNoGrupo(sb([]), 's1', 'Provedor X');
    expect(r).toEqual({ total: 0, enviado: false });
    expect(notifyStaff).not.toHaveBeenCalled();
  });

  it('erro de banco vira aviso no Staff e não lança', async () => {
    const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), in: vi.fn(async () => ({ data: null, error: new Error('db fora') })) };
    const r = await pedirEquipeNoGrupo({ from: vi.fn(() => chain) } as never, 's1', 'X');
    expect(r).toEqual({ total: 0, enviado: false });
    expect((notifyStaff as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('db fora');
  });

  it('telefone fora do padrão sai como foi digitado', () => {
    expect(mensagemEquipeNoGrupo('X', [{ nome: 'Zé', whatsapp: '123' }])).toContain('• Zé — 123');
  });
});
