// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { dataAssinatura, dataCurta, dataPorExtenso, formatarCnpj, inteiro, moeda, montarCampos, type SessaoContrato } from './campos';
import type { Extracao } from './extracao';
import type { Cadastro } from '../schemas/cadastro';
import { placeholdersDoTemplate } from './template';

const upload = { path: 'p', nome_original: 'a.pdf', tamanho: 1 };

const cadastro: Cadastro = {
  cnpj: '11222333000181',
  razao_social: 'PROVEDOR X TELECOMUNICAÇÕES LTDA',
  nome_fantasia: 'Provedor X',
  inscricao_estadual: 'Isento',
  cobranca_email: 'f@x.com',
  cobranca_telefone: '4333221100',
  dia_vencimento: 10,
  contrato_email: 'j@x.com',
  doc_contrato_social: [upload],
  doc_responsaveis: [upload],
  responsavel_nome: 'Ana Souza',
  responsavel_cargo: 'CEO',
  responsavel_email: 'ana@x.com',
  responsavel_whatsapp: '43996661541',
  contatos_extras: [],
  aceite_dados: true,
};

const sessao: SessaoContrato = {
  id: 's1',
  erp: 'IXC',
  contratou_crm: false,
  valor_sessao: 0.95,
  qtd_sessoes: 2640,
  valor_mensal: 2508,
  dia_vencimento: 10,
  valor_implantacao: 4000,
  implantacao_vencimento: '2026-09-15',
  primeira_mensalidade_em: '2026-10-10',
};

const extracao: Extracao = {
  razao_social: 'PROVEDOR X TELECOMUNICAÇÕES LTDA',
  cnpj: '11222333000181',
  endereco_sede: 'Rua A, 100, Centro, Londrina/PR, CEP 86000-000',
  administradores: [{ nome: 'Ana Souza', cpf: '123.456.789-00', cargo: 'Sócia administradora' }],
  representante: {
    nome: 'Ana Souza',
    cpf: '123.456.789-00',
    rg: '12.345.678-9',
    orgao_rg: 'SSP',
    uf_rg: 'PR',
    estado_civil: 'casada',
    profissao: 'empresária',
    endereco: 'Rua B, 200, Londrina/PR',
  },
  motivo_ambiguidade: null,
  confianca: 'alta',
};

afterEach(() => vi.useRealTimers());

describe('formatadores', () => {
  it('moeda em R$ com milhar e centavos', () => {
    expect(moeda(1234.56)).toBe('R$ 1.234,56');
    expect(moeda(4000)).toBe('R$ 4.000,00');
    expect(moeda('0.95')).toBe('R$ 0,95');
    expect(moeda(1234567.5)).toBe('R$ 1.234.567,50');
    expect(moeda(null)).toBe('');
  });

  it('inteiro com separador de milhar', () => {
    expect(inteiro(2640)).toBe('2.640');
    expect(inteiro(25000)).toBe('25.000');
    expect(inteiro(null)).toBe('');
  });

  it('data curta dd/mm/aaaa', () => {
    expect(dataCurta('2026-09-15')).toBe('15/09/2026');
    expect(dataCurta('2026-09-15T12:00:00Z')).toBe('15/09/2026');
    expect(dataCurta(null)).toBe('');
  });

  it('data por extenso em pt-BR', () => {
    expect(dataPorExtenso(new Date(2026, 8, 2))).toBe('2 de setembro de 2026');
    expect(dataPorExtenso(new Date(2026, 2, 31))).toBe('31 de março de 2026');
  });

  it('CNPJ mascarado', () => {
    expect(formatarCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatarCnpj('123')).toBe('123');
  });
});

describe('dataAssinatura', () => {
  afterEach(() => vi.useRealTimers());

  it('usa o dia do envio do cadastro', () => {
    expect(dataAssinatura('2026-09-15T13:20:00.000Z')).toBe('15 de setembro de 2026');
  });

  it('cai para hoje sem carimbo ou com carimbo inválido', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 2, 10));
    expect(dataAssinatura(null)).toBe('2 de setembro de 2026');
    expect(dataAssinatura('xxx')).toBe('2 de setembro de 2026');
  });
});

describe('montarCampos', () => {
  it('preenche todos os placeholders do template quando há dados', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 2, 10));

    const { campos, faltando } = montarCampos(sessao, cadastro, extracao, { municipio: 'LONDRINA', uf: 'PR' });

    expect(faltando).toEqual([]);
    // Nenhum placeholder do template fica sem chave em campos.
    for (const p of placeholdersDoTemplate()) expect(campos[p], p).toBeTruthy();

    expect(campos.CONTRATANTE_RAZAO_SOCIAL).toBe('PROVEDOR X TELECOMUNICAÇÕES LTDA');
    expect(campos.CONTRATANTE_CNPJ).toBe('11.222.333/0001-81');
    expect(campos.CONTRATANTE_REPRESENTANTE).toBe('Ana Souza');
    expect(campos.CONTRATANTE_RG).toBe('12.345.678-9 SSP/PR');
    expect(campos.CONTRATANTE_CIDADE_ASSINATURA).toBe('LONDRINA');
    // Sem `cadastro_enviado_at` na sessão, a data de assinatura cai para hoje.
    expect(campos.DATA_ASSINATURA).toBe('2 de setembro de 2026');
    // Com o carimbo do envio, é o dia em que o cliente mandou o cadastro.
    expect(
      montarCampos({ ...sessao, cadastro_enviado_at: '2026-09-15T13:20:00.000Z' }, cadastro, extracao, {
        municipio: 'LONDRINA',
        uf: 'PR',
      }).campos.DATA_ASSINATURA,
    ).toBe('15 de setembro de 2026');

    expect(campos.ANEXO_PROVEDOR).toBe('Provedor X');
    expect(campos.ANEXO_ERP).toBe('IXC');
    expect(campos.ANEXO_PACOTE).toBe('2.001 – 4.999 sessões/mês');
    expect(campos.ANEXO_SESSOES_INCLUIDAS).toBe('2.640 sessões/mês');
    expect(campos.ANEXO_VALOR_SESSAO).toBe('R$ 0,95');
    expect(campos.ANEXO_VALOR_MENSAL).toBe('R$ 2.508,00');
    expect(campos.ANEXO_TAXA_IMPLANTACAO).toBe('R$ 4.000,00');
    expect(campos.ANEXO_DATA_VENCIMENTO_IMPL).toBe('15/09/2026');
    expect(campos.ANEXO_PRAZO_TESTES).toBe('10 dias');
    expect(campos.ANEXO_DIA_VENCIMENTO).toBe('dia 10');
    expect(campos.ANEXO_SERVICOS).toBe('Agente de IA de atendimento');
  });

  it('usa o texto com CRM quando a sessão contratou CRM', () => {
    const { campos } = montarCampos({ ...sessao, contratou_crm: true }, cadastro, extracao, null);
    expect(campos.ANEXO_SERVICOS).toBe('Agente de IA de atendimento + CRM Funil Inteligente');
  });

  it('lista os campos do representante em faltando quando a extração não o identificou', () => {
    const semRep: Extracao = { ...extracao, representante: null, motivo_ambiguidade: 'Dois administradores com documento.' };
    const { campos, faltando } = montarCampos(sessao, cadastro, semRep, null);

    expect(campos.CONTRATANTE_REPRESENTANTE).toBe('');
    expect(faltando).toEqual([
      'CONTRATANTE_CIDADE_ASSINATURA',
      'CONTRATANTE_CPF',
      'CONTRATANTE_END_REP',
      'CONTRATANTE_ESTADO_CIVIL',
      'CONTRATANTE_PROFISSAO',
      'CONTRATANTE_REPRESENTANTE',
      'CONTRATANTE_RG',
    ]);
  });

  it('cai para o cadastro quando o documento não trouxe razão social/CNPJ', () => {
    const vazio: Extracao = { ...extracao, razao_social: '', cnpj: '' };
    const { campos } = montarCampos(sessao, cadastro, vazio, null);
    expect(campos.CONTRATANTE_RAZAO_SOCIAL).toBe(cadastro.razao_social);
    expect(campos.CONTRATANTE_CNPJ).toBe('11.222.333/0001-81');
  });

  it('sem valores comerciais, aponta cada campo do Anexo que ficou vazio', () => {
    const magra: SessaoContrato = { id: 's1' };
    const { faltando } = montarCampos(magra, cadastro, extracao, { municipio: 'LONDRINA', uf: 'PR' });
    expect(faltando).toEqual([
      'ANEXO_DATA_VENCIMENTO_IMPL',
      'ANEXO_DIA_VENCIMENTO',
      'ANEXO_ERP',
      'ANEXO_PACOTE',
      'ANEXO_SESSOES_INCLUIDAS',
      'ANEXO_TAXA_IMPLANTACAO',
      'ANEXO_VALOR_MENSAL',
      'ANEXO_VALOR_SESSAO',
    ]);
  });
});
