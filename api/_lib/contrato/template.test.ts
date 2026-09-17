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
    // 18 cláusulas do contrato + CRM Funil Inteligente (19ª) + Governança de IA (20ª).
    expect(d.clausulas).toHaveLength(20);
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

  it('todo título de cláusula sai com keepNext, para não ficar órfão no pé da página', async () => {
    const buf = await renderDocx(preenchidos(), { crm: true });
    const { default: JSZip } = await import('jszip');
    const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string');

    // Cada <w:p> que contém "CLÁUSULA " ou "ANEXO I" como título precisa declarar
    // w:keepNext — é o que empurra o título para a página seguinte junto com o
    // primeiro parágrafo, em vez de deixá-lo sozinho no rodapé.
    const paragrafos = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
    const titulos = paragrafos.filter((p) => {
      const texto = (p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [])
        .map((t) => t.replace(/<[^>]+>/g, ''))
        .join('');
      return /^(CLÁUSULA |ANEXO I)/.test(texto.trim());
    });

    expect(titulos.length).toBeGreaterThanOrEqual(20);
    expect(titulos.filter((p) => !p.includes('<w:keepNext'))).toEqual([]);
  });

  it('escreve o serviço com CRM no item 5 do Anexo quando crm=true', async () => {
    const comCrm = await renderDocx(preenchidos(['ANEXO_SERVICOS']), { crm: true });
    const semCrm = await renderDocx(preenchidos(['ANEXO_SERVICOS']), { crm: false });

    expect(textoDoDocx(comCrm)).toContain('Serviços contratados: Agente de IA de atendimento + CRM Funil Inteligente');
    expect(textoDoDocx(semCrm)).toContain('Serviços contratados: Agente de IA de atendimento');
    // A Cláusula Décima Nona está sempre no contrato — ela mesma se condiciona ao
    // item 5 do Anexo —, então `crm=false` muda só o texto daquele item.
    expect(textoDoDocx(semCrm)).not.toContain('Serviços contratados: Agente de IA de atendimento + CRM');
    expect(textoDoDocx(semCrm)).toContain('CLÁUSULA DÉCIMA NONA – DO MÓDULO CRM FUNIL INTELIGENTE');
    expect(textoDoDocx(semCrm)).toContain('Quando indicado como contratado no item 5 do Anexo I');
  });

  it('servicosContratados devolve o texto canônico dos dois pacotes', () => {
    expect(servicosContratados(true)).toBe('Agente de IA de atendimento + CRM Funil Inteligente');
    expect(servicosContratados(false)).toBe('Agente de IA de atendimento');
  });
});
