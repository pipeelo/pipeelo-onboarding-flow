import { useState, useCallback, useMemo } from 'react';
import { Question, DepartmentId } from '@/types/onboarding';
import onboardingData from '@/lib/questions.json';

export interface OnboardingState {
  empresaNome: string;
  departamento: DepartmentId | null;
  currentSectionIndex: number;
  currentQuestionIndex: number;
  respostas: Record<string, any>;
  responsavelNome: string;
}

export function useOnboarding() {
  const [state, setState] = useState<OnboardingState>({
    empresaNome: '',
    departamento: null,
    currentSectionIndex: 0,
    currentQuestionIndex: 0,
    respostas: {},
    responsavelNome: ''
  });

  const departamentoData = useMemo(() => {
    if (!state.departamento) return null;
    return onboardingData.departamentos[state.departamento];
  }, [state.departamento]);

  const sections = useMemo(() => {
    if (!departamentoData) return [];
    return Object.entries(departamentoData.secoes)
      .map(([key, section]) => ({
        id: key,
        ...section
      }))
      .filter((section: { condicional_secao?: string }) => {
        if (!section.condicional_secao) return true;
        return evaluateConditional(section.condicional_secao, state.respostas);
      });
  }, [departamentoData, state.respostas]);

  const currentSection = sections[state.currentSectionIndex];

  const visibleQuestions = useMemo(() => {
    if (!currentSection) return [];
    return expandQuestions(currentSection.perguntas as Question[], state.respostas);
  }, [currentSection, state.respostas]);

  const currentQuestion = visibleQuestions[state.currentQuestionIndex];

  const allQuestions = useMemo(() => {
    return sections.flatMap(section => expandQuestions(section.perguntas as Question[], state.respostas));
  }, [sections, state.respostas]);

  const totalQuestions = allQuestions.length;
  
  const answeredQuestions = useMemo(() => {
    return allQuestions.filter(q => {
      if (q.tipo === 'info' || q.tipo === 'info_link') return true;
      if (q.tipo === 'grupo') {
        return (q.campos ?? []).some((c) => {
          const v = state.respostas[c.id];
          return v !== undefined && v !== '' && v !== null;
        });
      }
      const resposta = state.respostas[q.id];
      return resposta !== undefined && resposta !== '' && resposta !== null;
    }).length;
  }, [allQuestions, state.respostas]);

  const progress = totalQuestions > 0 ? (answeredQuestions / totalQuestions) * 100 : 0;

  const setEmpresaNome = useCallback((nome: string) => {
    setState(prev => ({ ...prev, empresaNome: nome }));
  }, []);

  const setDepartamento = useCallback((dept: DepartmentId) => {
    setState(prev => ({ 
      ...prev, 
      departamento: dept,
      currentSectionIndex: 0,
      currentQuestionIndex: 0
    }));
  }, []);

  const setResposta = useCallback((questionId: string, value: any) => {
    setState(prev => ({
      ...prev,
      respostas: { ...prev.respostas, [questionId]: value }
    }));
  }, []);

  const nextQuestion = useCallback(() => {
    setState(prev => {
      if (prev.currentQuestionIndex < visibleQuestions.length - 1) {
        return { ...prev, currentQuestionIndex: prev.currentQuestionIndex + 1 };
      } else if (prev.currentSectionIndex < sections.length - 1) {
        return { 
          ...prev, 
          currentSectionIndex: prev.currentSectionIndex + 1,
          currentQuestionIndex: 0
        };
      }
      return prev;
    });
  }, [visibleQuestions.length, sections.length]);

  const previousQuestion = useCallback(() => {
    setState(prev => {
      if (prev.currentQuestionIndex > 0) {
        return { ...prev, currentQuestionIndex: prev.currentQuestionIndex - 1 };
      } else if (prev.currentSectionIndex > 0) {
        const prevSectionQuestions = expandQuestions(
          sections[prev.currentSectionIndex - 1].perguntas as Question[],
          prev.respostas
        );
        return { 
          ...prev, 
          currentSectionIndex: prev.currentSectionIndex - 1,
          currentQuestionIndex: prevSectionQuestions.length - 1
        };
      }
      return prev;
    });
  }, [sections]);

  const isFirstQuestion = state.currentSectionIndex === 0 && state.currentQuestionIndex === 0;
  
  const isLastQuestion = state.currentSectionIndex === sections.length - 1 && 
    state.currentQuestionIndex === visibleQuestions.length - 1;

  const setResponsavelNome = useCallback((nome: string) => {
    setState(prev => ({ ...prev, responsavelNome: nome }));
  }, []);

  const resetOnboarding = useCallback(() => {
    setState({
      empresaNome: '',
      departamento: null,
      currentSectionIndex: 0,
      currentQuestionIndex: 0,
      respostas: {},
      responsavelNome: ''
    });
  }, []);

  return {
    state,
    departamentoData,
    sections,
    currentSection,
    currentQuestion,
    visibleQuestions,
    totalQuestions,
    answeredQuestions,
    progress,
    isFirstQuestion,
    isLastQuestion,
    setEmpresaNome,
    setDepartamento,
    setResposta,
    nextQuestion,
    previousQuestion,
    setResponsavelNome,
    resetOnboarding
  };
}

/**
 * Itens marcados numa checkbox_multiple, como pares {value,label}. O texto de "Outro"
 * aceita vários nomes separados por vírgula: cada um vira um item `outro_<n>`.
 */
export function itensMarcados(
  perguntaId: string,
  respostas: Record<string, any>,
  todas: Question[]
): Array<{ value: string; label: string }> {
  const resposta = respostas[perguntaId];
  const selected: string[] = Array.isArray(resposta)
    ? resposta
    : resposta && typeof resposta === 'object' && Array.isArray(resposta.selected)
      ? resposta.selected
      : [];
  const def = todas.find((q) => q.id === perguntaId);
  const itens: Array<{ value: string; label: string }> = [];
  for (const v of selected) {
    if (v === 'outro') {
      const nomes = String(resposta?.outroTexto ?? '')
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      nomes.forEach((nome, i) => itens.push({ value: `outro_${i + 1}`, label: nome }));
      continue;
    }
    const opt = def?.opcoes?.find((o) => o.value === v);
    itens.push({ value: v, label: opt?.label ?? v });
  }
  return itens;
}

/** Perguntas do questions.json (todos os departamentos) — usadas pra resolver `repetir_por`/`opcoes_de`. */
const TODAS_PERGUNTAS: Question[] = Object.values(onboardingData.departamentos).flatMap((d) =>
  Object.values(d.secoes).flatMap((s) => s.perguntas as Question[])
);

/**
 * Aplica condicionais e expande `repetir_por` (uma pergunta por item marcado, com
 * `{departamento}` substituído pelo rótulo) e `opcoes_de` (opções dinâmicas).
 */
export function expandQuestions(perguntas: Question[], respostas: Record<string, any>): Question[] {
  const out: Question[] = [];
  for (const q of perguntas) {
    if (q.condicional && !evaluateConditional(q.condicional, respostas)) continue;
    if (q.repetir_por) {
      for (const item of itensMarcados(q.repetir_por, respostas, TODAS_PERGUNTAS)) {
        const troca = (s?: string) => s?.replace(/\{departamento\}/g, item.label);
        out.push({
          ...q,
          id: `${q.id}_${item.value}`,
          origem_id: q.id,
          pergunta: troca(q.pergunta) ?? q.pergunta,
          hint: troca(q.hint),
          repetir_por: undefined,
        });
      }
      continue;
    }
    if (q.opcoes_de) {
      const opcoes = itensMarcados(q.opcoes_de, respostas, TODAS_PERGUNTAS);
      if (opcoes.length === 0) continue;
      out.push({ ...q, opcoes });
      continue;
    }
    out.push(q);
  }
  return out;
}

function evaluateConditional(condicional: string, respostas: Record<string, any>): boolean {
  try {
    // Tira parens externas redundantes pra evitar loop em ((expr)).
    let trimmed = condicional.trim();
    while (
      trimmed.startsWith('(') &&
      trimmed.endsWith(')') &&
      isBalancedAtBoundary(trimmed)
    ) {
      trimmed = trimmed.slice(1, -1).trim();
    }

    // OR tem precedência MENOR que AND, então split por || primeiro
    // (paren-aware). Cada parte é uma sub-expressão que pode conter &&.
    const orParts = splitTopLevel(trimmed, ' || ');
    if (orParts.length > 1) {
      return orParts.some(p => evaluateConditional(p, respostas));
    }

    // AND no mesmo nível. Split paren-aware.
    const andParts = splitTopLevel(trimmed, ' && ');
    if (andParts.length > 1) {
      return andParts.every(p => evaluateConditional(p, respostas));
    }

    // Atom: usa `trimmed` daqui pra frente.
    condicional = trimmed;

    // Handle "includes" / "contains" pattern: "departamentos_lista includes 'outro'"
    // 'contains' é alias de 'includes' (usado em condicional_secao do questions.json)
    const membershipOp = condicional.includes(' includes ')
      ? ' includes '
      : condicional.includes(' contains ')
        ? ' contains '
        : null;
    if (membershipOp) {
      const [campo, valorRaw] = condicional.split(membershipOp);
      const valor = valorRaw.replace(/'/g, '').trim();
      const resposta = respostas[campo.trim()];

      // Handle checkbox_multiple that stores { selected: [], outroTexto: '' }
      if (resposta && typeof resposta === 'object' && 'selected' in resposta) {
        return Array.isArray(resposta.selected) && resposta.selected.includes(valor);
      }

      if (Array.isArray(resposta)) {
        return resposta.includes(valor);
      }
      return false;
    }

    // OR/AND já tratados no topo da função (paren-aware).

    // Handle "==" pattern: "tem_plantao == 'sim'"
    if (condicional.includes(' == ')) {
      const [campo, valorRaw] = condicional.split(' == ');
      const valor = valorRaw.replace(/'/g, '').trim();
      const resposta = respostas[campo.trim()];
      // checkbox_multiple armazena { selected: [...] } — comparar contra selected
      if (resposta && typeof resposta === 'object' && 'selected' in resposta) {
        const selected: unknown[] = Array.isArray(resposta.selected) ? resposta.selected : [];
        return selected.length === 1 && selected[0] === valor;
      }
      if (Array.isArray(resposta)) {
        return resposta.length === 1 && resposta[0] === valor;
      }
      return resposta === valor;
    }

    // Handle "!=" pattern
    if (condicional.includes(' != ')) {
      const [campo, valorRaw] = condicional.split(' != ');
      const valor = valorRaw.replace(/'/g, '').trim();
      const resposta = respostas[campo.trim()];
      // checkbox_multiple: "!= 'nenhum'" significa "selecionou algo além de 'nenhum'"
      if (resposta && typeof resposta === 'object' && 'selected' in resposta) {
        const selected: unknown[] = Array.isArray(resposta.selected) ? resposta.selected : [];
        return selected.some(v => v !== valor);
      }
      if (Array.isArray(resposta)) {
        return resposta.some(v => v !== valor);
      }
      return resposta !== valor;
    }

    return true;
  } catch (error) {
    console.warn('Error evaluating conditional:', condicional, error);
    return true;
  }
}

/**
 * Split paren-aware: divide `s` por `op` (ex: " || ", " && ") apenas
 * quando o operador está no nível 0 de parênteses. Retorna [s] se não
 * encontrar nenhum operador no top-level.
 */
function splitTopLevel(s: string, op: string): string[] {
  const parts: string[] = [];
  let current = '';
  let parenDepth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') parenDepth++;
    if (ch === ')') parenDepth--;
    if (parenDepth === 0 && s.slice(i, i + op.length) === op) {
      parts.push(current.trim());
      current = '';
      i += op.length - 1;
    } else {
      current += ch;
    }
  }
  parts.push(current.trim());
  return parts;
}

/**
 * Confirma que a string `s` começa com `(` e o paren que abre na posição 0
 * só fecha na última posição. Evita strip indevido em casos como
 * "(A) || (B)".
 */
function isBalancedAtBoundary(s: string): boolean {
  if (!s.startsWith('(') || !s.endsWith(')')) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      if (depth === 0 && i < s.length - 1) return false;
    }
  }
  return depth === 0;
}
