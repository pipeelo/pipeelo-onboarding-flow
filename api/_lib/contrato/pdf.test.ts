// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderPdf } from './pdf';
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
