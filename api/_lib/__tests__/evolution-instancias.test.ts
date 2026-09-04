// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { alvoDoJid, ehGrupo, getConfig, sendText } from '../evolution';

const ENV = { ...process.env };

beforeEach(() => {
  process.env.EVOLUTION_API_BASE_URL = 'https://evo.teste/';
  process.env.EVOLUTION_API_INSTANCE = 'Avisos';
  process.env.EVOLUTION_API_KEY = 'chave-avisos';
  delete process.env.EVOLUTION_GROUP_INSTANCE;
  delete process.env.EVOLUTION_GROUP_API_KEY;
});
afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

describe('alvo por JID', () => {
  it('reconhece grupo e individual', () => {
    expect(ehGrupo('120363@g.us')).toBe(true);
    expect(ehGrupo('5543999998888@s.whatsapp.net')).toBe(false);
    expect(alvoDoJid('120363@g.us')).toBe('group');
    expect(alvoDoJid('5543999998888@s.whatsapp.net')).toBe('main');
  });
});

describe('getConfig', () => {
  it('sem envs de grupo, tudo cai na instância principal', () => {
    expect(getConfig('group')).toEqual({ baseUrl: 'https://evo.teste', instance: 'Avisos', apiKey: 'chave-avisos' });
  });

  it('com as duas envs, grupo usa a instância dedicada', () => {
    process.env.EVOLUTION_GROUP_INSTANCE = 'Grupos';
    process.env.EVOLUTION_GROUP_API_KEY = 'chave-grupos';
    expect(getConfig('group')).toEqual({ baseUrl: 'https://evo.teste', instance: 'Grupos', apiKey: 'chave-grupos' });
    expect(getConfig('main')).toEqual({ baseUrl: 'https://evo.teste', instance: 'Avisos', apiKey: 'chave-avisos' });
  });

  it('instância de grupo sem chave não separa — evita autenticar na instância errada', () => {
    process.env.EVOLUTION_GROUP_INSTANCE = 'Grupos';
    expect(getConfig('group').instance).toBe('Avisos');
  });
});

describe('sendText manda pelo número que ESTÁ no grupo', () => {
  beforeEach(() => {
    process.env.EVOLUTION_GROUP_INSTANCE = 'Grupos';
    process.env.EVOLUTION_GROUP_API_KEY = 'chave-grupos';
  });

  type Chamada = { url: string; key: string };

  function stubFetch(chamadas: Chamada[], participantesDaGrupos: unknown) {
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      chamadas.push({ url, key: (init.headers as Record<string, string>).apikey });
      if (url.includes('/group/participants/')) {
        if (participantesDaGrupos === null) {
          return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as unknown as Response;
        }
        return { ok: true, status: 200, json: async () => participantesDaGrupos, text: async () => '' } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ([]), text: async () => '' } as unknown as Response;
    });
  }

  it('grupo da instância de grupos: sonda encontra participantes e manda por ela', async () => {
    const chamadas: Chamada[] = [];
    stubFetch(chamadas, { participants: [{ id: '1@lid' }] });

    await sendText('120363@g.us', 'oi grupo');

    expect(chamadas[0].url).toContain('/group/participants/Grupos');
    expect(chamadas.at(-1)).toEqual({ url: 'https://evo.teste/message/sendText/Grupos', key: 'chave-grupos' });
  });

  it('grupo ANTIGO (a instância de grupos não participa): cai na principal', async () => {
    // Regressão da VIBE em 04/09/2026: a mensagem de conclusão sumiu porque saía
    // pela instância de grupos, que não está nos grupos criados antes dela.
    const chamadas: Chamada[] = [];
    stubFetch(chamadas, null);

    await sendText('120363@g.us', 'oi grupo antigo');

    expect(chamadas[0].url).toContain('/group/participants/Grupos');
    expect(chamadas.at(-1)).toEqual({ url: 'https://evo.teste/message/sendText/Avisos', key: 'chave-avisos' });
  });

  it('lista de participantes vazia também cai na principal', async () => {
    const chamadas: Chamada[] = [];
    stubFetch(chamadas, { participants: [] });

    await sendText('120363@g.us', 'oi');

    expect(chamadas.at(-1)!.url).toBe('https://evo.teste/message/sendText/Avisos');
  });

  it('DM não sonda nada e sai sempre pela principal', async () => {
    const chamadas: Chamada[] = [];
    stubFetch(chamadas, { participants: [{ id: '1@lid' }] });

    await sendText('5543999998888@s.whatsapp.net', 'oi pessoa');

    expect(chamadas.some((c) => c.url.includes('/group/participants/'))).toBe(false);
    expect(chamadas.every((c) => c.key === 'chave-avisos')).toBe(true);
    expect(chamadas.at(-1)!.url).toBe('https://evo.teste/message/sendText/Avisos');
  });
});
