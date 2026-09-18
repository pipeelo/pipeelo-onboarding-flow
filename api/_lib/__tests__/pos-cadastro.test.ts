// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../contrato', () => ({
  CONTRATO_BUCKET: 'onboarding-contratos',
  gerarContratoParaSessao: vi.fn(),
}));
vi.mock('../conta-azul', () => ({ criarClienteContaAzul: vi.fn() }));
vi.mock('../staff-notify', () => ({ notifyStaff: vi.fn(async () => ({ sent: true })), notifySocios: vi.fn(async () => ({ sent: true })) }));
vi.mock('../assinatura', () => ({ enviarParaAssinatura: vi.fn(async () => ({ status: 'enviado', solicitacao_id: 66, link: 'https://x/l', dm: true, grupo: true, reenvio: false })) }));

import { gerarContratoParaSessao } from '../contrato';
import { enviarParaAssinatura } from '../assinatura';
import { criarClienteContaAzul } from '../conta-azul';
import { notifyStaff, notifySocios } from '../staff-notify';
import { processarPosCadastro, mensagemStaffPosCadastro, mensagemSociosAssinatura, type SessaoPosCadastro } from '../pos-cadastro';
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
  valor_implantacao: 4000, implantacao_vencimento: '2026-09-15', go_live_em: '2026-10-07',
  cadastro_enviado_at: '2026-09-02T12:00:00.000Z',
};

const supabase = {} as never;
const mockContrato = gerarContratoParaSessao as unknown as ReturnType<typeof vi.fn>;
const mockCobranca = criarClienteContaAzul as unknown as ReturnType<typeof vi.fn>;
const mockAssinatura = enviarParaAssinatura as unknown as ReturnType<typeof vi.fn>;
const mockStaff = notifyStaff as unknown as ReturnType<typeof vi.fn>;
const mockSocios = notifySocios as unknown as ReturnType<typeof vi.fn>;

const gerado = { status: 'gerado', path: 's1/Contrato.docx', representante: 'Ana Souza', avisos: [] as string[] };
const cobrado = { status: 'cliente_criado', cliente_id: 'ca-123' };

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
    expect(texto).not.toContain('✍️ Assinatura');
    expect(mockSocios).toHaveBeenCalledTimes(1);
    expect(String(mockSocios.mock.calls[0][0])).toContain('✍️ Assinatura de Provedor X: não enviada (sem PDF)');
  });

  it('falha no contrato não impede a cobrança nem o aviso', async () => {
    mockContrato.mockRejectedValue(new Error('boom'));
    mockCobranca.mockResolvedValue(cobrado);

    const r = await processarPosCadastro(supabase, sessao, cadastro);

    expect(r.contrato.status).toBe('pendente');
    expect(r.cobranca.status).toBe('cliente_criado');
    expect(mockStaff).toHaveBeenCalledTimes(1);
    expect(mockSocios).not.toHaveBeenCalled();
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

  it('assinatura no 1º ciclo usa a extração do contrato recém-gerado, não a sessão velha', async () => {
    // Bug real (OLV 14/09, CONECTA 15/09, INUV 18/09): a sessão carregada antes de gerar
    // o contrato tem contrato_extracao = null, e a assinatura respondia "sem representante".
    const extracao = { representante: { nome: 'Ana Souza', cpf: '12345678900' }, endereco_sede: 'Rua A, 1' };
    mockContrato.mockResolvedValue({ ...gerado, pdf_path: 's1/Contrato.pdf', extracao });
    mockCobranca.mockResolvedValue(cobrado);

    await processarPosCadastro(supabase, { ...sessao, contrato_extracao: null }, cadastro);

    expect(mockAssinatura).toHaveBeenCalledTimes(1);
    const sessaoEnviada = mockAssinatura.mock.calls[0][1] as { contrato_extracao: unknown; contrato_pdf_path: string };
    expect(sessaoEnviada.contrato_extracao).toEqual(extracao);
    expect(sessaoEnviada.contrato_pdf_path).toBe('s1/Contrato.pdf');
  });

  it('cliente já criado no Conta Azul é pulado', async () => {
    mockContrato.mockResolvedValue(gerado);
    const r = await processarPosCadastro(supabase, { ...sessao, ca_cliente_id: 'ca-999' }, cadastro);
    expect(mockCobranca).not.toHaveBeenCalled();
    expect(r.cobranca).toEqual({ status: 'cliente_criado', cliente_id: 'ca-999' });
  });
});

describe('mensagemStaffPosCadastro', () => {
  beforeEach(() => { process.env.PUBLIC_BASE_URL = 'https://onboarding.pipeelo.com'; });

  it('bloco de sucesso diz que só o cliente foi criado, sem cobrança', () => {
    const texto = mensagemStaffPosCadastro(
      'Provedor X',
      sessao,
      { ...gerado, avisos: ['Cliente contratou CRM — revisar cláusula CRM'] } as never,
      cobrado as never,
    );
    expect(texto).toContain('📄 Contrato de Provedor X: gerado — assina Ana Souza · baixar no painel');
    expect(texto).toContain('💳 Conta Azul: cliente criado · cobranças (implantação e 1ª mensalidade proporcional ao go-live) lançar à mão');
    expect(texto).not.toContain('boleto');
    expect(texto).toContain('Avisos: Cliente contratou CRM — revisar cláusula CRM');
  });

  it('bloco pendente traz motivo e campos faltando', () => {
    const texto = mensagemStaffPosCadastro(
      'Provedor X',
      sessao,
      { status: 'pendente', motivo: 'Representante indefinido', faltando: ['CONTRATANTE_REPRESENTANTE'] },
      { status: 'pendente', motivo: 'CA_INTERNAL_SECRET não configurado' },
    );
    expect(texto).toContain('📄 Contrato de Provedor X: ⚠️ pendente — Representante indefinido; faltam: CONTRATANTE_REPRESENTANTE');
    expect(texto).toContain('💳 Conta Azul: ⚠️ pendente — CA_INTERNAL_SECRET não configurado');
  });
});

describe('mensagemSociosAssinatura', () => {
  beforeEach(() => { process.env.PUBLIC_BASE_URL = 'https://onboarding.pipeelo.com'; });

  it('sem contrato gerado não há aviso', () => {
    expect(mensagemSociosAssinatura('Provedor X', { status: 'pendente', motivo: 'x', faltando: [] }, null)).toBeNull();
  });

  it('assinatura pendente traz o motivo e o painel', () => {
    const texto = mensagemSociosAssinatura('Provedor X', gerado as never, { status: 'pendente', motivo: 'Contrato sem representante identificado (nome e CPF)' });
    expect(texto).toBe('✍️ Assinatura de Provedor X: ⚠️ pendente — Contrato sem representante identificado (nome e CPF) · https://onboarding.pipeelo.com/admin');
  });

  it('contrato sem PDF pede envio pelo painel', () => {
    expect(mensagemSociosAssinatura('Provedor X', gerado as never, null)).toContain('não enviada (sem PDF)');
  });
});
