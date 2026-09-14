import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_lib/supabase', () => ({ getServiceSupabase: vi.fn() }));
vi.mock('../../_lib/evolution', async (orig) => ({
  chaveNumero: ((await orig()) as { chaveNumero: unknown }).chaveNumero,
  getParticipants: vi.fn(async () => []),
  listarGruposDaPrincipal: vi.fn(),
}));
vi.mock('../../_lib/grupo-vincular', () => ({ vincularGruposManuais: vi.fn() }));
vi.mock('../../_lib/cadastro-grupo', () => ({ enviarBoasVindasNoGrupo: vi.fn(async () => undefined) }));
vi.mock('../../_lib/staff-notify', () => ({ notifyStaff: vi.fn(async () => ({ sent: true })) }));

import { getServiceSupabase } from '../../_lib/supabase';
import { listarGruposDaPrincipal } from '../../_lib/evolution';
import { vincularGruposManuais } from '../../_lib/grupo-vincular';
import { enviarBoasVindasNoGrupo } from '../../_lib/cadastro-grupo';
import { enviarBoasVindasPendentes } from '../grupo-boas-vindas';

const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;

/** Cada consulta ao banco consome o próximo resultado da fila, na ordem em que o código pergunta. */
function supabaseComRespostas(respostas: Array<{ count?: number; data?: unknown[] }>) {
  const fila = [...respostas];
  const from = vi.fn(() => {
    const r = fila.shift() ?? { data: [] };
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'is', 'not', 'eq']) chain[m] = vi.fn(() => chain);
    chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ error: null, count: r.count ?? null, data: r.data ?? null }).then(ok);
    return chain;
  });
  return { from } as never;
}

const upload = { path: 'p', nome_original: 'a.pdf', tamanho: 1 };
const cadastro = {
  cnpj: '11222333000181', razao_social: 'OLV LTDA', nome_fantasia: 'OLV TELECOM', inscricao_estadual: 'Isento',
  cobranca_email: 'f@x.com', cobranca_telefone: '6233221100', dia_vencimento: 10, contrato_email: 'j@x.com',
  doc_contrato_social: [upload], doc_responsaveis: [upload],
  responsavel_nome: 'Samuel', responsavel_cargo: 'CEO', responsavel_email: 's@x.com', responsavel_whatsapp: '62998401444',
  contatos_extras: [], aceite_dados: true,
};

describe('watcher de grupo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('nada esperando: não consulta a Evolution', async () => {
    fn(getServiceSupabase).mockReturnValue(supabaseComRespostas([{ count: 0 }, { count: 0 }]));
    const r = await enviarBoasVindasPendentes();
    expect(r.ocioso).toBe(true);
    expect(listarGruposDaPrincipal).not.toHaveBeenCalled();
  });

  it('Lucas criou o grupo: vincula e manda as boas-vindas na mesma rodada', async () => {
    const grupo = { id: 'olv@g.us', subject: 'Pipeelo & OLV TELECOM', creation: 1, participantes: ['556298401444@s.whatsapp.net'] };
    fn(listarGruposDaPrincipal).mockResolvedValue([grupo]);
    fn(vincularGruposManuais).mockResolvedValue({ pendentes: 1, vinculados: ['olv@g.us'], erros: [] });
    fn(getServiceSupabase).mockReturnValue(
      supabaseComRespostas([
        { count: 1 }, // sessão esperando grupo
        { data: [{ id: 's1', slug: 'x', grupo_jid: 'olv@g.us', cadastro, notificacao_boas_vindas_enviada_at: null }] },
      ]),
    );

    const r = await enviarBoasVindasPendentes();
    expect(r.vinculados).toEqual(['olv@g.us']);
    expect(r.enviadas).toBe(1);
    expect(fn(enviarBoasVindasNoGrupo).mock.calls[0][2]).toBe('olv@g.us');
  });

  it('grupo vinculado mas cliente ainda fora: segura as boas-vindas', async () => {
    const grupo = { id: 'olv@g.us', subject: 'Pipeelo & OLV TELECOM', creation: 1, participantes: ['554431701331@s.whatsapp.net'] };
    fn(listarGruposDaPrincipal).mockResolvedValue([grupo]);
    fn(vincularGruposManuais).mockResolvedValue({ pendentes: 0, vinculados: [], erros: [] });
    fn(getServiceSupabase).mockReturnValue(
      supabaseComRespostas([
        { count: 0 },
        { count: 1 }, // esperando boas-vindas
        { data: [{ id: 's1', slug: 'x', grupo_jid: 'olv@g.us', cadastro, notificacao_boas_vindas_enviada_at: null }] },
      ]),
    );

    const r = await enviarBoasVindasPendentes();
    expect(r.erros).toEqual([]);
    expect(r.enviadas).toBe(0);
    expect(enviarBoasVindasNoGrupo).not.toHaveBeenCalled();
  });
});
