import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { PipeeloLogo } from '@/components/PipeeloLogo';
import { UploadMultiplo, type UploadMeta } from '@/components/cadastro/UploadMultiplo';
import { sessionApi, ApiError, type ResultadoGrupoDTO, type SessionDTO } from '@/lib/api-client';
import { cleanCnpj, formatCnpj, validateCnpj } from '@/lib/cnpj';
import { isPhoneBrValid, maskPhone } from '@/lib/phone';

type Contato = { nome: string; whatsapp: string };
type Form = {
  cnpj: string; razao_social: string; nome_fantasia: string; inscricao_estadual: string;
  cobranca_email: string; cobranca_telefone: string; dia_vencimento: string; contrato_email: string;
  doc_contrato_social: UploadMeta[]; doc_responsaveis: UploadMeta[];
  responsavel_nome: string; responsavel_cargo: string; responsavel_email: string; responsavel_whatsapp: string;
  contatos_extras: Contato[]; aceite_dados: boolean;
};

const VAZIO: Form = {
  cnpj: '', razao_social: '', nome_fantasia: '', inscricao_estadual: '',
  cobranca_email: '', cobranca_telefone: '', dia_vencimento: '', contrato_email: '',
  doc_contrato_social: [], doc_responsaveis: [],
  responsavel_nome: '', responsavel_cargo: '', responsavel_email: '', responsavel_whatsapp: '',
  contatos_extras: [], aceite_dados: false,
};

const PASSOS = ['Dados da empresa', 'Cobrança', 'Contrato', 'Documentos', 'Responsável'] as const;
const DIAS = ['5', '10', '15', '20', '25'];
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

function storageKey(slug: string) { return `cadastro:${slug}`; }

export default function Cadastro() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [session, setSession] = useState<SessionDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [passo, setPasso] = useState(0);
  const [form, setForm] = useState<Form>(VAZIO);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoGrupoDTO | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);

  // Carrega a sessão; se já enviou, mostra confirmação.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { session: s } = await sessionApi.get(slug, token);
        if (!alive) return;
        setSession(s);
        if (s.cadastro_enviado_at) {
          setResultado(s.grupo_jid
            ? { status: 'criado', jid: s.grupo_jid, invite_url: s.grupo_invite_url ?? null, nao_adicionados: [] }
            : { status: 'erro', motivo: s.grupo_erro ?? 'grupo_nao_criado' });
        } else {
          try {
            const saved = localStorage.getItem(storageKey(slug));
            if (saved) setForm({ ...VAZIO, ...(JSON.parse(saved) as Partial<Form>) });
          } catch { /* sem rascunho */ }
          if (s.dia_vencimento) setForm((f) => ({ ...f, dia_vencimento: f.dia_vencimento || String(s.dia_vencimento) }));
        }
      } catch (e) {
        if (!alive) return;
        setLoadError(e instanceof ApiError && e.status === 401 ? 'Link inválido ou expirado. Peça um novo link ao seu contato na Pipeelo.' : 'Não foi possível carregar o cadastro. Tente de novo em instantes.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [slug, token]);

  // Rascunho local (sem os arquivos, que já estão no servidor pelo path).
  useEffect(() => {
    if (!session || session.cadastro_enviado_at) return;
    try { localStorage.setItem(storageKey(slug), JSON.stringify(form)); } catch { /* quota */ }
  }, [form, session, slug]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Lookup do CNPJ ao completar 14 dígitos.
  const cnpjDigits = cleanCnpj(form.cnpj);
  useEffect(() => {
    if (cnpjDigits.length !== 14 || validateCnpj(cnpjDigits) !== null) return;
    let alive = true;
    setLookupBusy(true);
    sessionApi.cnpjLookup({ slug, token, cnpj: cnpjDigits })
      .then((r) => {
        if (!alive) return;
        setForm((f) => ({
          ...f,
          razao_social: f.razao_social || r.razao_social,
          nome_fantasia: f.nome_fantasia || r.nome_fantasia || r.razao_social,
        }));
      })
      .catch(() => { /* cliente digita à mão */ })
      .finally(() => { if (alive) setLookupBusy(false); });
    return () => { alive = false; };
  }, [cnpjDigits, slug, token]);

  const validarPasso = (): string => {
    switch (passo) {
      case 0:
        if (validateCnpj(form.cnpj) !== null) return 'Informe um CNPJ válido.';
        if (form.razao_social.trim().length < 3) return 'Informe a razão social.';
        if (form.nome_fantasia.trim().length < 2) return 'Informe o nome fantasia.';
        if (form.inscricao_estadual.trim().length < 2) return 'Informe a inscrição estadual (ou "Isento").';
        return '';
      case 1:
        if (!isEmail(form.cobranca_email)) return 'Informe um e-mail de cobrança válido.';
        if (!isPhoneBrValid(form.cobranca_telefone)) return 'Informe o telefone de cobrança com DDD.';
        if (!DIAS.includes(form.dia_vencimento)) return 'Escolha o dia do vencimento.';
        return '';
      case 2:
        return isEmail(form.contrato_email) ? '' : 'Informe um e-mail válido para o contrato.';
      case 3:
        if (!form.doc_contrato_social.length) return 'Anexe o contrato social ou a última alteração.';
        if (!form.doc_responsaveis.length) return 'Anexe o documento com foto dos responsáveis legais.';
        return '';
      case 4:
        if (form.responsavel_nome.trim().length < 3) return 'Informe seu nome completo.';
        if (form.responsavel_cargo.trim().length < 2) return 'Informe seu cargo.';
        if (!isEmail(form.responsavel_email)) return 'Informe um e-mail válido.';
        if (!isPhoneBrValid(form.responsavel_whatsapp)) return 'Informe seu WhatsApp com DDD.';
        for (const c of form.contatos_extras) {
          if (c.nome.trim().length < 2 || !isPhoneBrValid(c.whatsapp)) return 'Preencha nome e WhatsApp de cada contato extra, ou remova o contato.';
        }
        if (!form.aceite_dados) return 'Confirme que os dados e documentos estão corretos.';
        return '';
      default:
        return '';
    }
  };

  const enviar = async () => {
    setEnviando(true);
    try {
      const { grupo } = await sessionApi.cadastroSubmit({
        slug, token,
        cadastro: { ...form, dia_vencimento: Number(form.dia_vencimento) },
      });
      setResultado(grupo);
      try { localStorage.removeItem(storageKey(slug)); } catch { /* ok */ }
    } catch (e) {
      setErro(e instanceof ApiError && e.status === 400 ? 'Algum campo está inválido. Revise os passos anteriores.' : 'Não foi possível enviar. Tente de novo em instantes.');
    } finally {
      setEnviando(false);
    }
  };

  const avancar = () => {
    const e = validarPasso();
    setErro(e);
    if (e) return;
    if (passo < PASSOS.length - 1) setPasso(passo + 1);
    else void enviar();
  };

  const upload = (pergunta_id: 'doc_contrato_social' | 'doc_responsaveis') => async (file: File): Promise<UploadMeta> => {
    const base64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    return sessionApi.uploadArquivo({ slug, token, departamento: 'cadastro', pergunta_id, nome: file.name, content_type: file.type, base64 });
  };

  const progresso = useMemo(() => Math.round(((passo + 1) / PASSOS.length) * 100), [passo]);

  if (loading) return <Shell><Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" /></Shell>;
  if (loadError) return <Shell><Card className="p-6"><p className="text-destructive" role="alert">{loadError}</p></Card></Shell>;

  if (resultado) {
    return (
      <Shell>
        <Card className="p-6 md:p-8 space-y-4">
          <CheckCircle2 className="h-10 w-10 text-primary" />
          <h1 className="text-2xl font-bold">Cadastro recebido</h1>
          {resultado.status === 'criado' ? (
            <>
              <p className="text-muted-foreground">Criamos o grupo <strong>Pipeelo &amp; {form.nome_fantasia || session?.empresa_nome}</strong> no WhatsApp com você como administrador. O link do formulário de onboarding já está lá.</p>
              {resultado.invite_url && (
                <>
                  <p className="text-sm text-muted-foreground">Se o seu WhatsApp não permitiu a adição automática, entre pelo link:</p>
                  <Button asChild><a href={resultado.invite_url} target="_blank" rel="noreferrer"><MessageCircle className="mr-2 h-4 w-4" />Entrar no grupo</a></Button>
                </>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">Seus dados foram salvos. O grupo de WhatsApp será criado pelo time Pipeelo e você receberá o convite em breve.</p>
          )}
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-6">
        <p className="text-sm text-muted-foreground">{session?.empresa_nome}</p>
        <h1 className="text-2xl md:text-3xl font-bold">Cadastro</h1>
        <p className="text-muted-foreground mt-1">Passo {passo + 1} de {PASSOS.length} — {PASSOS[passo]}</p>
        <Progress value={progresso} className="mt-3" />
      </div>

      <Card className="p-6 md:p-8">
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); avancar(); }}>
          {passo === 0 && (
            <>
              <Campo id="cnpj" label="CNPJ" value={formatCnpj(form.cnpj)} onChange={(v) => set('cnpj', v)} placeholder="00.000.000/0000-00" inputMode="numeric" hint={lookupBusy ? 'Buscando dados na Receita…' : 'Preenchemos razão social e nome fantasia automaticamente.'} />
              <Campo id="razao_social" label="Razão social" value={form.razao_social} onChange={(v) => set('razao_social', v)} />
              <Campo id="nome_fantasia" label="Nome fantasia" value={form.nome_fantasia} onChange={(v) => set('nome_fantasia', v)} hint="Será o nome do seu grupo com a Pipeelo." />
              <Campo id="inscricao_estadual" label="Inscrição estadual" value={form.inscricao_estadual} onChange={(v) => set('inscricao_estadual', v)} placeholder='Ou "Isento"' />
            </>
          )}
          {passo === 1 && (
            <>
              <Campo id="cobranca_email" label="E-mail de cobrança" type="email" value={form.cobranca_email} onChange={(v) => set('cobranca_email', v)} placeholder="financeiro@empresa.com.br" />
              <Campo id="cobranca_telefone" label="Telefone de cobrança" type="tel" value={maskPhone(form.cobranca_telefone)} onChange={(v) => set('cobranca_telefone', maskPhone(v))} placeholder="(00) 00000-0000" />
              <div>
                <Label htmlFor="dia_vencimento">Dia do vencimento <span className="text-primary">*</span></Label>
                <Select value={form.dia_vencimento} onValueChange={(v) => set('dia_vencimento', v)}>
                  <SelectTrigger id="dia_vencimento" className="mt-2"><SelectValue placeholder="Escolha o dia" /></SelectTrigger>
                  <SelectContent>{DIAS.map((d) => <SelectItem key={d} value={d}>Dia {d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </>
          )}
          {passo === 2 && (
            <Campo id="contrato_email" label="E-mail para envio do contrato" type="email" value={form.contrato_email} onChange={(v) => set('contrato_email', v)} hint="Enviamos o contrato de prestação de serviço para este endereço." />
          )}
          {passo === 3 && (
            <>
              <UploadMultiplo label="Contrato social ou última alteração contratual" value={form.doc_contrato_social} onChange={(v) => set('doc_contrato_social', v)} onUpload={upload('doc_contrato_social')} />
              <UploadMultiplo label="Documento com foto dos responsáveis legais (RG ou CNH)" hint="Um arquivo por responsável." value={form.doc_responsaveis} onChange={(v) => set('doc_responsaveis', v)} onUpload={upload('doc_responsaveis')} />
            </>
          )}
          {passo === 4 && (
            <>
              <Campo id="responsavel_nome" label="Seu nome completo" value={form.responsavel_nome} onChange={(v) => set('responsavel_nome', v)} />
              <Campo id="responsavel_cargo" label="Cargo" value={form.responsavel_cargo} onChange={(v) => set('responsavel_cargo', v)} />
              <Campo id="responsavel_email" label="Seu e-mail" type="email" value={form.responsavel_email} onChange={(v) => set('responsavel_email', v)} />
              <Campo id="responsavel_whatsapp" label="Seu WhatsApp" type="tel" value={maskPhone(form.responsavel_whatsapp)} onChange={(v) => set('responsavel_whatsapp', maskPhone(v))} placeholder="(00) 00000-0000" hint="Você será administrador do grupo com a Pipeelo." />

              <div className="space-y-3">
                <p className="text-sm font-medium">Quer adicionar mais alguém ao grupo agora? <span className="text-muted-foreground font-normal">(opcional, até 2)</span></p>
                {form.contatos_extras.map((c, i) => (
                  <div key={i} className="grid grid-cols-12 gap-3 rounded-lg border p-3">
                    <div className="col-span-12 md:col-span-6">
                      <Label htmlFor={`extra_nome_${i}`}>Nome</Label>
                      <Input id={`extra_nome_${i}`} className="mt-1" value={c.nome} onChange={(e) => set('contatos_extras', form.contatos_extras.map((x, j) => j === i ? { ...x, nome: e.target.value } : x))} />
                    </div>
                    <div className="col-span-10 md:col-span-5">
                      <Label htmlFor={`extra_whatsapp_${i}`}>WhatsApp</Label>
                      <Input id={`extra_whatsapp_${i}`} className="mt-1" type="tel" value={maskPhone(c.whatsapp)} onChange={(e) => set('contatos_extras', form.contatos_extras.map((x, j) => j === i ? { ...x, whatsapp: maskPhone(e.target.value) } : x))} />
                    </div>
                    <div className="col-span-2 md:col-span-1 flex items-end">
                      <Button type="button" variant="ghost" size="sm" aria-label="Remover contato" onClick={() => set('contatos_extras', form.contatos_extras.filter((_, j) => j !== i))}>×</Button>
                    </div>
                  </div>
                ))}
                {form.contatos_extras.length < 2 && (
                  <Button type="button" variant="outline" size="sm" onClick={() => set('contatos_extras', [...form.contatos_extras, { nome: '', whatsapp: '' }])}>Adicionar contato</Button>
                )}
              </div>

              <div className="flex items-start gap-3 rounded-lg border p-4">
                <Checkbox id="aceite" checked={form.aceite_dados} onCheckedChange={(v) => set('aceite_dados', v === true)} />
                <Label htmlFor="aceite" className="leading-snug">Confirmo que os dados e documentos estão corretos.</Label>
              </div>
            </>
          )}

          {erro && <p className="text-sm text-destructive" role="alert">{erro}</p>}

          <div className="flex items-center justify-between pt-2">
            <Button type="button" variant="ghost" disabled={passo === 0 || enviando} onClick={() => { setErro(''); setPasso(passo - 1); }}>
              <ArrowLeft className="mr-2 h-4 w-4" />Voltar
            </Button>
            <Button type="submit" size="lg" disabled={enviando} className="gap-2">
              {enviando ? <><Loader2 className="h-4 w-4 animate-spin" />Enviando…</> : passo === PASSOS.length - 1 ? <>Enviar cadastro<ArrowRight className="h-4 w-4" /></> : <>Continuar<ArrowRight className="h-4 w-4" /></>}
            </Button>
          </div>
        </form>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4"><PipeeloLogo size="md" /></div>
      </header>
      <main className="container mx-auto px-4 py-10 md:py-16"><div className="max-w-xl mx-auto">{children}</div></main>
    </div>
  );
}

function Campo(props: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; hint?: string; inputMode?: 'numeric' | 'text' | 'tel' | 'email';
}) {
  return (
    <div>
      <Label htmlFor={props.id}>{props.label} <span className="text-primary">*</span></Label>
      <Input id={props.id} className="mt-2 text-base py-5" type={props.type ?? 'text'} inputMode={props.inputMode} value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
      {props.hint && <p className="mt-1 text-xs text-muted-foreground">{props.hint}</p>}
    </div>
  );
}
