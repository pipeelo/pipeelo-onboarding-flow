import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import {
  CamposFaltando, COR, LOGO_PATH, parseTemplate, servicosContratados, trocar,
  type Assinatura, type Linha,
} from './template';

/**
 * Renderiza o contrato em PDF a partir da MESMA estrutura do `.docx`
 * (`parseTemplate` + `trocar`), para mandar à AssinaPDF. O `.docx` continua
 * sendo o arquivo editável do Staff; o PDF é o que o cliente assina.
 */

const require = createRequire(import.meta.url);

const A4 = { largura: 595.28, altura: 841.89 };
const MARGEM = { topo: 72, base: 64, esq: 55, dir: 55 };
const TAM = { titulo: 14, clausula: 12, corpo: 10.5, rodape: 8 };
const HEX = (c: string) => `#${c}`;

type Fontes = { normal: string; negrito: string };

function registrarFontes(doc: PDFKit.PDFDocument): Fontes {
  try {
    const normal = require.resolve('@fontsource/inter/files/inter-latin-400-normal.woff');
    const negrito = require.resolve('@fontsource/inter/files/inter-latin-700-normal.woff');
    doc.registerFont('Inter', normal);
    doc.registerFont('Inter-Bold', negrito);
    return { normal: 'Inter', negrito: 'Inter-Bold' };
  } catch {
    return { normal: 'Helvetica', negrito: 'Helvetica-Bold' };
  }
}

function larguraUtil(): number {
  return A4.largura - MARGEM.esq - MARGEM.dir;
}

function cabecalhoERodape(doc: PDFKit.PDFDocument, f: Fontes): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Cabeçalho: logo + régua verde fina.
    if (existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, MARGEM.esq, 26, { width: 20 }); } catch { /* sem logo */ }
    }
    doc.save()
      .moveTo(MARGEM.esq, 54).lineTo(A4.largura - MARGEM.dir, 54)
      .lineWidth(0.8).strokeColor(HEX(COR.verde)).stroke()
      .restore();
    // Rodapé. O y fica ABAIXO da margem inferior — e o pdfkit, ao escrever fora da
    // área útil, abre uma página nova sozinho. Era isso que enchia o contrato de
    // páginas em branco (uma por página de conteúdo). Zerar a margem de baixo enquanto
    // escreve o rodapé é o remédio documentado; `lineBreak: false` não segura.
    const margemBase = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font(f.normal).fontSize(TAM.rodape).fillColor(HEX(COR.cinza))
      .text('PIPEELO LTDA · CNPJ 44.279.528/0001-17 · pipeelo.com', MARGEM.esq, A4.altura - 40, {
        width: larguraUtil(), align: 'center', lineBreak: false,
      });
    doc.page.margins.bottom = margemBase;
  }
}

function titulo(doc: PDFKit.PDFDocument, f: Fontes, texto: string): void {
  doc.font(f.negrito).fontSize(TAM.titulo).fillColor(HEX(COR.navy))
    .text(texto, { align: 'center', width: larguraUtil() });
  doc.moveDown(0.15);
}

function reguaVerde(doc: PDFKit.PDFDocument): void {
  const y = doc.y + 6;
  doc.save()
    .moveTo(MARGEM.esq, y).lineTo(A4.largura - MARGEM.dir, y)
    .lineWidth(1.2).strokeColor(HEX(COR.verde)).stroke()
    .restore();
  doc.y = y + 16;
}

function clausula(doc: PDFKit.PDFDocument, f: Fontes, texto: string): void {
  doc.moveDown(0.9);
  const altura = doc.font(f.negrito).fontSize(TAM.clausula).heightOfString(texto, { width: larguraUtil() - 10 });
  if (doc.y + altura + 40 > A4.altura - MARGEM.base) doc.addPage();
  const y = doc.y;
  doc.save().rect(MARGEM.esq, y - 1, 2, altura + 2).fillColor(HEX(COR.verde)).fill().restore();
  doc.fillColor(HEX(COR.navy)).text(texto, MARGEM.esq + 10, y, { width: larguraUtil() - 10 });
  doc.x = MARGEM.esq;
  doc.moveDown(0.5);
}

function corpo(doc: PDFKit.PDFDocument, f: Fontes, l: Linha, valores: Record<string, string>, faltando: Set<string>): void {
  const x = MARGEM.esq + (l.continuacao ? 17 : 0);
  const largura = larguraUtil() - (l.continuacao ? 17 : 0);
  doc.fontSize(TAM.corpo).fillColor(HEX(COR.texto));

  let resto = l.texto;
  const partes: Array<{ t: string; b: boolean }> = [];
  if (l.prefixo) partes.push({ t: `${l.prefixo} `, b: true });
  if (l.label) {
    partes.push({ t: l.label, b: true });
    resto = resto.slice(l.label.length);
  }
  if (resto) partes.push({ t: trocar(resto, valores, faltando), b: false });

  doc.x = x;
  partes.forEach((p, i) => {
    const ultima = i === partes.length - 1;
    doc.font(p.b ? f.negrito : f.normal)
      .text(p.t, i === 0 ? x : undefined, undefined, {
        width: largura, align: 'justify', continued: !ultima, lineGap: 2.5,
      });
  });
  doc.x = MARGEM.esq;
  doc.moveDown(l.continuacao ? 0.25 : 0.6);
}

function blocoAssinatura(doc: PDFKit.PDFDocument, f: Fontes, a: Assinatura, valores: Record<string, string>, faltando: Set<string>): void {
  if (doc.y + 70 > A4.altura - MARGEM.base) doc.addPage();
  doc.moveDown(2.2);
  const y = doc.y;
  doc.save()
    .moveTo(MARGEM.esq, y).lineTo(MARGEM.esq + 260, y)
    .lineWidth(0.8).strokeColor(HEX(COR.cinza)).stroke()
    .restore();
  doc.y = y + 6;
  doc.font(f.negrito).fontSize(TAM.corpo).fillColor(HEX(COR.navy))
    .text(trocar(a.nome, valores, faltando), MARGEM.esq, doc.y, { width: larguraUtil() });
  if (a.papel) {
    doc.font(f.normal).fillColor(HEX(COR.texto))
      .text(trocar(a.papel, valores, faltando), MARGEM.esq, doc.y, { width: larguraUtil() });
  }
}

/** Contrato com página em branco não vai para o cliente — falha alto e explica. */
export class PdfComPaginasEmBranco extends Error {
  constructor(public readonly emBranco: number, public readonly total: number) {
    super(`PDF do contrato saiu com ${emBranco} página(s) em branco de ${total} — não enviar ao cliente.`);
    this.name = 'PdfComPaginasEmBranco';
  }
}

/**
 * Confere no PDF já serializado quantas páginas passaram do esperado. Conta os
 * objetos `/Type /Page` do arquivo (não `/Pages`, que é o nó da árvore) — é a
 * checagem que sobra depois que o pdfkit fechou o documento.
 */
function paginasEmBranco(pdf: Buffer, esperado: number): number {
  const total = (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s])/g) || []).length;
  return total > esperado ? total - esperado : 0;
}

export async function renderPdf(
  campos: Record<string, string>,
  opts: { crm: boolean },
): Promise<Buffer> {
  const estrutura = parseTemplate();
  const valores: Record<string, string> = { ANEXO_SERVICOS: servicosContratados(opts.crm), ...campos };
  const faltando = new Set<string>();

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGEM.topo, bottom: MARGEM.base, left: MARGEM.esq, right: MARGEM.dir },
    bufferPages: true,
    info: { Title: 'Contrato de Prestação de Serviços — Pipeelo', Author: 'Pipeelo' },
  });
  const f = registrarFontes(doc);

  const pedacos: Buffer[] = [];
  const pronto = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => pedacos.push(c));
    doc.on('end', () => resolve(Buffer.concat(pedacos)));
    doc.on('error', reject);
  });

  for (const t of estrutura.titulo) titulo(doc, f, t);
  reguaVerde(doc);

  for (const c of estrutura.clausulas) {
    clausula(doc, f, c.titulo);
    for (const l of c.linhas) corpo(doc, f, l, valores, faltando);
  }
  doc.moveDown(0.5);
  for (const l of estrutura.fechamento) corpo(doc, f, l, valores, faltando);
  for (const a of estrutura.assinaturas) blocoAssinatura(doc, f, a, valores, faltando);

  doc.addPage();
  titulo(doc, f, estrutura.anexo.titulo);
  reguaVerde(doc);
  for (const l of estrutura.anexo.linhas) corpo(doc, f, l, valores, faltando);
  for (const a of estrutura.anexo.assinaturas) blocoAssinatura(doc, f, a, valores, faltando);

  if (faltando.size) {
    doc.end();
    await pronto.catch(() => undefined);
    throw new CamposFaltando([...faltando].sort());
  }

  // Página em branco em contrato que vai para o cliente gera desconfiança — e o jeito
  // de aparecer é sempre o mesmo: alguém escreve fora da área útil e o pdfkit abre
  // página. Desenhar cabeçalho e rodapé NÃO pode criar página nenhuma; se criar, o
  // PDF não sai.
  const paginasComConteudo = doc.bufferedPageRange().count;
  cabecalhoERodape(doc, f);
  const paginasDepois = doc.bufferedPageRange().count;
  if (paginasDepois !== paginasComConteudo) {
    doc.end();
    await pronto.catch(() => undefined);
    throw new PdfComPaginasEmBranco(paginasDepois - paginasComConteudo, paginasDepois);
  }

  doc.end();
  const buffer = await pronto;

  const emBranco = paginasEmBranco(buffer, paginasComConteudo);
  if (emBranco > 0) throw new PdfComPaginasEmBranco(emBranco, paginasComConteudo + emBranco);
  return buffer;
}
