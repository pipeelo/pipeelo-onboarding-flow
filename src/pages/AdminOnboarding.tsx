import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Copy, Plus, Building2, ExternalLink, Check, Clock, RefreshCw, Trash2, Loader2, LogOut, Layers, X, ChevronDown, Send, CircleDollarSign, FileText, Download } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { PipeeloLogo } from '@/components/PipeeloLogo';
import { AdminLogin } from '@/components/AdminLogin';
import {
  adminSessionApi,
  ApiError,
  ERP_OPTIONS,
  MAPAS_OPTIONS,
  REDE_OPTIONS,
  GATEWAY_OPTIONS,
  type SessionDTO,
} from '@/lib/api-client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type OnboardingTipo = 'completo' | 'comercial';

const TIPO_LABEL: Record<OnboardingTipo, string> = {
  completo: 'Onboarding Completo',
  comercial: 'Apenas CRM (Vendas)',
};

type OnboardingSession = SessionDTO;

type StackPatch = {
  erp?: string | null;
  mapas?: string | null;
  gerenciamento_rede?: string | null;
  gateway_pagamento?: string | null;
};

type ComercialPatch = {
  valor_sessao?: number | null;
  qtd_sessoes?: number | null;
  valor_mensal?: number | null;
  dia_vencimento?: number | null;
  observacoes?: string | null;
  valor_implantacao?: number | null;
  implantacao_vencimento?: string | null;
  primeira_mensalidade_em?: string | null;
};

const DIAS_VENCIMENTO = Array.from({ length: 31 }, (_, i) => String(i + 1));

/** Aceita "0,65", "6.500,00" e "6500.00" — retorna null se vazio/inválido. */
function parseMoney(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function parseIntPositivo(raw: string): number | null {
  const n = Number(raw.trim().replace(/\./g, ''));
  return Number.isInteger(n) && n > 0 ? n : null;
}

function formatBRL(v: number | string | null | undefined): string | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** number/string do banco → valor de input pt-BR ("0.65" → "0,65"). */
function numToInput(v: number | string | null | undefined): string {
  if (v == null || v === '') return '';
  return String(v).replace('.', ',');
}

/** "YYYY-MM-DD" → "DD/MM" — sem passar por Date (evita fuso deslocando o dia). */
function formatDateBR(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  return m ? `${m[3]}/${m[2]}` : null;
}

const STACK_FIELDS: Array<{
  key: 'erp' | 'mapas' | 'gerenciamento_rede' | 'gateway_pagamento';
  label: string;
  chip: string;
  options: readonly string[];
}> = [
  { key: 'erp', label: 'ERP', chip: 'ERP', options: ERP_OPTIONS },
  { key: 'mapas', label: 'Mapas', chip: 'Mapas', options: MAPAS_OPTIONS },
  { key: 'gerenciamento_rede', label: 'Gerenciamento de Rede', chip: 'Rede', options: REDE_OPTIONS },
  { key: 'gateway_pagamento', label: 'Gateway de Pagamentos', chip: 'Gateway', options: GATEWAY_OPTIONS },
];

function StackEditor({
  session,
  onSave,
}: {
  session: OnboardingSession;
  onSave: (sessionId: string, patch: StackPatch) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [erp, setErp] = useState<string>(session.erp ?? '');
  const [mapas, setMapas] = useState<string>(session.mapas ?? '');
  const [rede, setRede] = useState<string>(session.gerenciamento_rede ?? '');
  const [gateway, setGateway] = useState<string>(session.gateway_pagamento ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setErp(session.erp ?? '');
      setMapas(session.mapas ?? '');
      setRede(session.gerenciamento_rede ?? '');
      setGateway(session.gateway_pagamento ?? '');
    }
  }, [open, session.erp, session.mapas, session.gerenciamento_rede, session.gateway_pagamento]);

  const hasStack = Boolean(
    session.erp || session.mapas || session.gerenciamento_rede || session.gateway_pagamento
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(session.id, {
        erp: erp || null,
        mapas: mapas || null,
        gerenciamento_rede: rede || null,
        gateway_pagamento: gateway || null,
      });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const chips = [
    session.erp ? { label: 'ERP', value: session.erp } : null,
    session.mapas ? { label: 'Mapas', value: session.mapas } : null,
    session.gerenciamento_rede ? { label: 'Rede', value: session.gerenciamento_rede } : null,
    session.gateway_pagamento ? { label: 'Gateway', value: session.gateway_pagamento } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {hasStack ? (
          <button
            type="button"
            className="group flex flex-wrap gap-1.5 mt-2 cursor-pointer"
            aria-label="Editar stack"
          >
            {chips.map((c) => (
              <span
                key={c.label}
                className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-muted/50 text-muted-foreground border border-border/40 group-hover:border-primary/40 group-hover:text-foreground transition-colors"
              >
                <span className="text-muted-foreground/60 mr-1">{c.label}</span>
                {c.value}
              </span>
            ))}
          </button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 mt-2 -ml-2 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <Layers className="w-3 h-3 mr-1" />
            Adicionar stack
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4 space-y-3" align="start">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
            Stack Tecnológica
          </p>
          {(erp || mapas || rede || gateway) && (
            <button
              type="button"
              onClick={() => {
                setErp('');
                setMapas('');
                setRede('');
                setGateway('');
              }}
              className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Limpar
            </button>
          )}
        </div>
        {STACK_FIELDS.map((f) => {
          const value =
            f.key === 'erp' ? erp
            : f.key === 'mapas' ? mapas
            : f.key === 'gerenciamento_rede' ? rede
            : gateway;
          const setValue =
            f.key === 'erp' ? setErp
            : f.key === 'mapas' ? setMapas
            : f.key === 'gerenciamento_rede' ? setRede
            : setGateway;
          return (
            <div key={f.key} className="space-y-1">
              <label className="text-xs text-muted-foreground">{f.label}</label>
              <div className="flex items-center gap-1">
                <Select value={value} onValueChange={setValue}>
                  <SelectTrigger className="h-9 flex-1">
                    <SelectValue placeholder={`Selecionar ${f.label.toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {f.options.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {value && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 w-9 p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => setValue('')}
                    aria-label={`Limpar ${f.label}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        <div className="flex justify-end gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Salvar'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ComercialEditor({
  session,
  onSave,
}: {
  session: OnboardingSession;
  onSave: (sessionId: string, patch: ComercialPatch) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [valorSessao, setValorSessao] = useState('');
  const [qtdSessoes, setQtdSessoes] = useState('');
  const [valorMensal, setValorMensal] = useState('');
  const [diaVencimento, setDiaVencimento] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [valorImplantacao, setValorImplantacao] = useState('');
  const [implantacaoVencimento, setImplantacaoVencimento] = useState('');
  const [primeiraMensalidadeEm, setPrimeiraMensalidadeEm] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValorSessao(numToInput(session.valor_sessao));
      setQtdSessoes(session.qtd_sessoes != null ? String(session.qtd_sessoes) : '');
      setValorMensal(numToInput(session.valor_mensal));
      setDiaVencimento(session.dia_vencimento != null ? String(session.dia_vencimento) : '');
      setObservacoes(session.observacoes ?? '');
      setValorImplantacao(numToInput(session.valor_implantacao));
      setImplantacaoVencimento(session.implantacao_vencimento ?? '');
      setPrimeiraMensalidadeEm(session.primeira_mensalidade_em ?? '');
    }
  }, [
    open,
    session.valor_sessao,
    session.qtd_sessoes,
    session.valor_mensal,
    session.dia_vencimento,
    session.observacoes,
    session.valor_implantacao,
    session.implantacao_vencimento,
    session.primeira_mensalidade_em,
  ]);

  const hasComercial =
    session.valor_sessao != null ||
    session.qtd_sessoes != null ||
    session.valor_mensal != null ||
    session.dia_vencimento != null ||
    Boolean(session.observacoes) ||
    session.valor_implantacao != null ||
    Boolean(session.implantacao_vencimento) ||
    Boolean(session.primeira_mensalidade_em);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(session.id, {
        valor_sessao: parseMoney(valorSessao),
        qtd_sessoes: parseIntPositivo(qtdSessoes),
        valor_mensal: parseMoney(valorMensal),
        dia_vencimento: diaVencimento ? Number(diaVencimento) : null,
        observacoes: observacoes.trim() || null,
        valor_implantacao: parseMoney(valorImplantacao),
        implantacao_vencimento: implantacaoVencimento || null,
        primeira_mensalidade_em: primeiraMensalidadeEm || null,
      });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const chips = [
    session.valor_sessao != null
      ? { label: 'Sessão', value: formatBRL(session.valor_sessao) ?? '' }
      : null,
    session.qtd_sessoes != null
      ? { label: 'Sessões', value: Number(session.qtd_sessoes).toLocaleString('pt-BR') }
      : null,
    session.valor_mensal != null
      ? { label: 'Mensal', value: formatBRL(session.valor_mensal) ?? '' }
      : null,
    session.dia_vencimento != null
      ? { label: 'Venc.', value: `dia ${session.dia_vencimento}` }
      : null,
    session.valor_implantacao != null
      ? {
          label: 'Implantação',
          value: `${formatBRL(session.valor_implantacao) ?? ''}${
            session.implantacao_vencimento
              ? ` · venc ${formatDateBR(session.implantacao_vencimento)}`
              : ''
          }`,
        }
      : null,
    session.primeira_mensalidade_em
      ? { label: '1ª mensalidade', value: formatDateBR(session.primeira_mensalidade_em) ?? '' }
      : null,
    session.observacoes
      ? {
          label: 'Obs',
          value:
            session.observacoes.length > 40
              ? `${session.observacoes.slice(0, 40)}…`
              : session.observacoes,
        }
      : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {hasComercial ? (
          <button
            type="button"
            className="group flex flex-wrap gap-1.5 mt-1.5 cursor-pointer"
            aria-label="Editar dados comerciais"
          >
            {chips.map((c) => (
              <span
                key={c.label}
                className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-primary/5 text-muted-foreground border border-primary/20 group-hover:border-primary/50 group-hover:text-foreground transition-colors"
              >
                <span className="text-muted-foreground/60 mr-1">{c.label}</span>
                {c.value}
              </span>
            ))}
          </button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 mt-1.5 -ml-2 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <CircleDollarSign className="w-3 h-3 mr-1" />
            Adicionar dados comerciais
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4 space-y-3" align="start">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          Dados Comerciais
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Valor da sessão (R$)</label>
            <Input
              inputMode="decimal"
              placeholder="0,65"
              value={valorSessao}
              onChange={(e) => setValorSessao(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Qtd. de sessões</label>
            <Input
              inputMode="numeric"
              placeholder="10000"
              value={qtdSessoes}
              onChange={(e) => setQtdSessoes(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Valor mensal (R$)</label>
            <Input
              inputMode="decimal"
              placeholder="6.500,00"
              value={valorMensal}
              onChange={(e) => setValorMensal(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Dia de vencimento</label>
            <Select value={diaVencimento} onValueChange={setDiaVencimento}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Dia" />
              </SelectTrigger>
              <SelectContent>
                {DIAS_VENCIMENTO.map((d) => (
                  <SelectItem key={d} value={d}>
                    Dia {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Valor da implantação (R$)</label>
            <Input
              inputMode="decimal"
              placeholder="1.500,00"
              value={valorImplantacao}
              onChange={(e) => setValorImplantacao(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Venc. da implantação</label>
            <Input
              type="date"
              value={implantacaoVencimento}
              onChange={(e) => setImplantacaoVencimento(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1 col-span-2">
            <label className="text-xs text-muted-foreground">Data da 1ª mensalidade</label>
            <Input
              type="date"
              value={primeiraMensalidadeEm}
              onChange={(e) => setPrimeiraMensalidadeEm(e.target.value)}
              className="h-9"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Observações</label>
          <Textarea
            placeholder="Condições do deal, cortesias, etc."
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            className="min-h-[64px] text-sm"
            maxLength={4000}
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Salvar'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const AdminOnboarding = () => {
  const [empresaNome, setEmpresaNome] = useState('');
  const [ceoEmail, setCeoEmail] = useState('');
  const [erp, setErp] = useState<string>('');
  const [mapas, setMapas] = useState<string>('');
  const [rede, setRede] = useState<string>('');
  const [gateway, setGateway] = useState<string>('');
  const [tipo, setTipo] = useState<OnboardingTipo>('completo');
  const [contratouCrm, setContratouCrm] = useState(false);
  const [valorSessao, setValorSessao] = useState('');
  const [qtdSessoes, setQtdSessoes] = useState('');
  const [valorMensal, setValorMensal] = useState('');
  // Enquanto o admin não editar o mensal manualmente, sugere sessão × qtd
  const [valorMensalEditado, setValorMensalEditado] = useState(false);
  const [diaVencimento, setDiaVencimento] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [sessions, setSessions] = useState<OnboardingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  /**
   * Recupera o JWT atual do Supabase Auth para enviar nas requests `/api/admin/*`.
   * Continua usando supabase-js (auth client only — não toca onboarding_*).
   */
  const getAuthToken = useCallback(async (): Promise<string | null> => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const fetchSessions = useCallback(
    async (showRefresh = false) => {
      if (showRefresh) setRefreshing(true);
      try {
        const token = await getAuthToken();
        if (!token) {
          toast.error('Sessão expirada — faça login novamente');
          setIsAuthenticated(false);
          return;
        }
        const { sessions: rows } = await adminSessionApi.list(token);
        setSessions(rows);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          toast.error('Sessão expirada — faça login novamente');
          setIsAuthenticated(false);
        } else {
          // eslint-disable-next-line no-console
          console.error('Erro ao buscar sessões:', e);
          toast.error('Erro ao carregar sessões');
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [getAuthToken]
  );

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session);
      if (session) {
        fetchSessions();
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session);
      if (session) {
        fetchSessions();
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchSessions]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsAuthenticated(false);
    toast.success('Logout realizado');
  };

  const valorSessaoNum = parseMoney(valorSessao);
  const qtdSessoesNum = parseIntPositivo(qtdSessoes);
  const valorMensalSugerido =
    valorSessaoNum != null && qtdSessoesNum != null
      ? (Math.round(valorSessaoNum * qtdSessoesNum * 100) / 100).toFixed(2).replace('.', ',')
      : '';

  const createSession = async () => {
    if (!empresaNome.trim()) {
      toast.error('Digite o nome da empresa');
      return;
    }

    setCreating(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        toast.error('Sessão expirada — faça login novamente');
        setIsAuthenticated(false);
        return;
      }
      const mensalEfetivo = valorMensalEditado ? valorMensal : valorMensalSugerido;
      await adminSessionApi.create(token, {
        empresa_nome: empresaNome.trim(),
        ceo_email: ceoEmail.trim() || undefined,
        erp: erp || undefined,
        mapas: mapas || undefined,
        gerenciamento_rede: rede || undefined,
        gateway_pagamento: gateway || undefined,
        modo: tipo,
        contratou_crm: tipo === 'comercial' ? true : contratouCrm,
        valor_sessao: parseMoney(valorSessao) ?? undefined,
        qtd_sessoes: parseIntPositivo(qtdSessoes) ?? undefined,
        valor_mensal: parseMoney(mensalEfetivo) ?? undefined,
        dia_vencimento: diaVencimento ? Number(diaVencimento) : undefined,
        observacoes: observacoes.trim() || undefined,
      });
      toast.success(`Link ${TIPO_LABEL[tipo]} criado com sucesso!`);
      setEmpresaNome('');
      setCeoEmail('');
      setErp('');
      setMapas('');
      setRede('');
      setGateway('');
      setTipo('completo');
      setContratouCrm(false);
      setValorSessao('');
      setQtdSessoes('');
      setValorMensal('');
      setValorMensalEditado(false);
      setDiaVencimento('');
      setObservacoes('');
      fetchSessions();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Erro ao criar sessão:', e);
      const msg = e instanceof ApiError ? e.message : 'Erro ao criar link';
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  };

  const updateSessionStack = async (
    sessionId: string,
    patch: StackPatch & ComercialPatch
  ) => {
    const token = await getAuthToken();
    if (!token) {
      toast.error('Sessão expirada — faça login novamente');
      setIsAuthenticated(false);
      return;
    }
    try {
      const { session } = await adminSessionApi.update(token, sessionId, patch);
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, ...session } : s)));
      toast.success('Dados atualizados');
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erro ao atualizar dados';
      toast.error(msg);
    }
  };

  const deleteSession = async (sessionId: string) => {
    setDeleting(sessionId);
    try {
      const token = await getAuthToken();
      if (!token) {
        toast.error('Sessão expirada — faça login novamente');
        setIsAuthenticated(false);
        return;
      }
      await adminSessionApi.delete(token, sessionId);
      toast.success('Sessão apagada com sucesso!');
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Erro ao deletar sessão:', e);
      const msg = e instanceof ApiError ? e.message : 'Erro ao apagar sessão';
      toast.error(msg);
    } finally {
      setDeleting(null);
    }
  };

  // Cache local de shortlinks já gerados pra evitar chamada repetida
  const [shortLinkCache, setShortLinkCache] = useState<Record<string, string>>({});

  const getOnboardingUrl = (session: OnboardingSession, tipo: OnboardingTipo = 'completo') => {
    const accessToken = (session as { access_token?: string }).access_token;
    const path = tipo === 'comercial' ? `comercial/${session.slug}` : session.slug;
    const base = `https://onboarding.pipeelo.com/${path}`;
    return accessToken ? `${base}?token=${accessToken}` : base;
  };

  const getCadastroUrl = (session: OnboardingSession) => {
    const accessToken = (session as { access_token?: string }).access_token;
    const base = `https://onboarding.pipeelo.com/cadastro/${session.slug}`;
    return accessToken ? `${base}?token=${accessToken}` : base;
  };
  const copyCadastroLink = async (session: OnboardingSession) => {
    await navigator.clipboard.writeText(getCadastroUrl(session));
    toast.success('Link de cadastro copiado');
  };

  const resolveShortLink = async (
    session: OnboardingSession,
    tipo: OnboardingTipo
  ): Promise<string> => {
    const cacheKey = `${session.id}:${tipo}`;
    if (shortLinkCache[cacheKey]) return shortLinkCache[cacheKey];

    const targetUrl = getOnboardingUrl(session, tipo);
    try {
      const authToken = await getAuthToken();
      if (!authToken) {
        toast.error('Sessão expirada — faça login novamente');
        setIsAuthenticated(false);
        return targetUrl;
      }
      const { short_url } = await adminSessionApi.createShortLink(authToken, {
        session_id: session.id,
        modo: tipo,
        target_url: targetUrl,
      });
      setShortLinkCache((prev) => ({ ...prev, [cacheKey]: short_url }));
      return short_url;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Erro ao gerar shortlink, caindo no link completo:', e);
      return targetUrl;
    }
  };

  const copyLink = async (session: OnboardingSession, tipo: OnboardingTipo = 'completo') => {
    const url = await resolveShortLink(session, tipo);
    await navigator.clipboard.writeText(url);
    toast.success(`Link copiado — ${TIPO_LABEL[tipo]}`);
  };

  const openLink = async (session: OnboardingSession, tipo: OnboardingTipo = 'completo') => {
    const url = await resolveShortLink(session, tipo);
    window.open(url, '_blank');
  };

  const [sendingWelcome, setSendingWelcome] = useState<string | null>(null);

  const sendWelcomeWhatsApp = async (
    session: OnboardingSession,
    tipo: OnboardingTipo
  ) => {
    const key = `${session.id}:${tipo}`;
    setSendingWelcome(key);
    try {
      const authToken = await getAuthToken();
      if (!authToken) {
        toast.error('Sessão expirada — faça login novamente');
        setIsAuthenticated(false);
        return;
      }
      const result = await adminSessionApi.sendWelcomeWhatsApp(authToken, {
        session_id: session.id,
        modo: tipo,
      });
      toast.success(
        `Boas-vindas enviadas pro grupo "${result.group.name}" (${TIPO_LABEL[tipo]})`
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Erro ao enviar boas-vindas WhatsApp:', e);
      if (e instanceof ApiError) {
        if (e.code === 'group_not_found' || e.message?.includes('grupo')) {
          toast.error(
            `Grupo WhatsApp "${session.empresa_nome}" não encontrado. Confirme que o nome do grupo é idêntico ao nome da empresa.`
          );
        } else if (e.message?.includes('evolution')) {
          toast.error('Erro na Evolution API — verifique a config (env vars).');
        } else {
          toast.error(e.message || 'Erro ao enviar mensagem');
        }
      } else {
        toast.error('Erro ao enviar mensagem');
      }
    } finally {
      setSendingWelcome(null);
    }
  };

  const [recriando, setRecriando] = useState<string | null>(null);
  const recriarGrupo = async (session: OnboardingSession) => {
    setRecriando(session.id);
    try {
      const authToken = await getAuthToken();
      if (!authToken) { toast.error('Sessão expirada — faça login novamente'); setIsAuthenticated(false); return; }
      const { grupo } = await adminSessionApi.recriarGrupo(authToken, session.id);
      if (grupo.status === 'criado') toast.success(`Grupo criado: ${grupo.jid}`);
      else toast.error(`Grupo falhou: ${grupo.motivo}`);
      await fetchSessions();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erro ao recriar grupo');
    } finally {
      setRecriando(null);
    }
  };

  const [gerandoContrato, setGerandoContrato] = useState<string | null>(null);
  const gerarContrato = async (session: OnboardingSession) => {
    setGerandoContrato(session.id);
    try {
      const authToken = await getAuthToken();
      if (!authToken) { toast.error('Sessão expirada — faça login novamente'); setIsAuthenticated(false); return; }
      const { contrato } = await adminSessionApi.gerarContrato(authToken, session.id);
      if (contrato.status === 'gerado') toast.success(`Contrato gerado — assina ${contrato.representante}`);
      else toast.error(`Contrato pendente: ${contrato.motivo}`);
      await fetchSessions();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erro ao gerar contrato');
    } finally {
      setGerandoContrato(null);
    }
  };

  const [cobrandoCa, setCobrandoCa] = useState<string | null>(null);
  const cobrarContaAzul = async (session: OnboardingSession) => {
    setCobrandoCa(session.id);
    try {
      const authToken = await getAuthToken();
      if (!authToken) { toast.error('Sessão expirada — faça login novamente'); setIsAuthenticated(false); return; }
      const { cobranca } = await adminSessionApi.cobrarContaAzul(authToken, session.id);
      if (cobranca.status === 'cobrado') toast.success('Cobranças criadas no Conta Azul');
      else toast.error(`Cobrança pendente: ${cobranca.motivo}`);
      await fetchSessions();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erro ao cobrar no Conta Azul');
    } finally {
      setCobrandoCa(null);
    }
  };

  const [baixandoContrato, setBaixandoContrato] = useState<string | null>(null);
  const baixarContrato = async (session: OnboardingSession) => {
    setBaixandoContrato(session.id);
    try {
      const authToken = await getAuthToken();
      if (!authToken) { toast.error('Sessão expirada — faça login novamente'); setIsAuthenticated(false); return; }
      const { url } = await adminSessionApi.contratoDownloadUrl(authToken, session.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erro ao baixar contrato');
    } finally {
      setBaixandoContrato(null);
    }
  };

  const getStatusBadge = (status: string | null, label: string) => {
    if (status === 'concluido') {
      return <Badge className="bg-green-500/20 text-green-500 border-green-500/30"><Check className="w-3 h-3 mr-1" />{label}</Badge>;
    }
    return <Badge className="bg-red-500/20 text-red-500 border-red-500/30"><Clock className="w-3 h-3 mr-1" />{label}</Badge>;
  };

  const isComercialSession = (session: OnboardingSession) =>
    session.modo === 'comercial';

  const getTotalDeptosCount = (session: OnboardingSession) =>
    isComercialSession(session) ? 1 : 4;

  const getCompletedCount = (session: OnboardingSession) => {
    if (isComercialSession(session)) {
      return session.status_vendas === 'concluido' ? 1 : 0;
    }
    let count = 0;
    if (session.status_sac_geral === 'concluido') count++;
    if (session.status_financeiro === 'concluido') count++;
    if (session.status_suporte === 'concluido') count++;
    if (session.status_vendas === 'concluido') count++;
    return count;
  };

  const getLastCompletedDate = (session: OnboardingSession): string | null => {
    const dates = [
      session.concluido_sac_geral_at,
      session.concluido_financeiro_at,
      session.concluido_suporte_at,
      session.concluido_vendas_at,
    ].filter(Boolean) as string[];

    if (dates.length === 0) return null;

    const sorted = dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    return sorted[0];
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const isAllCompleted = (session: OnboardingSession) => {
    return getCompletedCount(session) === getTotalDeptosCount(session);
  };

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AdminLogin onSuccess={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40 bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <PipeeloLogo className="h-8" />
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold text-foreground">Gerador de Links</h1>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-2" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 max-w-4xl">
        {/* Create new session */}
        <Card className="mb-8 border-primary/20 bg-card/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" />
              Criar Novo Link de Onboarding
            </CardTitle>
            <CardDescription>
              Gere um link único para uma empresa iniciar o onboarding
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-2 block">
                Tipo de Onboarding *
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTipo('completo')}
                  className={`text-left rounded-md border px-3 py-2.5 transition-colors ${
                    tipo === 'completo'
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-card hover:bg-card/70 text-muted-foreground'
                  }`}
                >
                  <div className="text-sm font-medium">Onboarding Completo</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    IA + CRM — todos departamentos (4 formulários)
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setTipo('comercial')}
                  className={`text-left rounded-md border px-3 py-2.5 transition-colors ${
                    tipo === 'comercial'
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-card hover:bg-card/70 text-muted-foreground'
                  }`}
                >
                  <div className="text-sm font-medium">Apenas CRM (Vendas)</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Só Identificação + Vendas (2 formulários)
                  </div>
                </button>
              </div>
              {tipo === 'completo' && (
                <label className="mt-2 flex items-center gap-2 cursor-pointer select-none rounded-md border border-border bg-card px-3 py-2.5 hover:bg-card/70 transition-colors">
                  <input
                    type="checkbox"
                    checked={contratouCrm}
                    onChange={(e) => setContratouCrm(e.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="text-sm font-medium">Cliente contratou o CRM</span>
                  <span className="text-[11px] text-muted-foreground">
                    · vai junto no payload final pro admin
                  </span>
                </label>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">
                  Nome da Empresa *
                </label>
                <Input
                  placeholder="Ex: Empresa XYZ"
                  value={empresaNome}
                  onChange={(e) => setEmpresaNome(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createSession()}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">
                  E-mail do CEO (opcional)
                </label>
                <Input
                  type="email"
                  placeholder="ceo@empresa.com"
                  value={ceoEmail}
                  onChange={(e) => setCeoEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createSession()}
                />
              </div>
            </div>
            <div className="space-y-2 pt-1">
              <div className="flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-muted-foreground/70" />
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-medium">
                  Stack Tecnológica
                  <span className="ml-1 normal-case tracking-normal text-muted-foreground/50">
                    · opcional
                  </span>
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Select value={erp} onValueChange={setErp}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="ERP" />
                  </SelectTrigger>
                  <SelectContent>
                    {ERP_OPTIONS.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={mapas} onValueChange={setMapas}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Mapas" />
                  </SelectTrigger>
                  <SelectContent>
                    {MAPAS_OPTIONS.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={rede} onValueChange={setRede}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Gerenciamento de Rede" />
                  </SelectTrigger>
                  <SelectContent>
                    {REDE_OPTIONS.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={gateway} onValueChange={setGateway}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Gateway de Pagamentos" />
                  </SelectTrigger>
                  <SelectContent>
                    {GATEWAY_OPTIONS.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2 pt-1">
              <div className="flex items-center gap-2">
                <CircleDollarSign className="w-3.5 h-3.5 text-muted-foreground/70" />
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-medium">
                  Dados Comerciais
                  <span className="ml-1 normal-case tracking-normal text-muted-foreground/50">
                    · opcional — vão no payload final
                  </span>
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Valor da sessão (R$)
                  </label>
                  <Input
                    inputMode="decimal"
                    placeholder="0,65"
                    value={valorSessao}
                    onChange={(e) => setValorSessao(e.target.value)}
                    className="h-10"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Qtd. de sessões
                  </label>
                  <Input
                    inputMode="numeric"
                    placeholder="10000"
                    value={qtdSessoes}
                    onChange={(e) => setQtdSessoes(e.target.value)}
                    className="h-10"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Valor mensal (R$)
                  </label>
                  <Input
                    inputMode="decimal"
                    placeholder={valorMensalSugerido || '6.500,00'}
                    value={valorMensalEditado ? valorMensal : valorMensalSugerido}
                    onChange={(e) => {
                      setValorMensal(e.target.value);
                      setValorMensalEditado(e.target.value !== '');
                    }}
                    className="h-10"
                  />
                  {!valorMensalEditado && valorMensalSugerido && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Sugerido: sessão × quantidade — edite pra sobrescrever
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Dia de vencimento
                  </label>
                  <Select value={diaVencimento} onValueChange={setDiaVencimento}>
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Dia" />
                    </SelectTrigger>
                    <SelectContent>
                      {DIAS_VENCIMENTO.map((d) => (
                        <SelectItem key={d} value={d}>
                          Dia {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Observações</label>
                <Textarea
                  placeholder="Condições do deal, cortesias, contexto comercial..."
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                  className="min-h-[64px] text-sm"
                  maxLength={4000}
                />
              </div>
            </div>
            <Button
              onClick={createSession}
              disabled={creating || !empresaNome.trim()}
              className="w-full sm:w-auto"
            >
              {creating ? 'Criando...' : 'Gerar Link'}
            </Button>
          </CardContent>
        </Card>

        {/* Sessions list */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-foreground">Links Criados</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchSessions(true)}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Atualizar
          </Button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Carregando...
          </div>
        ) : sessions.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <Building2 className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">Nenhum link criado ainda</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {sessions.map((session) => {
              const lastCompleted = getLastCompletedDate(session);
              const allCompleted = isAllCompleted(session);

              return (
                <Card key={session.id} className="bg-card/50 hover:bg-card/80 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex flex-col gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <Building2 className="w-4 h-4 text-primary" />
                          <span className="font-semibold text-foreground">{session.empresa_nome}</span>
                          <Badge variant="outline" className="text-xs">
                            {getCompletedCount(session)}/{getTotalDeptosCount(session)}
                          </Badge>
                          {isComercialSession(session) && (
                            <Badge className="text-xs bg-blue-500/20 text-blue-400 border-blue-500/30">
                              Apenas CRM
                            </Badge>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2 mb-3">
                          {!isComercialSession(session) && (
                            <>
                              {getStatusBadge(session.status_sac_geral, 'SAC/Geral')}
                              {getStatusBadge(session.status_financeiro, 'Financeiro')}
                              {getStatusBadge(session.status_suporte, 'Suporte')}
                            </>
                          )}
                          {getStatusBadge(session.status_vendas, 'Vendas')}
                          {session.cadastro_enviado_at ? (
                            session.grupo_jid ? (
                              <Badge className="text-xs bg-green-500/20 text-green-400 border-green-500/30">Cadastro + grupo OK</Badge>
                            ) : (
                              <Badge className="text-xs bg-red-500/20 text-red-400 border-red-500/30">Grupo com erro</Badge>
                            )
                          ) : (
                            <Badge variant="outline" className="text-xs">Cadastro pendente</Badge>
                          )}
                          {session.cadastro_enviado_at && (
                            <>
                              {session.contrato_path ? (
                                <Badge className="text-xs bg-green-500/20 text-green-400 border-green-500/30">Contrato gerado</Badge>
                              ) : (
                                <Badge className="text-xs bg-amber-500/20 text-amber-400 border-amber-500/30">
                                  Contrato pendente{session.contrato_erro ? `: ${session.contrato_erro}` : ''}
                                </Badge>
                              )}
                              {session.ca_cobrado_at ? (
                                <Badge className="text-xs bg-green-500/20 text-green-400 border-green-500/30">Cobrança OK</Badge>
                              ) : (
                                <Badge className="text-xs bg-amber-500/20 text-amber-400 border-amber-500/30">
                                  Cobrança pendente{session.ca_erro ? `: ${session.ca_erro}` : ''}
                                </Badge>
                              )}
                            </>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {session.created_at && (
                            <span>Criado em {formatDate(session.created_at)}</span>
                          )}
                          {allCompleted && lastCompleted && (
                            <>
                              <span>•</span>
                              <span className="text-green-400">Concluído em {formatDate(lastCompleted)}</span>
                            </>
                          )}
                          {session.ceo_email && (
                            <>
                              <span>•</span>
                              <span>{session.ceo_email}</span>
                            </>
                          )}
                        </div>

                        <StackEditor session={session} onSave={updateSessionStack} />
                        <ComercialEditor session={session} onSave={updateSessionStack} />
                      </div>

                      <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
                        {(() => {
                          const sessionTipo: OnboardingTipo =
                            session.modo === 'comercial' ? 'comercial' : 'completo';
                          return (
                            <>
                              <Button variant="outline" size="sm" onClick={() => copyCadastroLink(session)}>
                                <Copy className="w-4 h-4 mr-2" />
                                Link de cadastro
                              </Button>
                              {session.cadastro_enviado_at && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={recriando === session.id}
                                  onClick={() => recriarGrupo(session)}
                                  title={session.grupo_jid ? 'Reaproveita o grupo: adiciona quem falta, promove o admin, sem repetir a boas-vindas' : 'Tenta criar o grupo de novo com o cadastro salvo'}
                                >
                                  {recriando === session.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                                  {session.grupo_jid ? 'Reprocessar grupo' : 'Recriar grupo'}
                                </Button>
                              )}
                              {session.cadastro_enviado_at && session.contrato_path && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={baixandoContrato === session.id}
                                  onClick={() => baixarContrato(session)}
                                  title="Abre o .docx do contrato com link temporário (60 min)"
                                >
                                  {baixandoContrato === session.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                                  Baixar contrato
                                </Button>
                              )}
                              {session.cadastro_enviado_at && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={gerandoContrato === session.id}
                                  onClick={() => gerarContrato(session)}
                                  title="Lê os documentos de novo e regera o .docx do contrato"
                                >
                                  {gerandoContrato === session.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
                                  Gerar contrato
                                </Button>
                              )}
                              {session.cadastro_enviado_at && !session.ca_cobrado_at && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={cobrandoCa === session.id}
                                  onClick={() => cobrarContaAzul(session)}
                                  title="Cria o cliente e as cobranças de implantação e 1ª mensalidade no Conta Azul"
                                >
                                  {cobrandoCa === session.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CircleDollarSign className="w-4 h-4 mr-2" />}
                                  Cobrar no Conta Azul
                                </Button>
                              )}
                              {session.ca_implantacao_url && (
                                <Button variant="outline" size="sm" asChild>
                                  <a href={session.ca_implantacao_url} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="w-4 h-4 mr-2" />
                                    Boleto implantação
                                  </a>
                                </Button>
                              )}
                              {session.ca_mensalidade_url && (
                                <Button variant="outline" size="sm" asChild>
                                  <a href={session.ca_mensalidade_url} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="w-4 h-4 mr-2" />
                                    Boleto 1ª mensalidade
                                  </a>
                                </Button>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => copyLink(session, sessionTipo)}
                              >
                                <Copy className="w-4 h-4 mr-2" />
                                Copiar Link
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => sendWelcomeWhatsApp(session, sessionTipo)}
                                disabled={sendingWelcome?.startsWith(session.id) ?? false}
                                className="bg-green-500/10 hover:bg-green-500/20 border-green-500/30 text-green-600 dark:text-green-400"
                              >
                                {sendingWelcome?.startsWith(session.id) ? (
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                ) : (
                                  <Send className="w-4 h-4 mr-2" />
                                )}
                                Enviar WhatsApp
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label="Abrir link"
                                onClick={() => openLink(session, sessionTipo)}
                              >
                                <ExternalLink className="w-4 h-4" />
                              </Button>
                            </>
                          );
                        })()}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              disabled={deleting === session.id}
                            >
                              {deleting === session.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Apagar sessão?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Tem certeza que deseja apagar a sessão de <strong>{session.empresa_nome}</strong>?
                                Esta ação não pode ser desfeita e todas as respostas serão perdidas.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteSession(session.id)}
                                className="bg-destructive hover:bg-destructive/90"
                              >
                                Apagar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Footer with WhatsApp contact */}
        <div className="mt-12 text-center text-sm text-muted-foreground">
          <p>
            Dúvidas? Entre em contato através do{' '}
            <span className="text-primary font-medium">grupo do WhatsApp da Pipeelo</span>
          </p>
        </div>
      </main>
    </div>
  );
};

export default AdminOnboarding;
