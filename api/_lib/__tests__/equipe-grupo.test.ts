import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('../evolution', () => ({
  toJid: (phoneDigits: string) => {
    let d = phoneDigits.replace(/\D/g, '');
    if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
    if (d.length !== 10 && d.length !== 11) throw new Error('telefone_invalido');
    return `55${d}@s.whatsapp.net`;
  },
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
}));
vi.mock('../evolution-fila', () => ({ enfileirar: vi.fn(async () => 0) }));
vi.mock('../staff-notify', () => ({ notifyStaff: vi.fn(async () => ({ sent: true })) }));
import { enfileirar } from '../evolution-fila';
import type { NovoItem } from '../evolution-fila';
import { notifyStaff } from '../staff-notify';
import { addTeamToGroup } from '../equipe-grupo';

const mock = (f: unknown) => f as never as ReturnType<typeof vi.fn>;
const enfileirados = (): NovoItem[] => mock(enfileirar).mock.calls.flatMap((c) => c[1] as NovoItem[]);
const avisoStaff = (): string => String(mock(notifyStaff).mock.calls.at(-1)?.[0] ?? '');

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
const opts = { empresaNome: 'Provedor X', instancia: 'grupos' as const, inviteUrl: 'https://chat.whatsapp.com/abc' };

describe('addTeamToGroup', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => { delete process.env.GRUPO_SOMENTE_RESPONSAVEL; });

  it('enfileira uma entrada por pessoa em vez de mandar a equipe toda de uma vez', async () => {
    const r = await addTeamToGroup(sb([{ pergunta_id: 'equipe_pessoas', valor: pessoas }]), 's1', '1@g.us', opts);

    const adds = enfileirados().filter((i) => i.tipo === 'add');
    expect(adds.map((a) => a.payload?.jid)).toEqual(['5543996661541@s.whatsapp.net', '5543991112233@s.whatsapp.net']);
    expect(adds.every((a) => a.instancia === 'grupos')).toBe(true);
    expect(r).toEqual({ enfileirados: 2, total: 2 });
    expect(avisoStaff()).toContain('2 pessoas entrando aos poucos');
  });

  it('o convite por e-mail fica para o resumo, que roda depois dos adds', async () => {
    await addTeamToGroup(sb([{ pergunta_id: 'equipe_pessoas', valor: pessoas }]), 's1', '1@g.us', opts);

    const resumo = enfileirados().find((i) => i.tipo === 'resumo');
    expect(resumo?.chave).toBe('resumo-equipe:s1');
    expect(resumo?.payload?.inviteUrl).toBe('https://chat.whatsapp.com/abc');
    expect(resumo?.payload?.esperados).toEqual([
      { jid: '5543996661541@s.whatsapp.net', nome: 'Ana', email: 'ana@x.com' },
      { jid: '5543991112233@s.whatsapp.net', nome: 'Bia', email: 'bia@x.com' },
    ]);
    // O resumo é o último item: só faz sentido depois que os adds rodarem.
    expect(enfileirados().at(-1)).toBe(resumo);
  });

  it('grupo antigo continua no número histórico, que é o admin dele', async () => {
    await addTeamToGroup(sb([{ pergunta_id: 'equipe_pessoas', valor: [pessoas[0]] }]), 's1', 'velho@g.us', { empresaNome: 'X' });
    expect(enfileirados().every((i) => i.instancia === 'padrao')).toBe(true);
  });

  it('sem equipe cadastrada não enfileira nada', async () => {
    const r = await addTeamToGroup(sb([]), 's1', '1@g.us', opts);
    expect(r).toEqual({ enfileirados: 0, total: 0 });
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it('ignora número inválido sem derrubar os outros', async () => {
    const r = await addTeamToGroup(
      sb([{ pergunta_id: 'equipe_pessoas', valor: [pessoas[0], { nome: 'Zé', email: 'z@x.com', whatsapp: '123', adicionar_grupo: 'sim' }] }]),
      's1', '1@g.us', opts
    );
    expect(r.total).toBe(1);
  });

  it('aceita whatsapp digitado com +55 na frente', async () => {
    await addTeamToGroup(
      sb([{ pergunta_id: 'equipe_pessoas', valor: [{ nome: 'Ana', email: 'ana@x.com', whatsapp: '+55 43 99666-1541', adicionar_grupo: 'sim' }] }]),
      's1', '1@g.us', opts
    );
    const adds = enfileirados().filter((i) => i.tipo === 'add');
    expect(adds.map((a) => a.payload?.jid)).toEqual(['5543996661541@s.whatsapp.net']);
  });

  it('a chave do add é a mesma usada na criação do grupo — ninguém entra duas vezes', async () => {
    await addTeamToGroup(sb([{ pergunta_id: 'equipe_pessoas', valor: [pessoas[0]] }]), 's1', '1@g.us', opts);
    expect(enfileirados()[0].chave).toBe('add:s1:554396661541');
  });

  describe('modo contenção (GRUPO_SOMENTE_RESPONSAVEL)', () => {
    beforeEach(() => { process.env.GRUPO_SOMENTE_RESPONSAVEL = 'true'; });

    it('não adiciona ninguém: pede ao responsável que chame a equipe', async () => {
      const r = await addTeamToGroup(
        sb([{ pergunta_id: 'equipe_pessoas', valor: pessoas }]), 's1', '1@g.us',
        { ...opts, responsavelNome: 'Ana' }
      );

      expect(enfileirados().some((i) => i.tipo === 'add')).toBe(false);
      const pedido = enfileirados().find((i) => i.chave === 'pedido-equipe:s1');
      expect(pedido?.tipo).toBe('texto');
      expect(pedido?.payload?.texto).toContain('Ana, pode adicionar aqui no grupo');
      expect(pedido?.payload?.texto).toContain('Bia — (43) 99111-2233');
      // Total continua sendo o tamanho da equipe; ninguém foi enfileirado por nós.
      expect(r).toEqual({ enfileirados: 0, total: 2 });
      expect(avisoStaff()).toContain('modo contenção');
    });

    it('sem saber o nome do responsável, o pedido continua fazendo sentido', async () => {
      await addTeamToGroup(sb([{ pergunta_id: 'equipe_pessoas', valor: [pessoas[0]] }]), 's1', '1@g.us', opts);
      const pedido = enfileirados().find((i) => i.chave === 'pedido-equipe:s1');
      expect(pedido?.payload?.texto).toContain('Pode adicionar aqui no grupo');
    });
  });
});
