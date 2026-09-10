// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderPdf, PdfComPaginasEmBranco } from './pdf';
import { CamposFaltando, placeholdersDoTemplate } from './template';

function camposCompletos(): Record<string, string> {
  const campos: Record<string, string> = {};
  for (const p of placeholdersDoTemplate()) campos[p] = `valor ${p.toLowerCase()}`;
  return campos;
}

describe('renderPdf', () => {
  it('gera um PDF com mais de uma página e fonte Inter embutida', async () => {
    const buf = await renderPdf(camposCompletos(), { crm: true });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(20_000);
    const texto = buf.toString('latin1');
    expect((texto.match(/\/Type \/Page(?!s)/g) ?? []).length).toBeGreaterThan(2);
    expect(texto).toMatch(/Inter/);
  }, 20_000);

  it('lança CamposFaltando quando um placeholder fica sem valor', async () => {
    const campos = camposCompletos();
    delete campos.CONTRATANTE_CPF;
    await expect(renderPdf(campos, { crm: false })).rejects.toBeInstanceOf(CamposFaltando);
    await expect(renderPdf(campos, { crm: false })).rejects.toMatchObject({ faltando: ['CONTRATANTE_CPF'] });
  }, 20_000);
});

describe('páginas em branco', () => {
  it('o PDF não tem página em branco no fim — o rodapé não pode abrir página nova', async () => {
    const pdf = await renderPdf(camposCompletos(), { crm: true });
    const texto = pdf.toString('latin1');
    const paginas = (texto.match(/\/Type\s*\/Page(?![s])/g) || []).length;
    // 20 cláusulas + fecho + Anexo cabem com folga em menos de 20 páginas; o bug
    // antigo dobrava o documento (13 de conteúdo + 13 em branco).
    expect(paginas).toBeGreaterThan(5);
    expect(paginas).toBeLessThan(20);
  });

  it('PdfComPaginasEmBranco descreve quantas sobraram', () => {
    const e = new PdfComPaginasEmBranco(13, 26);
    expect(e.message).toContain('13 página(s) em branco de 26');
    expect(e.name).toBe('PdfComPaginasEmBranco');
  });
});
