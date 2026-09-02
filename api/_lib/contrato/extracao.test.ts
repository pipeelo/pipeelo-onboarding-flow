// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Testes offline da extração: o SDK da OpenAI é substituído por um duble, então
 * dá para conferir o formato do pedido (input_file / input_image / json_schema
 * strict) e o tratamento de resposta ruim sem gastar token.
 *
 * A chamada real contra a OpenAI vive em `extracao.integracao.test.ts` — o
 * `vi.mock` abaixo vale para o arquivo inteiro e não pode conviver com ela.
 */
const criar = vi.fn();
vi.mock('openai', () => ({
  default: class {
    responses = { create: criar };
  },
}));

import { extrairDocumentos, MODELO_PADRAO, __resetOpenAiClient } from './extracao';

const saidaValida = JSON.stringify({
  razao_social: 'PROVEDOR X LTDA',
  cnpj: '11.222.333/0001-81',
  endereco_sede: 'Rua A, 100, Londrina/PR',
  administradores: [{ nome: 'Ana Souza', cpf: '123.456.789-00', cargo: 'Sócia administradora' }],
  representante: {
    nome: 'Ana Souza', cpf: '123.456.789-00', rg: '12.345.678-9', orgao_rg: 'SSP',
    uf_rg: 'PR', estado_civil: 'casada', profissao: 'empresária', endereco: 'Rua B, 200',
  },
  motivo_ambiguidade: null,
  confianca: 'alta',
});

describe('extrairDocumentos (offline)', () => {
  beforeEach(() => {
    criar.mockReset();
    __resetOpenAiClient();
    process.env.OPENAI_API_KEY = 'sk-teste';
    delete process.env.OPENAI_MODEL_EXTRACAO;
  });
  afterEach(() => {
    __resetOpenAiClient();
    delete process.env.OPENAI_API_KEY;
  });

  it('manda PDF como input_file, imagem como input_image e schema strict', async () => {
    criar.mockResolvedValue({ output_text: saidaValida });

    const r = await extrairDocumentos([
      { nome: 'contrato-social.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.4') },
      { nome: 'rg.jpg', mime: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff]) },
    ]);

    expect(r.cnpj).toBe('11222333000181');
    expect(r.representante?.nome).toBe('Ana Souza');

    const pedido = criar.mock.calls[0][0];
    expect(pedido.model).toBe(MODELO_PADRAO);
    expect(pedido.text.format.type).toBe('json_schema');
    expect(pedido.text.format.strict).toBe(true);

    const partes = pedido.input[0].content;
    expect(partes[0].type).toBe('input_text');
    expect(partes[1]).toMatchObject({ type: 'input_file', filename: 'contrato-social.pdf' });
    expect(String(partes[1].file_data)).toMatch(/^data:application\/pdf;base64,/);
    expect(partes[2].type).toBe('input_image');
    expect(String(partes[2].image_url)).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('respeita OPENAI_MODEL_EXTRACAO', async () => {
    process.env.OPENAI_MODEL_EXTRACAO = 'gpt-5';
    criar.mockResolvedValue({ output_text: saidaValida });
    await extrairDocumentos([{ nome: 'a.pdf', mime: 'application/pdf', bytes: Buffer.from('x') }]);
    expect(criar.mock.calls[0][0].model).toBe('gpt-5');
  });

  it('resposta vazia vira openai_sem_saida', async () => {
    criar.mockResolvedValue({ output_text: '' });
    await expect(
      extrairDocumentos([{ nome: 'a.pdf', mime: 'application/pdf', bytes: Buffer.from('x') }]),
    ).rejects.toThrow('openai_sem_saida');
  });

  it('JSON quebrado vira openai_json_invalido', async () => {
    criar.mockResolvedValue({ output_text: '{ isso não é json' });
    await expect(
      extrairDocumentos([{ nome: 'a.pdf', mime: 'application/pdf', bytes: Buffer.from('x') }]),
    ).rejects.toThrow('openai_json_invalido');
  });

  it('sem arquivo nem chama a OpenAI', async () => {
    await expect(extrairDocumentos([])).rejects.toThrow('nenhum_arquivo_para_extrair');
    expect(criar).not.toHaveBeenCalled();
  });
});
