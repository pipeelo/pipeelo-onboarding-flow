import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../staff-notify', () => ({ notifyStaff: vi.fn(async () => ({ sent: true })) }));

import { notifyStaff } from '../staff-notify';
import { escolherGrupo, vincularGruposManuais } from '../grupo-vincular';
import type { GrupoDaPrincipal } from '../evolution';

const CADASTRO_EM = '2026-09-14T15:43:27.079Z';
const seg = (iso: string) => Math.floor(Date.parse(iso) / 1000);

const g = (id: string, subject: string, criadoIso: string | null, participantes: string[] = []): GrupoDaPrincipal => ({
  id, subject, creation: criadoIso ? seg(criadoIso) : null, participantes,
});

describe('escolherGrupo', () => {
  it('acha pelo nome exato, sem ligar para caixa, acento e espaço', () => {
    const grupos = [g('a@g.us', 'Pipeelo & Outro', '2026-09-14T16:00:00Z'), g('b@g.us', 'pipeelo &  OLV telecom', '2026-09-14T16:17:54Z')];
    expect(escolherGrupo(grupos, 'OLV TELECOM', '62998401444', CADASTRO_EM)?.grupo.id).toBe('b@g.us');
  });

  it('não pega nome parecido', () => {
    const grupos = [g('a@g.us', 'Pipeelo & OLV TELECOM 2', '2026-09-14T16:00:00Z')];
    expect(escolherGrupo(grupos, 'OLV TELECOM', '62998401444', CADASTRO_EM)).toBeNull();
  });

  it('ignora grupo antigo com o mesmo nome (antes do cadastro, fora da folga)', () => {
    const grupos = [g('velho@g.us', 'Pipeelo & OLV TELECOM', '2026-08-01T10:00:00Z')];
    expect(escolherGrupo(grupos, 'OLV TELECOM', '62998401444', CADASTRO_EM)).toBeNull();
  });

  it('dois com o mesmo nome: vale o que tem o responsável, e entre esses o mais novo', () => {
    const grupos = [
      g('1@g.us', 'Pipeelo & Trixnet', '2026-09-14T16:00:00Z', ['556298401444@s.whatsapp.net']),
      g('2@g.us', 'Pipeelo & Trixnet', '2026-09-14T17:00:00Z', ['556298401444@s.whatsapp.net']),
      g('3@g.us', 'Pipeelo & Trixnet', '2026-09-14T18:00:00Z', []),
    ];
    const r = escolherGrupo(grupos, 'Trixnet', '62998401444', CADASTRO_EM);
    expect(r?.grupo.id).toBe('2@g.us');
    expect(r?.candidatos).toBe(3);
  });

  it('responsável ainda fora: vincula mesmo assim (as boas-vindas esperam ele entrar)', () => {
    const grupos = [g('a@g.us', 'Pipeelo & OLV TELECOM', '2026-09-14T16:17:54Z', ['554431701331@s.whatsapp.net'])];
    expect(escolherGrupo(grupos, 'OLV TELECOM', '62998401444', CADASTRO_EM)?.grupo.id).toBe('a@g.us');
  });
});

function makeSupabase(sessoes: unknown[]) {
  const updates: Array<{ patch: unknown; id: unknown }> = [];
  const select = {
    is: vi.fn(() => select),
    not: vi.fn(() => select),
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: sessoes, error: null }).then(ok),
  };
  const client = {
    from: vi.fn(() => ({
      select: vi.fn(() => select),
      update: vi.fn((patch: unknown) => ({
        eq: vi.fn((_c: string, id: unknown) => ({
          is: vi.fn(async () => { updates.push({ patch, id }); return { error: null }; }),
        })),
      })),
    })),
  };
  return { client: client as never, updates };
}

const upload = { path: 'p', nome_original: 'a.pdf', tamanho: 1 };
const cadastro = {
  cnpj: '11222333000181', razao_social: 'OLV LTDA', nome_fantasia: 'OLV TELECOM', inscricao_estadual: 'Isento',
  cobranca_email: 'f@x.com', cobranca_telefone: '6233221100', dia_vencimento: 10, contrato_email: 'j@x.com',
  doc_contrato_social: [upload], doc_responsaveis: [upload],
  responsavel_nome: 'Samuel', responsavel_cargo: 'CEO', responsavel_email: 's@x.com', responsavel_whatsapp: '62998401444',
  contatos_extras: [], aceite_dados: true,
};

describe('vincularGruposManuais', () => {
  beforeEach(() => vi.clearAllMocks());

  it('grava grupo_jid e a data de criação do grupo', async () => {
    const sb = makeSupabase([{ id: 's1', slug: 'x', empresa_nome: 'OLV TELECOM', cadastro, cadastro_enviado_at: CADASTRO_EM }]);
    const grupos = [g('olv@g.us', 'Pipeelo & OLV TELECOM', '2026-09-14T16:17:54Z', ['556298401444@s.whatsapp.net'])];
    const r = await vincularGruposManuais(sb.client, grupos);

    expect(r.vinculados).toEqual(['olv@g.us']);
    expect(sb.updates).toEqual([{ id: 's1', patch: { grupo_jid: 'olv@g.us', grupo_criado_at: '2026-09-14T16:17:54.000Z', grupo_erro: null } }]);
    expect(notifyStaff).not.toHaveBeenCalled();
  });

  it('sem grupo ainda: não mexe em nada', async () => {
    const sb = makeSupabase([{ id: 's1', slug: 'x', empresa_nome: 'OLV TELECOM', cadastro, cadastro_enviado_at: CADASTRO_EM }]);
    const r = await vincularGruposManuais(sb.client, []);
    expect(r.vinculados).toEqual([]);
    expect(sb.updates).toEqual([]);
  });

  it('mais de um candidato: vincula e avisa o Staff qual escolheu', async () => {
    const sb = makeSupabase([{ id: 's1', slug: 'x', empresa_nome: 'OLV TELECOM', cadastro, cadastro_enviado_at: CADASTRO_EM }]);
    const grupos = [
      g('a@g.us', 'Pipeelo & OLV TELECOM', '2026-09-14T16:00:00Z'),
      g('b@g.us', 'Pipeelo & OLV TELECOM', '2026-09-14T16:30:00Z'),
    ];
    await vincularGruposManuais(sb.client, grupos);
    expect(notifyStaff).toHaveBeenCalledTimes(1);
    expect((notifyStaff as never as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('b@g.us');
  });
});
