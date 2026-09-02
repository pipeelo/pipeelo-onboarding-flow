import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  chaveNumero, mesmoNumero, toJid, groupSubject, createGroup, updateParticipants, getParticipants, getInviteUrl,
  EvolutionApiError,
} from '../evolution';

const ENV = { EVOLUTION_API_BASE_URL: 'https://evo.test/', EVOLUTION_API_INSTANCE: 'Avisos', EVOLUTION_API_KEY: 'k' };

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => ({
    ok: status < 400, status,
    json: async () => body, text: async () => JSON.stringify(body),
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('evolution grupo', () => {
  beforeEach(() => { Object.assign(process.env, ENV); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('toJid monta o JID com 55', () => {
    expect(toJid('43996661541')).toBe('5543996661541@s.whatsapp.net');
    expect(toJid('4333221100')).toBe('554333221100@s.whatsapp.net');
  });
  it('toJid rejeita número curto', () => {
    expect(() => toJid('99666')).toThrow('telefone_invalido');
  });
  it('toJid aceita número já com o 55 na frente', () => {
    expect(toJid('+55 43 99666-1541')).toBe('5543996661541@s.whatsapp.net');
    expect(toJid('5543996661541')).toBe('5543996661541@s.whatsapp.net');
  });
  it('chaveNumero iguala celular com e sem o nono dígito', () => {
    expect(chaveNumero('5543996661541@s.whatsapp.net')).toBe('554396661541');
    expect(chaveNumero('554396661541@s.whatsapp.net')).toBe('554396661541');
    expect(chaveNumero('43996661541')).toBe('554396661541');
    expect(mesmoNumero('5543996661541@s.whatsapp.net', '554396661541@s.whatsapp.net')).toBe(true);
    expect(mesmoNumero('5543996661541@s.whatsapp.net', '5543991112233@s.whatsapp.net')).toBe(false);
  });
  it('groupSubject aplica o padrão', () => {
    expect(groupSubject('  Provedor X ')).toBe('Pipeelo & Provedor X');
  });

  it('createGroup chama /group/create e lê groupJid', async () => {
    const f = mockFetch(201, { groupJid: '1@g.us', inviteCode: 'abc' });
    const r = await createGroup('Pipeelo & X', ['5543996661541@s.whatsapp.net']);
    expect(r).toEqual({ groupJid: '1@g.us', inviteCode: 'abc' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://evo.test/group/create/Avisos');
    expect(JSON.parse(String(init.body))).toEqual({
      subject: 'Pipeelo & X', participants: ['5543996661541@s.whatsapp.net'],
    });
  });
  it('createGroup aceita resposta no formato metadata (id)', async () => {
    mockFetch(201, { id: '2@g.us', subject: 'x' });
    const r = await createGroup('x', []);
    expect(r).toEqual({ groupJid: '2@g.us', inviteCode: null });
  });
  it('createGroup propaga erro HTTP', async () => {
    mockFetch(500, { message: 'boom' });
    await expect(createGroup('x', [])).rejects.toBeInstanceOf(EvolutionApiError);
  });

  it('updateParticipants usa POST /group/updateParticipant com groupJid na query', async () => {
    const f = mockFetch(200, {});
    await updateParticipants('1@g.us', 'promote', ['a@s.whatsapp.net']);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://evo.test/group/updateParticipant/Avisos?groupJid=1%40g.us');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ action: 'promote', participants: ['a@s.whatsapp.net'] });
  });

  it('getParticipants devolve só os JIDs', async () => {
    mockFetch(200, { participants: [{ id: 'a@s.whatsapp.net', admin: 'admin' }, { id: 'b@s.whatsapp.net' }] });
    expect(await getParticipants('1@g.us')).toEqual(['a@s.whatsapp.net', 'b@s.whatsapp.net']);
  });
  it('getParticipants prefere phoneNumber quando o id vem como @lid (Evolution 2.3.x)', async () => {
    mockFetch(200, { participants: [{ id: '8996@lid', phoneNumber: '5543996661541@s.whatsapp.net' }, { id: 'c@s.whatsapp.net', phoneNumber: null }] });
    expect(await getParticipants('1@g.us')).toEqual(['5543996661541@s.whatsapp.net', 'c@s.whatsapp.net']);
  });
  it('getParticipants aceita array puro', async () => {
    mockFetch(200, [{ id: 'a@s.whatsapp.net' }]);
    expect(await getParticipants('1@g.us')).toEqual(['a@s.whatsapp.net']);
  });

  it('getInviteUrl monta URL a partir do inviteCode', async () => {
    mockFetch(200, { inviteCode: 'XyZ' });
    expect(await getInviteUrl('1@g.us')).toBe('https://chat.whatsapp.com/XyZ');
  });
  it('getInviteUrl prefere inviteUrl quando vem pronto', async () => {
    mockFetch(200, { inviteCode: 'XyZ', inviteUrl: 'https://chat.whatsapp.com/XyZ' });
    expect(await getInviteUrl('1@g.us')).toBe('https://chat.whatsapp.com/XyZ');
  });
});
