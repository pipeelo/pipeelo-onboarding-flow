// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  CamposFaltando, parseTemplate, placeholdersDoTemplate, renderDocx, servicosContratados,
} from './template';
import { textoDoDocx } from './_docx-texto';

const TODOS = placeholdersDoTemplate();
const preenchidos = (exceto: string[] = []) =>
  Object.fromEntries(TODOS.filter((p) => !exceto.includes(p)).map((p) => [p, `<${p}>`]));

describe('parseTemplate', () => {
  it('estrutura o contrato em título, cláusulas, fecho, assinaturas e Anexo I', () => {
    const d = parseTemplate();

    expect(d.titulo[0]).toBe('CONTRATO DE PRESTAÇÃO DE SERVIÇOS');
    expect(d.clausulas).toHaveLength(18);
    expect(d.clausulas[0].titulo).toBe('CLÁUSULA PRIMEIRA – DAS PARTES');
    expect(d.clausulas[0].linhas).toHaveLength(2);

    // Sub-itens numerados guardam o prefixo em separado (negrito no .docx).
    const objeto = d.clausulas[1];
    expect(objeto.linhas[1].prefixo).toBe('2.1.1.');
    expect(objeto.linhas.find((l) => l.prefixo === '2.6.')?.label).toBe('Do Período de Testes:');

    expect(d.fechamento.some((l) => l.texto.startsWith('E ASSIM,'))).toBe(true);
    expect(d.assinaturas.map((a) => a.nome)).toEqual([
      'ALISSON SCALCO FERREIRA',
      '{{CONTRATANTE_REPRESENTANTE}}',
    ]);

    expect(d.anexo.titulo).toBe('ANEXO I – CONDIÇÕES COMERCIAIS ESPECÍFICAS');
    expect(d.anexo.assinaturas[0].nome).toBe('FELIPE EDUARDO DE CAMARGO MARTINS');
    // Linhas de continuação do item 1 ficam marcadas.
    expect(d.anexo.linhas.filter((l) => l.continuacao).length).toBeGreaterThan(0);
  });

  it('lista os placeholders do bloco do contrato (sem o {{PLACEHOLDERS}} da instrução)', () => {
    expect(TODOS).toContain('CONTRATANTE_REPRESENTANTE');
    expect(TODOS).toContain('ANEXO_DIA_VENCIMENTO');
    expect(TODOS).not.toContain('PLACEHOLDERS');
  });
});

describe('renderDocx', () => {
  it('gera um .docx (zip PK) com todos os campos preenchidos', async () => {
    const buf = await renderDocx(preenchidos(), { crm: false });

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    expect(buf.length).toBeGreaterThan(10_000);

    const texto = textoDoDocx(buf);
    expect(texto).not.toMatch(/\{\{/);
    expect(texto).toContain('CLÁUSULA PRIMEIRA – DAS PARTES');
    expect(texto).toContain('ANEXO I – CONDIÇÕES COMERCIAIS ESPECÍFICAS');
    expect(texto).toContain('<CONTRATANTE_REPRESENTANTE>');
  });

  it('lança CamposFaltando listando os placeholders sem valor', async () => {
    await expect(renderDocx({}, { crm: false })).rejects.toBeInstanceOf(CamposFaltando);

    const erro = await renderDocx({}, { crm: false }).then(() => null, (e) => e as CamposFaltando);
    expect(erro).toBeInstanceOf(CamposFaltando);
    if (!erro) return;
    // ANEXO_SERVICOS tem valor padrão por opts.crm — não entra na lista.
    expect(erro.faltando).not.toContain('ANEXO_SERVICOS');
    expect(erro.faltando).toContain('CONTRATANTE_REPRESENTANTE');
    expect(erro.faltando).toContain('DATA_ASSINATURA');
    expect(erro.message).toContain('CONTRATANTE_CNPJ');
  });

  it('trata campo em branco como faltando', async () => {
    const erro = await renderDocx({ ...preenchidos(), DATA_ASSINATURA: '   ' }, { crm: false })
      .then(() => null, (e) => e as CamposFaltando);
    expect(erro?.faltando).toEqual(['DATA_ASSINATURA']);
  });

  it('escreve o serviço com CRM no item 5 do Anexo quando crm=true', async () => {
    const comCrm = await renderDocx(preenchidos(['ANEXO_SERVICOS']), { crm: true });
    const semCrm = await renderDocx(preenchidos(['ANEXO_SERVICOS']), { crm: false });

    expect(textoDoDocx(comCrm)).toContain('Serviços contratados: Agente de IA de atendimento + CRM Funil Inteligente');
    expect(textoDoDocx(semCrm)).toContain('Serviços contratados: Agente de IA de atendimento');
    expect(textoDoDocx(semCrm)).not.toContain('CRM Funil Inteligente');
  });

  it('servicosContratados devolve o texto canônico dos dois pacotes', () => {
    expect(servicosContratados(true)).toBe('Agente de IA de atendimento + CRM Funil Inteligente');
    expect(servicosContratados(false)).toBe('Agente de IA de atendimento');
  });
});
