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

describe('sendText escolhe a instância pelo destino', () => {
  it('grupo sai pela Grupos; DM sai pelo Avisos', async () => {
    process.env.EVOLUTION_GROUP_INSTANCE = 'Grupos';
    process.env.EVOLUTION_GROUP_API_KEY = 'chave-grupos';
    const chamadas: Array<{ url: string; key: string }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      chamadas.push({ url, key: (init.headers as Record<string, string>).apikey });
      return { ok: true, status: 200, json: async () => ([]), text: async () => '' } as unknown as Response;
    });

    await sendText('120363@g.us', 'oi grupo');
    expect(chamadas.at(-1)).toEqual({ url: 'https://evo.teste/message/sendText/Grupos', key: 'chave-grupos' });

    chamadas.length = 0;
    await sendText('5543999998888@s.whatsapp.net', 'oi pessoa');
    // 1ª chamada resolve o JID, 2ª manda — as duas na instância principal.
    expect(chamadas.every((c) => c.key === 'chave-avisos')).toBe(true);
    expect(chamadas.at(-1)!.url).toBe('https://evo.teste/message/sendText/Avisos');
  });
});
