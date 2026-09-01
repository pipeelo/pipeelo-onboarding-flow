import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Building2, DollarSign, Wrench, TrendingUp, Loader2, IdCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PipeeloLogo } from '@/components/PipeeloLogo';
import { ProgressBar } from '@/components/onboarding/ProgressBar';
import { QuestionRenderer } from '@/components/onboarding/QuestionRenderer';
import { useOnboarding } from '@/hooks/useOnboarding';
import { DepartmentId } from '@/types/onboarding';
import { useToast } from '@/hooks/use-toast';
import { sessionApi, ApiError } from '@/lib/api-client';
import { useDebouncedAutosave } from '@/lib/debounced-save';

type Step = 'perguntas' | 'resumo' | 'sucesso';

const departmentIcons: Record<DepartmentId, typeof Building2> = {
  identificacao: IdCard,
  sac_geral: Building2,
  financeiro: DollarSign,
  suporte: Wrench,
  vendas: TrendingUp
};

const VALID_DEPTS: DepartmentId[] = ['identificacao', 'sac_geral', 'financeiro', 'suporte', 'vendas'];

/**
 * Tela de preenchimento do questionário (HARD-01 + HARD-02 + HARD-03).
 *
 * Fluxo refatorado:
 * - Hidrata estado via `sessionApi.get(slug, token)` (obrigatório `?token=` na URL).
 * - Per-question autosave debounced 500ms via `useDebouncedAutosave` chamando
 *   `sessionApi.saveResposta` — server é fonte de verdade.
 * - `handleSubmit` final chama `sessionApi.completeDepartment` para marcar status
 *   (gate enforced server-side em departamentos não-Identificação).
 * - Side-effects legacy (`/api/provision-tenant`, `/api/sync-department`,
 *   `/api/complete-onboarding`, `/api/send-email`) MANTIDOS com `keepalive: true`
 *   até Phase 2 reescrever com outbox pattern.
 */
export default function Onboarding() {
  const { slug, departamento: urlDepartamento } = useParams<{ slug: string; departamento: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const isComercial = searchParams.get('modo') === 'comercial';
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('perguntas');
  const [error, setError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [empresaNome, setEmpresaNomeState] = useState<string>('');
  const [allStatuses, setAllStatuses] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);

  const {
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
  } = useOnboarding();

  // Hidratar do servidor ao montar
  useEffect(() => {
    const loadSession = async () => {
      if (!slug || !urlDepartamento) {
        navigate('/');
        return;
      }
      if (!VALID_DEPTS.includes(urlDepartamento as DepartmentId)) {
        navigate('/');
        return;
      }
      if (!token) {
        toast({
          title: 'Link inválido',
          description: 'Token ausente. Use o magic link enviado por email.',
          variant: 'destructive',
        });
        navigate('/');
        return;
      }

      try {
        const { session, respostas } = await sessionApi.get(slug, token);
        setSessionId(session.id);
        setEmpresaNomeState(session.empresa_nome);
        setEmpresaNome(session.empresa_nome);
        setDepartamento(urlDepartamento as DepartmentId);
        setAllStatuses({
          status_identificacao: session.status_identificacao,
          status_sac_geral: session.status_sac_geral,
          status_financeiro: session.status_financeiro,
          status_suporte: session.status_suporte,
          status_vendas: session.status_vendas,
        });

        // Injeta a stack tecnológica da sessão como pseudo-respostas `_session_*`.
        // Usadas em condicional_secao / condicional pra mostrar só as perguntas
        // de credenciais dos sistemas que o admin marcou. Pseudo-fields nunca
        // são salvas no DB (não existem como pergunta em questions.json).
        const s = session as {
          erp?: string | null;
          mapas?: string | null;
          gerenciamento_rede?: string | null;
          gateway_pagamento?: string | null;
        };
        setResposta('_session_erp', s.erp ?? '');
        setResposta('_session_mapas', s.mapas ?? '');
        setResposta('_session_gerenciamento_rede', s.gerenciamento_rede ?? '');
        setResposta('_session_gateway_pagamento', s.gateway_pagamento ?? '');
        setResposta('_session_modo', isComercial ? 'comercial' : 'completo');

        // Hidratar respostas existentes do departamento atual
        const ofDept = respostas.filter((r) => r.departamento === urlDepartamento);
        ofDept.forEach((r) => {
          setResposta(r.pergunta_id, r.valor);
        });

        // Identificação: dados já informados no /cadastro entram como default
        // (só quando o cliente ainda não respondeu). O autosave persiste ao avançar.
        if (urlDepartamento === 'identificacao') {
          const cad = (session as { cadastro?: Record<string, unknown> | null }).cadastro ?? null;
          const respondidas = new Set(ofDept.map((r) => r.pergunta_id));
          const prefill: Array<[string, unknown]> = [
            ['cnpj', cad?.cnpj],
            ['razao_social', cad?.razao_social],
            ['nome_fantasia', cad?.nome_fantasia],
          ];
          for (const [id, valor] of prefill) {
            if (!respondidas.has(id) && typeof valor === 'string' && valor) setResposta(id, valor);
          }
        }
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.status === 401) {
            toast({
              title: 'Link inválido',
              description: 'Token incorreto ou sessão não encontrada.',
              variant: 'destructive',
            });
          } else if (e.status === 410) {
            toast({
              title: 'Sessão expirou',
              description: 'Solicite um novo link (>30 dias).',
              variant: 'destructive',
            });
          } else {
            toast({
              title: 'Erro ao carregar sessão',
              description: e.message,
              variant: 'destructive',
            });
          }
        } else {
          // eslint-disable-next-line no-console
          console.error('Erro ao carregar sessão:', e);
        }
        navigate('/');
        return;
      }

      setLoading(false);
    };

    loadSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, urlDepartamento, token]);

  // Autosave per-question debounced (HARD-02)
  const currentQuestionId = currentQuestion?.id;
  const currentValue = currentQuestionId ? state.respostas[currentQuestionId] : undefined;
  const lastSavedKeyRef = useRef<string | null>(null);

  const saver = useCallback(
    async (v: unknown) => {
      if (!slug || !token || !state.departamento || !currentQuestionId) return;
      // pseudo-respostas (stack injetada da sessão) nunca vão pra DB
      if (currentQuestionId.startsWith('_session_')) return;
      if (v === undefined || v === null || v === '') return;
      try {
        await sessionApi.saveResposta({
          slug,
          token,
          departamento: state.departamento,
          pergunta_id: currentQuestionId,
          valor: v,
        });
        lastSavedKeyRef.current = `${currentQuestionId}:${JSON.stringify(v)}`;
      } catch (e) {
        // Silencioso — debounced-save loga + value continua em state pra retry
        // eslint-disable-next-line no-console
        console.error('[autosave] falhou', e);
      }
    },
    [slug, token, state.departamento, currentQuestionId]
  );

  useDebouncedAutosave(currentValue, saver, 500, !!currentQuestionId && !loading);

  const validateCurrentQuestion = () => {
    if (!currentQuestion) return true;

    if (currentQuestion.tipo === 'info' || currentQuestion.tipo === 'info_link') {
      return true;
    }

    const resposta = state.respostas[currentQuestion.id];

    // Nenhuma pergunta trava o avanço — cliente sempre pode pular.
    // Mantemos apenas validações de formato (URL/min) que só rodam se preencheu.

    if (currentQuestion.tipo === 'url' && resposta) {
      try {
        new URL(resposta);
      } catch {
        setError('URL inválida');
        return false;
      }
    }

    if (currentQuestion.validacao && resposta) {
      if (currentQuestion.validacao.startsWith('min:')) {
        const min = parseInt(currentQuestion.validacao.split(':')[1]);
        if (resposta.length < min) {
          setError(`Mínimo ${min} caracteres`);
          return false;
        }
      }
    }

    setError('');
    return true;
  };

  const handleNext = () => {
    if (step === 'perguntas') {
      if (!validateCurrentQuestion()) return;

      if (isLastQuestion) {
        setStep('resumo');
      } else {
        nextQuestion();
      }
    } else if (step === 'resumo') {
      if (!state.responsavelNome.trim()) {
        setError('Digite seu nome');
        return;
      }
      handleSubmit();
    }
  };

  const handleBack = () => {
    setError('');
    if (step === 'perguntas') {
      if (isFirstQuestion) {
        // No modo comercial não existe lista de departamentos pra voltar.
        if (isComercial) return;
        const tokenSuffix = token ? `?token=${encodeURIComponent(token)}` : '';
        navigate(`/${slug}${tokenSuffix}`);
      } else {
        previousQuestion();
      }
    } else if (step === 'resumo') {
      setStep('perguntas');
    }
  };

  const handleSubmit = async () => {
    if (!state.departamento || !departamentoData || !sessionId || !slug || !token) return;

    setIsSubmitting(true);

    try {
      // Marcar departamento como concluído via API (gate enforced server-side)
      await sessionApi.completeDepartment({
        slug,
        token,
        departamento: state.departamento,
        responsavel_nome: state.responsavelNome,
      });

      toast({
        title: 'Respostas salvas!',
        description: `O departamento ${departamentoData.nome} foi salvo com sucesso. Você pode editar a qualquer momento.`,
      });

      // Modo comercial: Identificação → Vendas. Só mostra tela final após Vendas.
      if (isComercial && state.departamento === 'identificacao') {
        const params = new URLSearchParams();
        if (token) params.set('token', token);
        params.set('modo', 'comercial');
        navigate(`/${slug}/vendas?${params.toString()}`, { replace: true });
      } else {
        setStep('sucesso');
      }
      setIsSubmitting(false);

      // Disparar integrações em background (Vercel Functions).
      // keepalive:true mitiga Pitfall 1 (fire-and-forget sem keepalive).
      // Phase 2 reescreve com outbox pattern.
      const postJson = (path: string, body: unknown) =>
        fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          keepalive: true,
        })
          .then((r) => r.json())
          // eslint-disable-next-line no-console
          .catch((err) => console.error(`${path} failed (non-blocking):`, err));

      // 1. Se for Identificação → provisionar tenant no admin-pipeelo
      if (state.departamento === 'identificacao') {
        const r = state.respostas;
        postJson('/api/provision-tenant', {
          sessionId,
          cnpj: r.cnpj,
          razao_social: r.razao_social,
          nome_fantasia: r.nome_fantasia,
          responsavel_nome: r.responsavel_nome,
          responsavel_cpf: r.responsavel_cpf,
          admin_email: r.admin_email,
          whatsapp_business: r.whatsapp_business,
          numero_assinantes: r.numero_assinantes,
        });
      } else {
        // 2. Outros deptos → sync parcial (categorias, office-hours)
        postJson('/api/sync-department', {
          sessionId,
          departamento: state.departamento,
        });
      }

      // 3. Webhook final se TUDO concluído (calculado a partir do estado local
      // pós-completeDepartment: o departamento atual acaba de virar 'concluido').
      // Modo comercial: só Identificação + Vendas são obrigatórios.
      const updatedStatuses = {
        ...allStatuses,
        [`status_${state.departamento}`]: 'concluido',
      };
      const allDeptsCompleted = isComercial
        ? updatedStatuses.status_identificacao === 'concluido' &&
          updatedStatuses.status_vendas === 'concluido'
        : updatedStatuses.status_identificacao === 'concluido' &&
          updatedStatuses.status_sac_geral === 'concluido' &&
          updatedStatuses.status_financeiro === 'concluido' &&
          updatedStatuses.status_suporte === 'concluido' &&
          updatedStatuses.status_vendas === 'concluido';

      if (allDeptsCompleted) {
        postJson('/api/complete-onboarding', { sessionId });
      }

      // 4. Email de notificação — filtra pseudo-respostas e credenciais sensíveis.
      // Prefixos `_session_`, `erp_`, `gateway_`, `rede_`, `mapas_` são da seção
      // Acessos das Integrações: tokens, senhas e config interna. Não vão no email.
      const SENSITIVE_PREFIXES = ['_session_', 'erp_', 'gateway_', 'rede_', 'mapas_'];
      const respostasSafe = Object.fromEntries(
        Object.entries(state.respostas).filter(
          ([k]) => !SENSITIVE_PREFIXES.some((p) => k.startsWith(p))
        )
      );
      postJson('/api/send-email', {
        empresaNome,
        departamento: state.departamento,
        departamentoNome: departamentoData.nome,
        responsavelNome: state.responsavelNome,
        respostas: respostasSafe,
        sessionId,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Erro ao concluir departamento:', err);
      if (err instanceof ApiError) {
        if (err.status === 403) {
          toast({
            title: 'Identificação obrigatória',
            description: 'Complete primeiro a Identificação antes de concluir este departamento.',
            variant: 'destructive',
          });
          const tokenSuffix = token ? `?token=${encodeURIComponent(token)}` : '';
          navigate(`/${slug}${tokenSuffix}`);
        } else if (err.status === 401 || err.status === 410) {
          toast({
            title: 'Sessão inválida',
            description: 'Use o link mais recente enviado por email.',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Erro ao salvar',
            description: err.message || 'Não foi possível concluir. Tente novamente.',
            variant: 'destructive',
          });
        }
      } else {
        toast({
          title: 'Erro ao salvar',
          description: 'Não foi possível concluir. Tente novamente.',
          variant: 'destructive',
        });
      }
      setIsSubmitting(false);
    }
  };

  const DeptIcon = state.departamento ? departmentIcons[state.departamento] : null;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <PipeeloLogo />
              {state.departamento && departamentoData && (
                <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="text-border">/</span>
                  <div className="p-1 rounded-md bg-accent/10">
                    {DeptIcon && <DeptIcon className="h-3.5 w-3.5 text-accent" />}
                  </div>
                  <span>{departamentoData.nome}</span>
                </div>
              )}
            </div>

            {step === 'perguntas' && (
              <div className="w-48 sm:w-64">
                <ProgressBar
                  current={answeredQuestions}
                  total={totalQuestions}
                  percentage={progress}
                />
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <AnimatePresence mode="wait">
          {/* Step: Perguntas */}
          {step === 'perguntas' && currentQuestion && (
            <motion.div
              key={`question-${currentQuestion.id}`}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>{currentSection?.icone}</span>
                  <span>{currentSection?.titulo}</span>
                </div>
                <h2 className="text-2xl font-semibold">
                  {currentQuestion.pergunta}
                </h2>
              </div>

              <QuestionRenderer
                question={currentQuestion}
                value={state.respostas[currentQuestion.id]}
                onChange={(value) => {
                  setResposta(currentQuestion.id, value);
                  setError('');
                }}
                onSubmit={handleNext}
                error={error}
                onUploadFile={async (file) => {
                  if (!slug || !token || !state.departamento) throw new Error('sem sessão');
                  const base64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () =>
                      resolve(String(reader.result).split(',')[1] ?? '');
                    reader.onerror = () => reject(reader.error);
                    reader.readAsDataURL(file);
                  });
                  return sessionApi.uploadArquivo({
                    slug,
                    token,
                    departamento: state.departamento,
                    pergunta_id: currentQuestion.id,
                    nome: file.name,
                    content_type: file.type || undefined,
                    base64,
                  });
                }}
              />

              <div className="flex gap-4">
                <Button
                  variant="outline"
                  onClick={handleBack}
                  size="lg"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Voltar
                </Button>
                <Button
                  onClick={handleNext}
                  className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90 font-semibold"
                  size="lg"
                >
                  {isLastQuestion ? 'Revisar respostas' : 'Próxima'}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* Step: Resumo */}
          {step === 'resumo' && (
            <motion.div
              key="resumo"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="space-y-2 text-center">
                <h1 className="text-3xl font-bold">Quase lá!</h1>
                <p className="text-muted-foreground">
                  Revise suas respostas e confirme o envio
                </p>
              </div>

              <div className="space-y-6 max-h-[400px] overflow-y-auto">
                {sections.map((section) => (
                  <div key={section.id} className="space-y-3">
                    <h3 className="font-semibold flex items-center gap-2">
                      <span>{section.icone}</span>
                      {section.titulo}
                    </h3>
                    <div className="space-y-2 pl-6">
                      {section.perguntas
                        .filter((q: any) => q.tipo !== 'info' && q.tipo !== 'info_link')
                        .map((q: any) => {
                          const resposta = state.respostas[q.id];
                          if (resposta === undefined || resposta === '') return null;

                          let displayValue: string = '';

                          if (q.tipo === 'checkbox_multiple') {
                            const selected = resposta?.selected || (Array.isArray(resposta) ? resposta : []);
                            const labels = selected.map((v: string) => {
                              const opt = q.opcoes?.find((o: any) => o.value === v);
                              return opt?.label || v;
                            });
                            if (resposta?.outroTexto) {
                              labels.push(resposta.outroTexto);
                            }
                            displayValue = labels.join(', ');
                          } else if (q.tipo === 'horario_semanal' && typeof resposta === 'object') {
                            const parts = [];
                            if (resposta.segunda_sexta && !resposta.segunda_sexta.nao_atende) {
                              parts.push(`Seg-Sex: ${resposta.segunda_sexta.inicio} às ${resposta.segunda_sexta.fim}`);
                            }
                            if (resposta.sabado && !resposta.sabado.nao_atende) {
                              parts.push(`Sáb: ${resposta.sabado.inicio} às ${resposta.sabado.fim}`);
                            } else if (resposta.sabado?.nao_atende) {
                              parts.push('Sáb: Não atende');
                            }
                            if (resposta.domingo_feriado && !resposta.domingo_feriado.nao_atende) {
                              parts.push(`Dom/Feriado: ${resposta.domingo_feriado.inicio} às ${resposta.domingo_feriado.fim}`);
                            } else if (resposta.domingo_feriado?.nao_atende) {
                              parts.push('Dom/Feriado: Não atende');
                            }
                            displayValue = parts.join(' | ');
                          } else if (q.tipo === 'url_optional' && resposta === 'NAO_POSSUI') {
                            displayValue = 'Não possui portal/área do cliente';
                          } else if (q.tipo === 'select') {
                            const opt = q.opcoes?.find((o: any) => o.value === resposta);
                            displayValue = opt?.label || resposta;
                          } else if (Array.isArray(resposta)) {
                            displayValue = resposta.join(', ');
                          } else if (q.tipo === 'currency') {
                            displayValue = `R$ ${resposta}`;
                          } else {
                            displayValue = String(resposta);
                          }

                          return (
                            <div key={q.id} className="text-sm">
                              <span className="text-muted-foreground">{q.pergunta}</span>
                              <p className="font-medium">{displayValue}</p>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-4 pt-4 border-t">
                <div>
                  <label className="text-sm font-medium">Seu nome completo</label>
                  <Input
                    type="text"
                    value={state.responsavelNome}
                    onChange={(e) => setResponsavelNome(e.target.value)}
                    placeholder="Digite seu nome"
                    className="mt-2"
                  />
                  {error && <p className="text-sm text-destructive mt-1">{error}</p>}
                </div>
              </div>

              <div className="flex gap-4">
                <Button
                  variant="outline"
                  onClick={handleBack}
                  size="lg"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Voltar
                </Button>
                <Button
                  onClick={handleNext}
                  className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90 font-semibold"
                  size="lg"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Confirmar e Enviar
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {/* Step: Sucesso */}
          {step === 'sucesso' && (
            <motion.div
              key="sucesso"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-8 text-center"
            >
              <div className="w-20 h-20 rounded-full bg-pipeelo-green/20 flex items-center justify-center mx-auto">
                <Check className="h-10 w-10 text-pipeelo-green" />
              </div>

              <div className="space-y-2">
                <h1 className="text-3xl font-bold">
                  {isComercial ? 'Onboarding CRM concluído!' : 'Departamento concluído!'}
                </h1>
                <p className="text-muted-foreground">
                  {isComercial ? (
                    <>Suas configurações comerciais foram salvas. Nosso time de implantação vai ativar seu CRM Pipeelo em breve.</>
                  ) : (
                    <>O departamento <strong>{departamentoData?.nome}</strong> foi preenchido com sucesso.</>
                  )}
                </p>
              </div>

              {!isComercial && (
                <div className="bg-muted/50 rounded-xl p-6 space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Você pode compartilhar o link do onboarding com outros responsáveis da sua empresa para que eles preencham os demais departamentos.
                  </p>
                </div>
              )}

              {!isComercial && (
                <div className="flex flex-col gap-3">
                  <Button
                    onClick={() => {
                      const tokenSuffix = token ? `?token=${encodeURIComponent(token)}` : '';
                      navigate(`/${slug}${tokenSuffix}`);
                    }}
                    className="bg-accent text-accent-foreground hover:bg-accent/90 font-semibold"
                    size="lg"
                  >
                    Ver status dos departamentos
                  </Button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
