import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../evolution', () => ({
  groupSubject: (n: string) => `Pipeelo & ${n}`,
  toJid: (d: string) => `55${d}@s.whatsapp.net`,
  chaveNumero: (j: string) => j.replace(/\D/g, ''),
  createGroup: vi.fn(),
  updateParticipants: vi.fn(),
  getParticipants: vi.fn(),
  getInviteUrl: vi.fn(),
  sendText: vi.fn(),
  EvolutionApiError: class extends Error {},
  EvolutionConfigError: class extends Error {},
}));
vi.mock('../short-links', () => ({
  ensureShortLink: vi.fn(async () => ({ code: 'abc123', short_url: 'https://onboarding.pipeelo.com/s/abc123' })),
  onboardingTargetUrl: () => 'https://onboarding.pipeelo.com/slug?token=t',
}));
vi.mock('../staff-notify', () => ({ notifyStaff: vi.fn(async () => ({ sent: true })), notifySocios: vi.fn(async () => ({ sent: true })) }));
vi.mock('../email-sender', () => ({ sendTransactionalEmail: vi.fn() }));

import { notifyStaff, notifySocios } from '../staff-notify';
import { ensureShortLink } from '../short-links';
import { mensagemInstrucoesGrupo, mensagemSociosNovoCliente, enviarInstrucoesGrupo } from '../grupo-instrucoes';
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

function makeSupabase() {
  const updates: unknown[] = [];
  const eq = vi.fn(async () => ({ error: null }));
  const update = vi.fn((patch: unknown) => { updates.push(patch); return { eq }; });
  const from = vi.fn(() => ({ update }));
  return { client: { from } as never, updates };
}

describe('mensagemInstrucoesGrupo', () => {
  it('traz nome do grupo, contatos com telefone formatado e o admin marcado', () => {
    const m = mensagemInstrucoesGrupo(cadastro, 'https://onboarding.pipeelo.com/s/abc123');
    expect(m).toContain('Pipeelo & Provedor X');
    expect(m).toContain('Lucas');
    expect(m).toContain('• Ana — (43) 99666-1541 — *deixar como admin*');
    expect(m).toContain('• João — (43) 99111-2233');
    // Só o responsável vira admin.
    expect(m.match(/deixar como admin/g)).toHaveLength(1);
  });

  it('Lucas só cria o grupo: sem mensagem para colar, com o Avisos na lista', () => {
    const m = mensagemInstrucoesGrupo(cadastro, 'https://onboarding.pipeelo.com/s/abc123');
    expect(m).not.toContain('Parabéns pela decisão');
    expect(m).not.toContain('Mandar esta mensagem');
    expect(m).toContain('(44) 3170-1331');
    expect(m).toContain('manda as boas-vindas com o link do formulário sozinho');
    expect(m).toContain('https://onboarding.pipeelo.com/s/abc123');
  });

  it('resume o fechamento comercial para a equipe saber o que vem: ERP, sessões, CRM', () => {
    const m = mensagemInstrucoesGrupo(cadastro, 'x', { erp: 'MK Solution', qtd_sessoes: 5500, valor_mensal: 3300, contratou_crm: true, go_live_em: '2026-10-18' });
    expect(m).toContain('ERP: MK Solution');
    expect(m).toContain('5.500 sessões/mês');
    // Valor é assunto dos sócios, não do Staff.
    expect(m).not.toContain('R$');
    expect(m).toContain('CRM: sim');
    expect(m).toContain('go-live 18/10/2026');
  });

  it('fechamento sem dado não inventa: mostra "não informado"', () => {
    const m = mensagemInstrucoesGrupo(cadastro, 'x', { erp: null, qtd_sessoes: null, valor_mensal: null, contratou_crm: null, go_live_em: null });
    expect(m).toContain('ERP: não informado');
    expect(m).toContain('sessões/mês: não informado');
    expect(m).toContain('CRM: não');
    expect(m).not.toContain('go-live');
  });

  it('resume documentos, e-mail do contrato e vencimento', () => {
    const m = mensagemInstrucoesGrupo(cadastro, 'x');
    expect(m).toContain('2 documentos');
    expect(m).toContain('contrato → j@x.com');
    expect(m).toContain('vencimento dia 10');
  });
});

describe('mensagemSociosNovoCliente', () => {
  it('traz o fechamento com o valor mensal', () => {
    const m = mensagemSociosNovoCliente(cadastro, { erp: 'IXC', qtd_sessoes: 3000, valor_mensal: 1800, contratou_crm: false, go_live_em: null });
    expect(m).toContain('Novo cliente: Provedor X');
    expect(m).toContain('ERP: IXC');
    expect(m).toContain('3.000 sessões/mês');
    expect(m).toContain('R$ 1.800,00/mês');
    expect(m).toContain('CRM: não');
  });

  it('sem valor mensal diz que não foi informado', () => {
    const m = mensagemSociosNovoCliente(cadastro, { valor_mensal: null });
    expect(m).toContain('mensalidade: não informada');
  });
});

describe('enviarInstrucoesGrupo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gera o link, avisa o Staff e carimba a sessão', async () => {
    const sb = makeSupabase();
    const r = await enviarInstrucoesGrupo(sb.client, sessao, cadastro);

    expect(ensureShortLink).toHaveBeenCalledTimes(1);
    expect(notifyStaff).toHaveBeenCalledTimes(1);
    expect(notifySocios).toHaveBeenCalledTimes(1);
    expect(String(notifySocios.mock.calls[0][0])).toContain('Novo cliente: Provedor X');
    expect(r).toEqual({ status: 'enviado', short_url: 'https://onboarding.pipeelo.com/s/abc123' });
    expect(sb.updates).toHaveLength(1);
    expect(sb.updates[0]).toMatchObject({ grupo_erro: null });
    expect((sb.updates[0] as { grupo_instrucoes_enviadas_at: string }).grupo_instrucoes_enviadas_at).toBeTruthy();
  });

  it('Staff sem JID configurado: registra o motivo e não carimba', async () => {
    (notifyStaff as never as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ sent: false, reason: 'staff_jid_unset' });
    const sb = makeSupabase();
    const r = await enviarInstrucoesGrupo(sb.client, sessao, cadastro);

    expect(r.status).toBe('falhou');
    expect(sb.updates[0]).toEqual({ grupo_erro: 'instruções não chegaram ao Staff: staff_jid_unset' });
  });

  it('link curto falhou: não derruba o cadastro, só grava o erro', async () => {
    (ensureShortLink as never as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('shortlink_generation_failed'));
    const sb = makeSupabase();
    const r = await enviarInstrucoesGrupo(sb.client, sessao, cadastro);

    expect(r.status).toBe('falhou');
    expect(notifyStaff).not.toHaveBeenCalled();
    expect(sb.updates[0]).toEqual({ grupo_erro: 'instruções de grupo: shortlink_generation_failed' });
  });
});
