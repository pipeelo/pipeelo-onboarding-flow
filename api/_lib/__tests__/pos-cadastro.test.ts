// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../contrato', () => ({
  CONTRATO_BUCKET: 'onboarding-contratos',
  gerarContratoParaSessao: vi.fn(),
}));
vi.mock('../conta-azul', () => ({ cobrarContaAzul: vi.fn() }));
vi.mock('../staff-notify', () => ({ notifyStaff: vi.fn(async () => ({ sent: true })) }));
vi.mock('../assinatura', () => ({ enviarParaAssinatura: vi.fn(async () => ({ status: 'enviado', solicitacao_id: 66, link: 'https://x/l', dm: true, grupo: true, reenvio: false })) }));

import { gerarContratoParaSessao } from '../contrato';
import { cobrarContaAzul } from '../conta-azul';
import { notifyStaff } from '../staff-notify';
import { processarPosCadastro, mensagemStaffPosCadastro, type SessaoPosCadastro } from '../pos-cadastro';
import type { Cadastro } from '../schemas/cadastro';

const upload = { path: 'p', nome_original: 'a.pdf', tamanho: 1 };
const cadastro: Cadastro = {
  cnpj: '11222333000181', razao_social: 'PROVEDOR X LTDA', nome_fantasia: 'Provedor X',
  inscricao_estadual: 'Isento', cobranca_email: 'f@x.com', cobranca_telefone: '4333221100',
  dia_vencimento: 10, contrato_email: 'j@x.com', doc_contrato_social: [upload], doc_responsaveis: [upload],
  responsavel_nome: 'Ana Souza', responsavel_cargo: 'CEO', responsavel_email: 'ana@x.com',
  responsavel_whatsapp: '43996661541', contatos_extras: [], aceite_dados: true,
};

const sessao: SessaoPosCadastro = {
  id: 's1', slug: 'provedor-x', erp: 'IXC', contratou_crm: false,
  valor_sessao: 0.95, qtd_sessoes: 2640, valor_mensal: 2508, dia_vencimento: 10,
  valor_implantacao: 4000, implantacao_vencimento: '2026-09-15', primeira_mensalidade_em: '2026-10-10',
  cadastro_enviado_at: '2026-09-02T12:00:00.000Z',
};

const supabase = {} as never;
const mockContrato = gerarContratoParaSessao as unknown as ReturnType<typeof vi.fn>;
const mockCobranca = cobrarContaAzul as unknown as ReturnType<typeof vi.fn>;
const mockStaff = notifyStaff as unknown as ReturnType<typeof vi.fn>;

const gerado = { status: 'gerado', path: 's1/Contrato.docx', representante: 'Ana Souza', avisos: [] as string[] };
const cobrado = { status: 'cobrado', implantacao_url: 'https://boleto/impl', mensalidade_url: 'https://boleto/mens', recorrente: true };

describe('processarPosCadastro', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PUBLIC_BASE_URL = 'https://onboarding.pipeelo.com';
  });

  it('roda contrato antes da cobrança e avisa o Staff uma vez', async () => {
    const ordem: string[] = [];
    mockContrato.mockImplementation(async () => { ordem.push('contrato'); return gerado; });
    mockCobranca.mockImplementation(async () => { ordem.push('cobranca'); return cobrado; });

    const r = await processarPosCadastro(supabase, sessao, cadastro);

    expect(ordem).toEqual(['contrato', 'cobranca']);
    expect(r.contrato).toEqual(gerado);
    expect(r.cobranca).toEqual(cobrado);
    expect(mockStaff).toHaveBeenCalledTimes(1);
    const texto = String(mockStaff.mock.calls[0][0]);
    expect(texto).toContain('📄 Contrato de Provedor X: gerado — assina Ana Souza');
    expect(texto).toContain('💳 Conta Azul: cliente criado');
    expect(texto).toContain('Painel: https://onboarding.pipeelo.com/admin');
  });

  it('falha no contrato não impede a cobrança nem o aviso', async () => {
    mockContrato.mockRejectedValue(new Error('boom'));
    mockCobranca.mockResolvedValue(cobrado);

    const r = await processarPosCadastro(supabase, sessao, cadastro);

    expect(r.contrato.status).toBe('pendente');
    expect(r.cobranca.status).toBe('cobrado');
    expect(mockStaff).toHaveBeenCalledTimes(1);
  });

  it('contrato já gerado sem erro é pulado', async () => {
    mockCobranca.mockResolvedValue(cobrado);
    const r = await processarPosCadastro(
      supabase,
      { ...sessao, contrato_path: 's1/Contrato.docx', contrato_erro: null, contrato_extracao: { representante: { nome: 'Ana Souza' } } },
      cadastro,
    );
    expect(mockContrato).not.toHaveBeenCalled();
    expect(r.contrato).toMatchObject({ status: 'gerado', path: 's1/Contrato.docx', representante: 'Ana Souza' });
  });

  it('contrato com erro registrado é refeito', async () => {
    mockContrato.mockResolvedValue(gerado);
    mockCobranca.mockResolvedValue(cobrado);
    await processarPosCadastro(supabase, { ...sessao, contrato_path: 's1/x.docx', contrato_erro: 'falhou antes' }, cadastro);
    expect(mockContrato).toHaveBeenCalledTimes(1);
  });

  it('cobrança já feita é pulada', async () => {
    mockContrato.mockResolvedValue(gerado);
    const r = await processarPosCadastro(
      supabase,
      { ...sessao, ca_cobrado_at: '2026-09-02T13:00:00.000Z', ca_implantacao_url: 'https://boleto/impl', ca_mensalidade_url: null },
      cadastro,
    );
    expect(mockCobranca).not.toHaveBeenCalled();
    expect(r.cobranca).toMatchObject({ status: 'cobrado', implantacao_url: 'https://boleto/impl', mensalidade_url: null });
  });
});

describe('mensagemStaffPosCadastro', () => {
  beforeEach(() => { process.env.PUBLIC_BASE_URL = 'https://onboarding.pipeelo.com'; });

  it('bloco de sucesso traz valores, vencimentos, links e avisos', () => {
    const texto = mensagemStaffPosCadastro(
      'Provedor X',
      sessao,
      { ...gerado, avisos: ['Cliente contratou CRM — revisar cláusula CRM'] } as never,
      cobrado as never,
    );
    expect(texto).toContain('📄 Contrato de Provedor X: gerado — assina Ana Souza · baixar no painel');
    expect(texto).toContain('implantação R$ 4.000,00 venc 15/09 (https://boleto/impl)');
    expect(texto).toContain('1ª mensalidade R$ 2.508,00 venc 10/10 (https://boleto/mens)');
    expect(texto).toContain('recorrente dia 10');
    expect(texto).toContain('Avisos: Cliente contratou CRM — revisar cláusula CRM');
  });

  it('bloco pendente traz motivo e campos faltando', () => {
    const texto = mensagemStaffPosCadastro(
      'Provedor X',
      sessao,
      { status: 'pendente', motivo: 'Representante indefinido', faltando: ['CONTRATANTE_REPRESENTANTE'] },
      { status: 'pendente', motivo: 'faltam dados do fechamento: valor mensal' },
    );
    expect(texto).toContain('📄 Contrato de Provedor X: ⚠️ pendente — Representante indefinido; faltam: CONTRATANTE_REPRESENTANTE');
    expect(texto).toContain('💳 Conta Azul: ⚠️ pendente — faltam dados do fechamento: valor mensal');
  });
});
