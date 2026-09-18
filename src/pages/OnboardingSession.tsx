import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { Building2, DollarSign, Wrench, TrendingUp, Check, Clock, ArrowRight, AlertCircle, Info, Users, MessageSquare, Pencil, IdCard } from 'lucide-react';
import { PipeeloLogo } from '@/components/PipeeloLogo';
import { motion } from 'framer-motion';
import { DepartmentId, DEPARTMENT_ORDER } from '@/types/onboarding';
import { sessionApi, ApiError, type SessionDTO } from '@/lib/api-client';

type SessionData = SessionDTO;

const departmentConfig: Record<DepartmentId, {
  icon: typeof Building2;
  label: string;
  description: string;
  suggestedPerson: string;
  estimatedTime: string;
  bloqueante?: boolean;
}> = {
  identificacao: {
    icon: IdCard,
    label: 'Identificação',
    description: 'Números de WhatsApp, templates e acessos das integrações. Preencha primeiro.',
    suggestedPerson: 'Responsável pelo atendimento ou TI',
    estimatedTime: '~5 min',
    bloqueante: true,
  },
  sac_geral: {
    icon: Building2,
    label: 'SAC / Geral',
    description: 'Endereço, departamentos e horários, equipe, processos e aplicativo',
    suggestedPerson: 'Gestor ou Sócio',
    estimatedTime: '~15 min',
  },
  financeiro: {
    icon: DollarSign,
    label: 'Financeiro',
    description: 'Régua de cobrança, gateway, pagamentos, bloqueio e taxas',
    suggestedPerson: 'Responsável Financeiro',
    estimatedTime: '~10 min',
  },
  suporte: {
    icon: Wrench,
    label: 'Suporte Técnico',
    description: 'TR-069, cliente de testes, padrões de diagnóstico e serviços agregados',
    suggestedPerson: 'Técnico ou NOC',
    estimatedTime: '~10 min',
  },
  vendas: {
    icon: TrendingUp,
    label: 'Vendas',
    description: 'Portfólio completo, fluxo de venda, instalação e dados para o CRM',
    suggestedPerson: 'Gerente Comercial',
    estimatedTime: '~10 min',
  },
};

const OnboardingSession = () => {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSession = async () => {
      if (!slug) {
        setError('Link inválido');
        setLoading(false);
        return;
      }
      if (!token) {
        setError('Link inválido — token ausente. Use o magic link enviado por email.');
        setLoading(false);
        return;
      }

      try {
        const { session: dto } = await sessionApi.get(slug, token);
        setSession(dto);
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.status === 401) {
            setError('Link inválido ou token incorreto');
          } else if (e.status === 410) {
            setError('Sessão expirou (>30 dias). Solicite um novo link.');
          } else {
            setError(`Erro ao carregar sessão: ${e.message}`);
          }
        } else {
          // eslint-disable-next-line no-console
          console.error('Erro ao buscar sessão:', e);
          setError('Erro ao carregar dados');
        }
      }
      setLoading(false);
    };

    fetchSession();
  }, [slug, token]);

  const getDepartmentStatus = (deptId: DepartmentId) => {
    if (!session) return { completed: false, responsavel: null, completedAt: null };

    const statusMap: Record<DepartmentId, { status: string | null; responsavel: string | null; completedAt: string | null }> = {
      identificacao: { status: session.status_identificacao, responsavel: session.responsavel_identificacao ?? null, completedAt: session.concluido_identificacao_at ?? null },
      sac_geral: { status: session.status_sac_geral, responsavel: session.responsavel_sac_geral ?? null, completedAt: session.concluido_sac_geral_at ?? null },
      financeiro: { status: session.status_financeiro, responsavel: session.responsavel_financeiro ?? null, completedAt: session.concluido_financeiro_at ?? null },
      suporte: { status: session.status_suporte, responsavel: session.responsavel_suporte ?? null, completedAt: session.concluido_suporte_at ?? null },
      vendas: { status: session.status_vendas, responsavel: session.responsavel_vendas ?? null, completedAt: session.concluido_vendas_at ?? null },
    };

    const info = statusMap[deptId];
    return {
      completed: info.status === 'concluido',
      responsavel: info.responsavel,
      completedAt: info.completedAt,
    };
  };

  const isIdentificacaoCompleta = () => session?.status_identificacao === 'concluido';

  const startDepartment = (deptId: DepartmentId) => {
    const status = getDepartmentStatus(deptId);
    if (status.completed) {
      toast.error('Este departamento já foi preenchido');
      return;
    }
    if (deptId !== 'identificacao' && !isIdentificacaoCompleta()) {
      toast.error('Preencha primeiro o departamento "Identificação" — ele cria o tenant na Pipeelo');
      return;
    }
    // Propaga o token para a rota interna preservar autenticação
    const tokenSuffix = token ? `?token=${encodeURIComponent(token)}` : '';
    navigate(`/${slug}/${deptId}${tokenSuffix}`);
  };

  const getCompletedCount = () => {
    if (!session) return 0;
    let count = 0;
    if (session.status_identificacao === 'concluido') count++;
    if (session.status_sac_geral === 'concluido') count++;
    if (session.status_financeiro === 'concluido') count++;
    if (session.status_suporte === 'concluido') count++;
    if (session.status_vendas === 'concluido') count++;
    return count;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Carregando...</div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md mx-4">
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-16 h-16 mx-auto text-destructive mb-4" />
            <h1 className="text-xl font-semibold text-foreground mb-2">Link Inválido</h1>
            <p className="text-muted-foreground">{error || 'Este link não existe ou expirou.'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const completedCount = getCompletedCount();
  // HARD-06 fix: denominador = DEPARTMENT_ORDER.length (= 5, com Identificação como dept 1)
  const totalDepartments = DEPARTMENT_ORDER.length;
  const allCompleted = completedCount === totalDepartments;
  const progressPct = Math.round((completedCount / totalDepartments) * 100);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40 bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4 flex items-center justify-center">
          <PipeeloLogo size="lg" />
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 max-w-3xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          {/* Welcome Section */}
          <div className="text-center mb-8">
            <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
              Bem-vindo ao Onboarding Pipeelo
            </h1>
            <p className="text-lg text-accent font-medium mb-1">
              {session.empresa_nome}
            </p>
            <p className="text-muted-foreground">
              {allCompleted
                ? 'Parabéns! Todos os departamentos foram preenchidos!'
                : `Progresso: ${completedCount}/${totalDepartments} departamentos concluídos`}
            </p>
          </div>

          {/* Info Cards */}
          {!allCompleted && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mb-8"
            >
              <Card className="bg-primary/5 border-primary/20">
                <CardContent className="p-5">
                  <div className="flex gap-4">
                    <Info className="w-6 h-6 text-primary shrink-0 mt-0.5" />
                    <div className="space-y-3">
                      <h3 className="font-semibold text-foreground">Como funciona o onboarding?</h3>
                      <div className="space-y-2 text-sm text-muted-foreground">
                        <div className="flex items-start gap-2">
                          <Users className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                          <p><strong>Cada departamento pode ser preenchido por uma pessoa diferente.</strong> Encaminhe este link para os responsáveis de cada área.</p>
                        </div>
                        <div className="flex items-start gap-2">
                          <Clock className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                          <p><strong>Tempo total estimado: ~45 minutos</strong> (dividido entre os 4 departamentos).</p>
                        </div>
                        <div className="flex items-start gap-2">
                          <MessageSquare className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                          <p>As respostas são usadas para <strong>configurar o atendimento automatizado</strong> da sua empresa na Pipeelo.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Progress Bar — HARD-06 /5 com DEPARTMENT_ORDER.length */}
          <div className="mb-6" data-testid="overview-progress">
            <div className="flex justify-between text-sm text-muted-foreground mb-2">
              <span>
                Progresso geral ({completedCount}/{totalDepartments})
              </span>
              <span>{progressPct}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-accent rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.5, delay: 0.3 }}
              />
            </div>
          </div>

          {/* Department cards */}
          <div className="space-y-4">
            {(Object.keys(departmentConfig) as DepartmentId[]).map((deptId, index) => {
              const config = departmentConfig[deptId];
              const status = getDepartmentStatus(deptId);
              const Icon = config.icon;

              return (
                <motion.div
                  key={deptId}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + index * 0.1 }}
                >
                  <Card
                    className={`bg-card border transition-[border-color,transform,box-shadow] duration-200 ease-out ${
                      status.completed
                        ? 'border-accent/25 opacity-80'
                        : 'border-border hover:border-accent/40 hover:-translate-y-0.5 hover:shadow-lg cursor-pointer'
                    }`}
                    onClick={() => !status.completed && startDepartment(deptId)}
                  >
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-4">
                          <div className={`p-3 rounded-xl shrink-0 ${status.completed ? 'bg-accent/15' : 'bg-accent/10'}`}>
                            <Icon className="w-6 h-6 text-accent" />
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-semibold text-foreground">{config.label}</h3>
                            <p className="text-sm text-muted-foreground mb-2">{config.description}</p>

                            {status.completed ? (
                              <div className="text-sm text-muted-foreground">
                                <span className="text-accent font-medium">✓ Concluído</span>
                                {status.responsavel && (
                                  <span> por {status.responsavel}</span>
                                )}
                                {status.completedAt && (
                                  <span className="block text-xs mt-1">
                                    {new Date(status.completedAt).toLocaleDateString('pt-BR', {
                                      day: '2-digit',
                                      month: '2-digit',
                                      year: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Users className="w-3 h-3" /> {config.suggestedPerson}
                                </span>
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" /> {config.estimatedTime}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        {status.completed ? (
                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground hover:text-foreground"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const tokenSuffix = token ? `?token=${encodeURIComponent(token)}` : '';
                                  navigate(`/${slug}/${deptId}${tokenSuffix}`);
                                }}
                              >
                                <Pencil className="w-4 h-4 mr-1" />
                                Editar
                              </Button>
                            <div className="p-2 rounded-full bg-accent/15">
                              <Check className="w-5 h-5 text-accent" />
                            </div>
                          </div>
                        ) : (
                          <Button variant="ghost" size="sm" className="text-accent shrink-0">
                            Preencher <ArrowRight className="w-4 h-4 ml-1" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>

          {allCompleted && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="mt-8 text-center"
            >
              <Card className="bg-accent/10 border-accent/30">
                <CardContent className="p-6">
                  <Check className="w-12 h-12 mx-auto text-accent mb-3" />
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    Onboarding Completo!
                  </h3>
                  <p className="text-muted-foreground">
                    Obrigado por preencher todas as informações. Nossa equipe entrará em contato em breve para finalizar a configuração do seu atendimento.
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Footer info */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
            className="mt-8 text-center text-sm text-muted-foreground"
          >
            <p>Dúvidas? Entre em contato através do <span className="text-primary font-medium">grupo do WhatsApp da Pipeelo</span></p>
          </motion.div>
        </motion.div>
      </main>
    </div>
  );
};

export default OnboardingSession;
