import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_lib/supabase', () => ({ getServiceSupabase: () => ({ from: vi.fn() }) }));
vi.mock('../../_lib/evolution', () => ({
  updateParticipants: vi.fn(async () => undefined),
  sendText: vi.fn(async () => ({ ok: true })),
  getParticipants: vi.fn(async () => []),
  groupSubject: (n: string) => `Pipeelo & ${n}`,
  chaveNumero: (j: string) => {
    let d = j.replace(/@.*$/, '').replace(/\D/g, '');
    if ((d.length === 10 || d.length === 11) && !d.startsWith('55')) d = `55${d}`;
    if (d.length === 13 && d.startsWith('55') && d[4] === '9') d = d.slice(0, 4) + d.slice(5);
    return d;
  },
  EvolutionConfigError: class extends Error {},
}));
vi.mock('../../_lib/staff-notify', () => ({ notifyStaff: vi.fn(async () => ({ sent: true })) }));
vi.mock('../../_lib/email-sender', () => ({ sendTransactionalEmail: vi.fn(async () => ({ skipped: false })) }));
vi.mock('../../_lib/evolution-fila', () => ({
  ganharSlot: vi.fn(async () => true),
  proximoItem: vi.fn(async () => null),
  reivindicar: vi.fn(async () => true),
  concluir: vi.fn(async () => undefined),
  falhar: vi.fn(async () => undefined),
  pausarFila: vi.fn(async () => undefined),
  resumoDaSessao: vi.fn(async () => ({ pendentes: 0, feitos: 3, falhados: 0, total: 3 })),
}));

import { updateParticipants, sendText, getParticipants } from '../../_lib/evolution';
import { notifyStaff } from '../../_lib/staff-notify';
import { sendTransactionalEmail } from '../../_lib/email-sender';
import { ganharSlot, proximoItem, reivindicar, concluir, falhar, pausarFila } from '../../_lib/evolution-fila';
import type { ItemFila } from '../../_lib/evolution-fila';
import handler, { drenarFilaEvolution } from '../evolution-fila';

const mock = (f: unknown) => f as never as ReturnType<typeof vi.fn>;

const addItem: ItemFila = {
  id: 'i1', session_id: 's1', tipo: 'add', grupo_jid: '1@g.us', instancia: 'grupos',
  payload: { jid: '5511900000001@s.whatsapp.net' }, chave: 'add:s1:551190000001',
  status: 'pendente', tentativas: 0, max_tentativas: 5,
};

function res() {
  const r: Record<string, unknown> = {};
  r.status = vi.fn(() => r);
  r.json = vi.fn(() => r);
  r.end = vi.fn(() => r);
  return r as never;
}

describe('drenarFilaEvolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock(ganharSlot).mockResolvedValue(true);
    mock(reivindicar).mockResolvedValue(true);
    mock(proximoItem).mockResolvedValue(null);
    mock(getParticipants).mockResolvedValue([]);
    mock(updateParticipants).mockResolvedValue(undefined);
  });

  it('fila vazia: nem toma o slot, nem chama a Evolution', async () => {
    expect(await drenarFilaEvolution()).toEqual({ processado: 0 });
    expect(ganharSlot).not.toHaveBeenCalled();
    expect(updateParticipants).not.toHaveBeenCalled();
  });

  it('slot ainda não liberado: não reivindica nem age', async () => {
    mock(proximoItem).mockResolvedValue(addItem);
    mock(ganharSlot).mockResolvedValue(false);

    expect(await drenarFilaEvolution()).toEqual({ processado: 0 });
    expect(reivindicar).not.toHaveBeenCalled();
    expect(updateParticipants).not.toHaveBeenCalled();
  });

  it('outro worker levou o item: não age', async () => {
    mock(proximoItem).mockResolvedValue(addItem);
    mock(reivindicar).mockResolvedValue(false);

    expect(await drenarFilaEvolution()).toEqual({ processado: 0 });
    expect(updateParticipants).not.toHaveBeenCalled();
  });

  it('add: uma única ação por rodada, na instância dona do grupo', async () => {
    mock(proximoItem).mockResolvedValue(addItem);

    expect(await drenarFilaEvolution()).toEqual({ processado: 1, tipo: 'add' });
    expect(updateParticipants).toHaveBeenCalledTimes(1);
    expect(updateParticipants).toHaveBeenCalledWith('1@g.us', 'add', ['5511900000001@s.whatsapp.net'], 'grupos');
    // Primeira tentativa não gasta chamada conferindo participantes.
    expect(getParticipants).not.toHaveBeenCalled();
    expect(concluir).toHaveBeenCalledWith(expect.anything(), 'i1');
  });

  it('add em retentativa confere antes e não readiciona quem já entrou', async () => {
    mock(proximoItem).mockResolvedValue({ ...addItem, tentativas: 2 });
    mock(getParticipants).mockResolvedValue(['5511900000001@s.whatsapp.net']);

    expect(await drenarFilaEvolution()).toEqual({ processado: 1, tipo: 'add' });
    expect(getParticipants).toHaveBeenCalledWith('1@g.us', 'grupos');
    expect(updateParticipants).not.toHaveBeenCalled();
  });

  it('texto sai pela instância do item', async () => {
    mock(proximoItem).mockResolvedValue({ ...addItem, tipo: 'texto', payload: { texto: 'bem-vindo' } });

    expect(await drenarFilaEvolution()).toEqual({ processado: 1, tipo: 'texto' });
    expect(sendText).toHaveBeenCalledWith('1@g.us', 'bem-vindo', 'grupos');
  });

  it('rate-overlimit devolve o item e pausa a fila inteira', async () => {
    mock(proximoItem).mockResolvedValue(addItem);
    mock(updateParticipants).mockRejectedValue(new Error('{"message":"rate-overlimit"}'));

    const r = await drenarFilaEvolution();

    expect(r.pausada).toBe(true);
    expect(falhar).toHaveBeenCalled();
    expect(pausarFila).toHaveBeenCalledWith(expect.anything(), 10, expect.stringContaining('rate limit'));
    expect(concluir).not.toHaveBeenCalled();
  });

  it('instância fora do ar pausa a fila e avisa o Staff — não fica martelando o número', async () => {
    mock(proximoItem).mockResolvedValue(addItem);
    mock(updateParticipants).mockRejectedValue(new Error('Connection Closed'));

    const r = await drenarFilaEvolution();

    expect(r.pausada).toBe(true);
    expect(pausarFila).toHaveBeenCalledWith(expect.anything(), 15, expect.stringContaining('indisponível'));
    expect(notifyStaff).toHaveBeenCalledWith(expect.stringContaining('Fila de grupos pausada'));
  });

  it('erro comum devolve o item pra fila sem pausar', async () => {
    mock(proximoItem).mockResolvedValue(addItem);
    mock(updateParticipants).mockRejectedValue(new Error('participante inválido'));

    const r = await drenarFilaEvolution();

    expect(r).toEqual({ processado: 0, erro: 'participante inválido' });
    expect(pausarFila).not.toHaveBeenCalled();
  });

  it('resumo: confere quem entrou de fato, convida por e-mail quem ficou de fora e fecha com o Staff', async () => {
    mock(proximoItem).mockResolvedValue({
      ...addItem, tipo: 'resumo',
      payload: {
        empresa: 'Provedor X', inviteUrl: 'https://chat.whatsapp.com/abc',
        esperados: [
          { jid: '5511900000001@s.whatsapp.net', nome: 'Bia', email: 'bia@x.com' },
          { jid: '5511900000002@s.whatsapp.net', nome: 'Caio', email: 'caio@x.com' },
        ],
      },
    });
    // Só a Bia entrou; o Caio foi barrado pela privacidade (o add não falha).
    mock(getParticipants).mockResolvedValue(['5511900000001@s.whatsapp.net']);

    expect(await drenarFilaEvolution()).toEqual({ processado: 1, tipo: 'resumo' });
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'caio@x.com',
      props: expect.objectContaining({ inviteUrl: 'https://chat.whatsapp.com/abc' }),
    }));
    expect(notifyStaff).toHaveBeenCalledWith(expect.stringContaining('Caio'));
  });
});

describe('handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('401 sem CRON_SECRET configurado (fail-secure)', async () => {
    delete process.env.CRON_SECRET;
    const r = res();
    await handler({ method: 'POST', headers: {} } as never, r);
    expect(r.status).toHaveBeenCalledWith(401);
  });

  it('401 com token errado', async () => {
    vi.stubEnv('CRON_SECRET', 'segredo');
    const r = res();
    await handler({ method: 'POST', headers: { authorization: 'Bearer outro' } } as never, r);
    expect(r.status).toHaveBeenCalledWith(401);
    vi.unstubAllEnvs();
  });

  it('200 com o token certo', async () => {
    vi.stubEnv('CRON_SECRET', 'segredo');
    mock(proximoItem).mockResolvedValue(null);
    const r = res();
    await handler({ method: 'POST', headers: { authorization: 'Bearer segredo' } } as never, r);
    expect(r.status).toHaveBeenCalledWith(200);
    vi.unstubAllEnvs();
  });
});
