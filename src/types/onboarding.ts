// Onboarding Types
export type QuestionType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'url'
  | 'url_optional'
  | 'time'
  | 'horario_semanal'
  | 'select'
  | 'checkbox_multiple'
  | 'info'
  | 'info_link'
  | 'cnpj'
  | 'cpf'
  | 'email'
  | 'phone'
  | 'repeater'
  | 'file_upload';

/** Definição de um campo dentro de um item do repeater. */
export interface RepeaterFieldDef {
  id: string;
  label: string;
  tipo: 'text' | 'textarea' | 'number' | 'currency' | 'select' | 'checkbox_multiple' | 'boolean';
  obrigatoria?: boolean;
  placeholder?: string;
  hint?: string;
  opcoes?: QuestionOption[];
  /** Largura em colunas no grid de 12 (default 12 = ocupa linha inteira). */
  largura?: 3 | 4 | 6 | 8 | 12;
}

export interface QuestionOption {
  value: string;
  label: string;
}

export interface Question {
  id: string;
  pergunta: string;
  tipo: QuestionType;
  obrigatoria: boolean;
  opcoes?: QuestionOption[];
  validacao?: string;
  placeholder?: string;
  hint?: string;
  link?: string;
  texto?: string;
  condicional?: string;
  /** Para tipo='repeater': definição dos campos de cada item. */
  campos?: RepeaterFieldDef[];
  /** Para tipo='repeater': rótulo do botão "Adicionar" (default: "Adicionar"). */
  rotulo_adicionar?: string;
  /** Para tipo='repeater': rótulo singular do item ("Plano", "Pacote", etc). */
  rotulo_item?: string;
  /** Para tipo='repeater': mínimo/máximo de itens. */
  minimo?: number;
  maximo?: number;
  /** Para tipo='file_upload': extensões aceitas sem ponto (default xlsx/xls/csv). */
  extensoes?: string[];
  /** Para tipo='file_upload': tamanho máximo em MB (default 5). */
  max_mb?: number;
}

/** Valor salvo como resposta de uma pergunta tipo='file_upload'. */
export interface FileUploadValue {
  path: string;
  nome_original: string;
  tamanho: number;
}

export interface Section {
  titulo: string;
  icone: string;
  descricao?: string;
  perguntas: Question[];
  /** Expressão avaliada via evaluateConditional — se falsa, a seção inteira é ocultada. */
  condicional_secao?: string;
}

export interface Departamento {
  nome: string;
  slug: string;
  responsavel_sugerido: string;
  tempo_estimado: string;
  descricao: string;
  ordem_execucao: number;
  secoes: Record<string, Section>;
}

export interface OnboardingStructure {
  total_departamentos: number;
  ordem_sugerida: string[];
  tempo_total_estimado: string;
  descricao: string;
}

export interface OnboardingData {
  onboarding_structure: OnboardingStructure;
  departamentos: Record<string, Departamento>;
}

export interface OnboardingSession {
  id: string;
  empresa_id: string;
  empresa_nome: string;
  ceo_email: string;
  status: 'pendente' | 'em_andamento' | 'concluido';
  created_at: string;
  completed_at: string | null;

  // Vínculo com tenant Pipeelo criado via admin-pipeelo API
  tenant_id: string | null;
  pipeelo_token: string | null;
  cnpj: string | null;
  razao_social: string | null;
  whatsapp_business: string | null;
  admin_email: string | null;
  tipo_empresa: string | null;

  identificacao_completo: boolean;
  identificacao_respondido_por: string | null;
  identificacao_respondido_em: string | null;

  sac_geral_completo: boolean;
  sac_geral_respondido_por: string | null;
  sac_geral_respondido_em: string | null;

  financeiro_completo: boolean;
  financeiro_respondido_por: string | null;
  financeiro_respondido_em: string | null;

  suporte_completo: boolean;
  suporte_respondido_por: string | null;
  suporte_respondido_em: string | null;

  vendas_completo: boolean;
  vendas_respondido_por: string | null;
  vendas_respondido_em: string | null;
}

export interface OnboardingResposta {
  id: string;
  session_id: string;
  departamento: string;
  secao: string;
  pergunta_id: string;
  pergunta_texto: string;
  resposta: any;
  respondido_em: string;
  tipo_pergunta: string;
  obrigatoria: boolean;
}

export type DepartmentId = 'identificacao' | 'sac_geral' | 'financeiro' | 'suporte' | 'vendas';

export const DEPARTMENT_COLORS: Record<DepartmentId, string> = {
  identificacao: 'slate-600',
  sac_geral: 'pipeelo-purple',
  financeiro: 'pipeelo-green',
  suporte: 'pipeelo-blue',
  vendas: 'amber-500'
};

export const DEPARTMENT_ICONS: Record<DepartmentId, string> = {
  identificacao: 'IdCard',
  sac_geral: 'Building2',
  financeiro: 'DollarSign',
  suporte: 'Wrench',
  vendas: 'TrendingUp'
};

export const DEPARTMENT_ORDER: DepartmentId[] = [
  'identificacao',
  'sac_geral',
  'financeiro',
  'suporte',
  'vendas',
];
