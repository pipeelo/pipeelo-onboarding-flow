// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { extrairDocumentos, MODELO_PADRAO } from './extracao';

/**
 * PDF mínimo escrito à mão, com offsets calculados — só para ter um documento
 * de verdade para o modelo ler no teste de integração.
 */
function pdfDeTexto(linhas: string[]): Buffer {
  const conteudo = linhas
    .map((t, i) => `BT /F1 12 Tf 72 ${740 - i * 24} Td (${t.replace(/([()\\])/g, '\\$1')}) Tj ET`)
    .join('\n');

  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(conteudo, 'latin1')} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objetos.forEach((corpo, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${corpo}\nendobj\n`;
  });

  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

describe('pdfDeTexto', () => {
  it('produz um PDF com header e trailer', () => {
    const b = pdfDeTexto(['teste']);
    expect(b.subarray(0, 8).toString()).toBe('%PDF-1.4');
    expect(b.toString('latin1')).toContain('%%EOF');
  });
});

/**
 * Integração real com a OpenAI. Só roda com `OPENAI_API_KEY` no ambiente —
 * `npx vitest run api/_lib/contrato/extracao.test.ts` sem a chave pula o caso.
 */
describe('extrairDocumentos (integração real)', () => {
  it.skipIf(!process.env.OPENAI_API_KEY)(
    `lê um contrato social de uma página com ${MODELO_PADRAO}`,
    async () => {
      const pdf = pdfDeTexto([
        'CONTRATO SOCIAL — PROVEDOR X TELECOMUNICACOES LTDA',
        'CNPJ: 11.222.333/0001-81',
        'Sede: Rua Takabumi Murata, 303, Gleba Palhano, Londrina/PR, CEP 86.055-580',
        'CLAUSULA SEXTA - DA ADMINISTRACAO',
        'A sociedade sera administrada exclusivamente por:',
        'SOCIO ADMINISTRADOR: Ana Souza CPF 123.456.789-00',
        'Ana Souza, brasileira, casada, empresaria, RG 12.345.678-9 SSP/PR,',
        'residente na Rua B, 200, Londrina/PR.',
      ]);

      const r = await extrairDocumentos([
        { nome: 'contrato-social.pdf', mime: 'application/pdf', bytes: pdf },
      ]);

      console.log('extração real:', JSON.stringify(r, null, 2));

      expect(r.representante).not.toBeNull();
      expect(r.representante?.nome).toMatch(/Ana Souza/i);
      expect(r.representante?.cpf.replace(/\D/g, '')).toBe('12345678900');
      expect(r.administradores.length).toBeGreaterThan(0);
      expect(r.cnpj).toBe('11222333000181');
      expect(r.motivo_ambiguidade).toBeNull();
    },
    120_000,
  );
});
