import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  AlignmentType, BorderStyle, Document, Footer, Header, ImageRun, Packer, Paragraph, TextRun,
} from 'docx';

/**
 * Template do contrato Pipeelo: `template-contrato.md` → estrutura → .docx com a
 * identidade visual da skill `pipeelo-financeiro`.
 *
 * O texto jurídico NÃO é gerado por LLM (decisão 3 do design). Este módulo só
 * troca `{{PLACEHOLDERS}}` e aplica estilo.
 */

// ─── Identidade visual (skill pipeelo-financeiro) ────────────
const COR = {
  navy: '1a2151',
  verde: '01d5ac',
  cinza: 'b0b0b0',
  texto: '333333',
} as const;
const FONTE = 'Inter';
// docx usa half-points: 24 = 12pt, 28 = 14pt, 18 = 9pt.
const TAM = { titulo: 28, clausula: 24, corpo: 24, rodape: 18 } as const;
// ─────────────────────────────────────────────────────────────

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(DIR, 'template-contrato.md');
const LOGO_PATH = path.join(DIR, 'assets', 'logo.png');

const RE_PLACEHOLDER = /\{\{([A-Z_]+)\}\}/g;
const RE_SEPARADOR = /^[─—-]{5,}$/;
const RE_LINHA_ASSINATURA = /^_{10,}$/;
const RE_PREFIXO_NUMERICO = /^(\d+(?:\.\d+)*\.)\s+(.*)$/;

/** Serviços contratados do item 5 do Anexo I, conforme o cliente levou CRM ou não. */
export function servicosContratados(crm: boolean): string {
  return crm
    ? 'Agente de IA de atendimento + CRM Funil Inteligente'
    : 'Agente de IA de atendimento';
}

export class CamposFaltando extends Error {
  constructor(public readonly faltando: string[]) {
    super(`Placeholders sem valor: ${faltando.join(', ')}`);
    this.name = 'CamposFaltando';
  }
}

// ─── Estrutura ───────────────────────────────────────────────

export type Linha = {
  texto: string;
  /** Prefixo numérico ("2.1.1.") renderizado em negrito, quando houver. */
  prefixo: string | null;
  /** Label terminada em ":" logo após o prefixo, também em negrito. */
  label: string | null;
  /** Linha de continuação dentro do mesmo bloco (recuo e espaçamento menores). */
  continuacao: boolean;
};

export type Assinatura = { nome: string; papel: string | null };

export type Secao = { titulo: string; linhas: Linha[] };

export type DocumentoContrato = {
  titulo: string[];
  /** Cláusulas na ordem do template; a primeira é "DAS PARTES". */
  clausulas: Secao[];
  /** Fecho do contrato ("E ASSIM…" + cidade/data). */
  fechamento: Linha[];
  assinaturas: Assinatura[];
  anexo: { titulo: string; linhas: Linha[]; assinaturas: Assinatura[] };
};

function analisarLinha(bruta: string, continuacao: boolean): Linha {
  const texto = bruta.trim();
  const m = RE_PREFIXO_NUMERICO.exec(texto);
  const prefixo = m ? m[1] : null;
  const resto = m ? m[2] : texto;

  let label: string | null = null;
  const idx = resto.indexOf(':');
  const podeTerLabel = prefixo !== null || /^[A-ZÀ-Ý]/.test(resto);
  if (podeTerLabel && idx > 0 && idx <= 60) {
    const candidato = resto.slice(0, idx + 1);
    if (!candidato.includes('.') && !candidato.includes('{{')) label = candidato;
  }

  return { texto: resto, prefixo, label, continuacao };
}

function eAssinatura(bloco: string[]): boolean {
  return RE_LINHA_ASSINATURA.test(bloco[0]?.trim() ?? '');
}

function lerAssinatura(bloco: string[]): Assinatura {
  return { nome: (bloco[1] ?? '').trim(), papel: bloco[2] ? bloco[2].trim() : null };
}

function linhasDoBloco(bloco: string[]): Linha[] {
  return bloco.map((l, i) => analisarLinha(l, i > 0));
}

/**
 * Lê o markdown do template e devolve a estrutura do contrato. O conteúdo é o
 * bloco cercado por ``` — o texto fora dele é instrução para humano.
 */
export function parseTemplate(markdown?: string): DocumentoContrato {
  const md = markdown ?? readFileSync(TEMPLATE_PATH, 'utf8');
  const fence = /```\r?\n([\s\S]*?)```/.exec(md);
  if (!fence) throw new Error('template_sem_bloco_de_codigo');

  const linhas = fence[1].replace(/\r\n/g, '\n').split('\n');

  // Blocos separados por linha(s) em branco, preservando a ordem.
  const blocos: string[][] = [];
  let atual: string[] = [];
  for (const l of linhas) {
    if (l.trim() === '') {
      if (atual.length) blocos.push(atual);
      atual = [];
    } else {
      atual.push(l);
    }
  }
  if (atual.length) blocos.push(atual);

  const doc: DocumentoContrato = {
    titulo: [],
    clausulas: [],
    fechamento: [],
    assinaturas: [],
    anexo: { titulo: '', linhas: [], assinaturas: [] },
  };

  let modo: 'titulo' | 'clausulas' | 'fechamento' | 'anexo' = 'titulo';

  for (const bloco of blocos) {
    const primeira = bloco[0].trim();

    if (modo === 'titulo') {
      // Cabeçalho: título em várias linhas + régua.
      doc.titulo = bloco.filter((l) => !RE_SEPARADOR.test(l.trim())).map((l) => l.trim());
      modo = 'clausulas';
      continue;
    }

    if (/^ANEXO\s+I\b/.test(primeira)) {
      doc.anexo.titulo = primeira;
      modo = 'anexo';
      continue;
    }

    if (modo === 'anexo') {
      if (eAssinatura(bloco)) doc.anexo.assinaturas.push(lerAssinatura(bloco));
      else doc.anexo.linhas.push(...linhasDoBloco(bloco));
      continue;
    }

    if (eAssinatura(bloco)) {
      doc.assinaturas.push(lerAssinatura(bloco));
      modo = 'fechamento';
      continue;
    }

    if (/^CLÁUSULA\b/.test(primeira)) {
      doc.clausulas.push({ titulo: primeira, linhas: [] });
      modo = 'clausulas';
      continue;
    }

    if (modo === 'fechamento' || /^E ASSIM,/.test(primeira)) {
      modo = 'fechamento';
      doc.fechamento.push(...linhasDoBloco(bloco));
      continue;
    }

    const clausula = doc.clausulas[doc.clausulas.length - 1];
    if (!clausula) throw new Error(`bloco_fora_de_clausula: ${primeira.slice(0, 40)}`);
    clausula.linhas.push(...linhasDoBloco(bloco));
  }

  if (!doc.clausulas.length) throw new Error('template_sem_clausulas');
  return doc;
}

// ─── Substituição de placeholders ────────────────────────────

export function placeholdersDoTemplate(markdown?: string): string[] {
  const md = markdown ?? readFileSync(TEMPLATE_PATH, 'utf8');
  const fence = /```\r?\n([\s\S]*?)```/.exec(md);
  const alvo = fence ? fence[1] : md;
  return [...new Set([...alvo.matchAll(RE_PLACEHOLDER)].map((m) => m[1]))].sort();
}

function trocar(texto: string, valores: Record<string, string>, faltando: Set<string>): string {
  return texto.replace(RE_PLACEHOLDER, (_, chave: string) => {
    const v = valores[chave];
    if (v === undefined || String(v).trim() === '') {
      faltando.add(chave);
      return `{{${chave}}}`;
    }
    return String(v);
  });
}

// ─── Render .docx ────────────────────────────────────────────

function run(texto: string, opts: { bold?: boolean; cor?: string; tam?: number } = {}) {
  return new TextRun({
    text: texto,
    font: FONTE,
    size: opts.tam ?? TAM.corpo,
    bold: opts.bold ?? false,
    color: opts.cor ?? COR.texto,
  });
}

function paragrafoCorpo(l: Linha, valores: Record<string, string>, faltando: Set<string>): Paragraph {
  const runs: TextRun[] = [];
  if (l.prefixo) runs.push(run(`${l.prefixo} `, { bold: true }));

  let resto = l.texto;
  if (l.label) {
    runs.push(run(l.label, { bold: true }));
    resto = resto.slice(l.label.length);
  }
  if (resto) runs.push(run(trocar(resto, valores, faltando)));

  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { before: 0, after: l.continuacao ? 40 : 140, line: 300 },
    indent: l.continuacao ? { left: 340 } : undefined,
    children: runs,
  });
}

function paragrafoClausula(titulo: string): Paragraph {
  return new Paragraph({
    spacing: { before: 320, after: 160 },
    border: {
      left: { style: BorderStyle.SINGLE, size: 14, color: COR.verde, space: 10 },
    },
    children: [run(titulo, { bold: true, cor: COR.navy, tam: TAM.clausula })],
  });
}

function paragrafoTitulo(texto: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 60 },
    children: [run(texto, { bold: true, cor: COR.navy, tam: TAM.titulo })],
  });
}

function reguaVerde(): Paragraph {
  return new Paragraph({
    spacing: { before: 120, after: 320 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: COR.verde, space: 4 } },
    children: [],
  });
}

function blocoAssinatura(a: Assinatura, valores: Record<string, string>, faltando: Set<string>): Paragraph[] {
  const linha = new Paragraph({
    spacing: { before: 520, after: 40 },
    children: [run('__________________________________________________', { cor: COR.cinza })],
  });
  const nome = new Paragraph({
    spacing: { before: 0, after: 20 },
    children: [run(trocar(a.nome, valores, faltando), { bold: true, cor: COR.navy })],
  });
  const out = [linha, nome];
  if (a.papel) {
    out.push(new Paragraph({
      spacing: { before: 0, after: 0 },
      children: [run(trocar(a.papel, valores, faltando), { cor: COR.texto })],
    }));
  }
  return out;
}

function cabecalho(): Header {
  let logo: Paragraph | null = null;
  try {
    const bytes = readFileSync(LOGO_PATH);
    logo = new Paragraph({
      spacing: { before: 0, after: 60 },
      children: [new ImageRun({ data: bytes, type: 'png', transformation: { width: 26, height: 25 } })],
    });
  } catch {
    // Sem o arquivo do logo o cabeçalho degrada para só a régua verde.
    logo = null;
  }
  const filhos = logo ? [logo] : [];
  filhos.push(new Paragraph({
    spacing: { before: 0, after: 0 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: COR.verde, space: 2 } },
    children: [],
  }));
  return new Header({ children: filhos });
}

function rodape(): Footer {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [run('PIPEELO LTDA · CNPJ 44.279.528/0001-17 · pipeelo.com', { cor: COR.cinza, tam: TAM.rodape })],
    })],
  });
}

/**
 * Renderiza o contrato preenchido.
 *
 * TODO: o contrato v5-CRM FINAL tem uma cláusula extra sobre o CRM Funil
 * Inteligente que ainda não está no `template-contrato.md`. Enquanto ela não
 * entra, `opts.crm === true` só muda o item 5 do Anexo I — por isso o
 * `index.ts` devolve o aviso "revisar cláusula CRM" e o Staff confere à mão.
 */
export async function renderDocx(
  campos: Record<string, string>,
  opts: { crm: boolean },
): Promise<Buffer> {
  const doc = parseTemplate();
  const valores: Record<string, string> = {
    ANEXO_SERVICOS: servicosContratados(opts.crm),
    ...campos,
  };
  const faltando = new Set<string>();

  const filhos: Paragraph[] = [];

  for (const t of doc.titulo) filhos.push(paragrafoTitulo(t));
  filhos.push(reguaVerde());

  for (const c of doc.clausulas) {
    filhos.push(paragrafoClausula(c.titulo));
    for (const l of c.linhas) filhos.push(paragrafoCorpo(l, valores, faltando));
  }

  for (const l of doc.fechamento) filhos.push(paragrafoCorpo(l, valores, faltando));
  for (const a of doc.assinaturas) filhos.push(...blocoAssinatura(a, valores, faltando));

  filhos.push(new Paragraph({ pageBreakBefore: true, children: [] }));
  filhos.push(paragrafoTitulo(doc.anexo.titulo));
  filhos.push(reguaVerde());
  for (const l of doc.anexo.linhas) filhos.push(paragrafoCorpo(l, valores, faltando));
  for (const a of doc.anexo.assinaturas) filhos.push(...blocoAssinatura(a, valores, faltando));

  if (faltando.size) throw new CamposFaltando([...faltando].sort());

  const documento = new Document({
    creator: 'Pipeelo',
    title: 'Contrato de Prestação de Serviços — Pipeelo',
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
      headers: { default: cabecalho() },
      footers: { default: rodape() },
      children: filhos,
    }],
  });

  return Packer.toBuffer(documento) as unknown as Promise<Buffer>;
}
