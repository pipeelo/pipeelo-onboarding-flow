import type { Cadastro } from '../schemas/cadastro';
import type { Extracao } from './extracao';
import { servicosContratados } from './template';

/**
 * Mapeia sessão + cadastro + extração dos documentos para os `{{PLACEHOLDERS}}`
 * do `template-contrato.md`.
 *
 * Regra de precedência (design, seção "Dados"): o **cadastro** prevalece no
 * Anexo I (é o que o cliente declarou); o **documento** prevalece na
 * qualificação das partes da Cláusula Primeira.
 */

export type SessaoContrato = {
  id: string;
  slug?: string | null;
  empresa_nome?: string | null;
  erp?: string | null;
  contratou_crm?: boolean | null;
  valor_sessao?: number | string | null;
  qtd_sessoes?: number | string | null;
  valor_mensal?: number | string | null;
  dia_vencimento?: number | string | null;
  valor_implantacao?: number | string | null;
  implantacao_vencimento?: string | null;
  primeira_mensalidade_em?: string | null;
  cadastro_enviado_at?: string | null;
};

export type EnderecoCnpj = { municipio: string; uf: string };

export type ResultadoCampos = {
  campos: Record<string, string>;
  faltando: string[];
};

/** Prazo padrão de testes do cronograma de 30 dias (decisão do design). */
export const PRAZO_TESTES_PADRAO = '10 dias';

/** Faixas da tabela Core (skill `pipeelo-financeiro`). */
const FAIXAS: Array<{ min: number; max: number; rotulo: string }> = [
  { min: 0, max: 2000, rotulo: 'Até 2.000 sessões/mês' },
  { min: 2001, max: 4999, rotulo: '2.001 – 4.999 sessões/mês' },
  { min: 5000, max: 7999, rotulo: '5.000 – 7.999 sessões/mês' },
  { min: 8000, max: 11999, rotulo: '8.000 – 11.999 sessões/mês' },
  { min: 12000, max: 17999, rotulo: '12.000 – 17.999 sessões/mês' },
  { min: 18000, max: 24999, rotulo: '18.000 – 24.999 sessões/mês' },
  { min: 25000, max: Number.POSITIVE_INFINITY, rotulo: 'Acima de 25.000 sessões/mês' },
];

/**
 * O contrato é assinado no Brasil: a data por extenso segue sempre o fuso de
 * São Paulo, não o do servidor. Sem isso, um envio às 23h30 (BRT) vira o dia
 * seguinte em UTC e o contrato sai com a data errada.
 */
const FORMATO_EXTENSO = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** `1234.5` → `R$ 1.234,50`. Devolve '' quando não há valor. */
export function moeda(v: unknown): string {
  const n = numero(v);
  if (n === null) return '';
  const [inteiro, decimal] = n.toFixed(2).split('.');
  return `R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimal}`;
}

/** `2640` → `2.640`. */
export function inteiro(v: unknown): string {
  const n = numero(v);
  if (n === null) return '';
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** `2026-09-15` (ou ISO com hora) → `15/09/2026`. */
export function dataCurta(v: unknown): string {
  const s = typeof v === 'string' ? v.slice(0, 10) : '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** `new Date()` → `2 de setembro de 2026` (sempre no fuso de São Paulo). */
export function dataPorExtenso(d: Date = new Date()): string {
  // NBSP aparece em algumas versões do ICU; o .docx fica melhor com espaço normal.
  return FORMATO_EXTENSO.format(d).replace(/\u00a0/g, ' ');
}

/**
 * Data que vai no fecho do contrato: o dia em que o cliente enviou o cadastro
 * (design, seção "Placeholders"). Sem esse carimbo — reprocesso de sessão
 * antiga — cai para hoje.
 */
export function dataAssinatura(cadastroEnviadoAt?: string | null): string {
  if (cadastroEnviadoAt && String(cadastroEnviadoAt).trim()) {
    const d = new Date(cadastroEnviadoAt);
    if (!Number.isNaN(d.getTime())) return dataPorExtenso(d);
  }
  return dataPorExtenso();
}

/** 14 dígitos → `11.222.333/0001-81`. */
export function formatarCnpj(v: string): string {
  const d = (v || '').replace(/\D/g, '');
  if (d.length !== 14) return v || '';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function faixaDe(qtd: number | null): string {
  if (qtd === null) return '';
  const f = FAIXAS.find((x) => qtd >= x.min && qtd <= x.max);
  return f ? f.rotulo : `${inteiro(qtd)} sessões/mês`;
}

function rg(e: Extracao['representante']): string {
  if (!e) return '';
  const orgao = [e.orgao_rg, e.uf_rg].filter(Boolean).join('/');
  return [e.rg, orgao].filter(Boolean).join(' ').trim();
}

export function montarCampos(
  sessao: SessaoContrato,
  cadastro: Cadastro,
  extracao: Extracao,
  endereco: EnderecoCnpj | null,
): ResultadoCampos {
  const rep = extracao.representante;
  const qtd = numero(sessao.qtd_sessoes);

  const campos: Record<string, string> = {
    // Cláusula Primeira — documento prevalece, cadastro é o fallback.
    CONTRATANTE_RAZAO_SOCIAL: extracao.razao_social || cadastro.razao_social || '',
    CONTRATANTE_CNPJ: formatarCnpj(extracao.cnpj || cadastro.cnpj),
    CONTRATANTE_ENDERECO: extracao.endereco_sede || '',
    CONTRATANTE_REPRESENTANTE: rep?.nome || '',
    CONTRATANTE_ESTADO_CIVIL: rep?.estado_civil || '',
    CONTRATANTE_PROFISSAO: rep?.profissao || '',
    CONTRATANTE_RG: rg(rep),
    CONTRATANTE_CPF: rep?.cpf || '',
    CONTRATANTE_END_REP: rep?.endereco || '',
    CONTRATANTE_CIDADE_ASSINATURA: endereco?.municipio || '',
    DATA_ASSINATURA: dataAssinatura(sessao.cadastro_enviado_at),

    // Anexo I — cadastro e fechamento comercial prevalecem.
    ANEXO_PROVEDOR: cadastro.nome_fantasia || cadastro.razao_social || '',
    ANEXO_CNPJ: formatarCnpj(cadastro.cnpj),
    ANEXO_ERP: sessao.erp || '',
    ANEXO_PACOTE: faixaDe(qtd),
    ANEXO_VALOR_SESSAO: moeda(sessao.valor_sessao),
    ANEXO_SESSOES_INCLUIDAS: qtd === null ? '' : `${inteiro(qtd)} sessões/mês`,
    ANEXO_VALOR_MENSAL: moeda(sessao.valor_mensal),
    ANEXO_TAXA_IMPLANTACAO: moeda(sessao.valor_implantacao),
    ANEXO_DATA_VENCIMENTO_IMPL: dataCurta(sessao.implantacao_vencimento),
    ANEXO_SERVICOS: servicosContratados(Boolean(sessao.contratou_crm)),
    ANEXO_PRAZO_TESTES: PRAZO_TESTES_PADRAO,
    ANEXO_DIA_VENCIMENTO: sessao.dia_vencimento ? `dia ${sessao.dia_vencimento}` : '',
  };

  const faltando = Object.entries(campos)
    .filter(([, v]) => !v || !v.trim())
    .map(([k]) => k)
    .sort();

  return { campos, faltando };
}
