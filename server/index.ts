import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;
type Loader = () => Promise<{ default: Handler }>;

const routes: Array<[string, Loader]> = [
  ['/api/admin/sessions-list',          () => import('../api/admin/_sessions-list.ts')],
  ['/api/admin/sessions-create',        () => import('../api/admin/_sessions-create.ts')],
  ['/api/admin/sessions-update',        () => import('../api/admin/_sessions-update.ts')],
  ['/api/admin/sessions-delete',        () => import('../api/admin/_sessions-delete.ts')],
  ['/api/admin/short-links-create',     () => import('../api/admin/_short-links-create.ts')],
  ['/api/admin/whatsapp-send-welcome',  () => import('../api/admin/_whatsapp-send-welcome.ts')],
  ['/api/admin/cadastro-recriar-grupo', () => import('../api/admin/_cadastro-recriar-grupo.ts')],
  ['/api/admin/cadastro-gerar-contrato', () => import('../api/admin/_cadastro-gerar-contrato.ts')],
  ['/api/admin/cadastro-cobrar-conta-azul', () => import('../api/admin/_cadastro-cobrar-conta-azul.ts')],
  ['/api/admin/contrato-download',      () => import('../api/admin/_contrato-download.ts')],
  ['/api/admin/assinatura-enviar',      () => import('../api/admin/_assinatura-enviar.ts')],
  ['/api/admin/assinatura-detalhes',    () => import('../api/admin/_assinatura-detalhes.ts')],
  ['/api/admin/assinatura-aprovar',     () => import('../api/admin/_assinatura-aprovar.ts')],
  ['/api/sessions/cnpj-lookup',         () => import('../api/sessions/_cnpj-lookup.ts')],
  ['/api/sessions/create',              () => import('../api/sessions/_create.ts')],
  ['/api/sessions/get',                 () => import('../api/sessions/_get.ts')],
  ['/api/sessions/save-resposta',       () => import('../api/sessions/_save-resposta.ts')],
  ['/api/sessions/complete-department', () => import('../api/sessions/_complete-department.ts')],
  ['/api/sessions/send-magic-link',     () => import('../api/sessions/_send-magic-link.ts')],
  ['/api/sessions/upload-arquivo',      () => import('../api/sessions/_upload-arquivo.ts')],
  ['/api/sessions/validate-cnpj',       () => import('../api/sessions/_validate-cnpj.ts')],
  ['/api/sessions/cadastro-submit',     () => import('../api/sessions/_cadastro-submit.ts')],
  ['/api/email/send-credentials',       () => import('../api/email/_send-credentials.ts')],
  ['/api/email/send-failure-alert',     () => import('../api/email/_send-failure-alert.ts')],
  ['/api/email/send-welcome',           () => import('../api/email/_send-welcome.ts')],
  ['/api/create-session',               () => import('../api/create-session.ts')],
  ['/api/complete-onboarding',          () => import('../api/complete-onboarding.ts')],
  ['/api/provision-tenant',             () => import('../api/provision-tenant.ts')],
  ['/api/send-email',                   () => import('../api/send-email.ts')],
  ['/api/sync-department',              () => import('../api/sync-department.ts')],
  ['/api/cron/reconcile-webhooks',      () => import('../api/cron/reconcile-webhooks.ts')],
  ['/api/cron/reminder-stalled',        () => import('../api/cron/reminder-stalled.ts')],
  ['/api/cron/assinatura-poll',         () => import('../api/cron/assinatura-poll.ts')],
  ['/api/cron/evolution-fila',          () => import('../api/cron/evolution-fila.ts')],
];

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
// Upload de planilha (5MB ≈ 6.7MB em base64) e documentos cadastro (10MB ≈ 13.4MB
// em base64) — parser maior SÓ nessa rota; o parser global de 1mb abaixo pula body
// já parseado.
app.use('/api/sessions/upload-arquivo', express.json({ limit: '15mb' }));
app.use(express.json({ limit: '1mb' }));

for (const [route, loader] of routes) {
  app.all(route, async (req, res) => {
    try {
      const mod = await loader();
      await mod.default(req, res);
    } catch (e) {
      console.error(`[server] unhandled error in ${route}:`, e);
      if (!res.headersSent) res.status(500).json({ error: 'internal' });
    }
  });
}

// Encurtador público: GET /s/:code → 302 pro target_url
app.get('/s/:code', async (req, res) => {
  try {
    const mod = await import('../api/s/redirect.ts');
    await mod.default(req, res);
  } catch (e) {
    console.error('[server] unhandled error in /s/:code:', e);
    if (!res.headersSent) res.redirect(302, '/');
  }
});

const distDir = path.resolve(__dirname, '..', 'dist');
app.use(express.static(distDir, { index: false, maxAge: '1y' }));

app.use((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.sendFile(path.join(distDir, 'index.html'));
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, '0.0.0.0', () => {
  console.log(`[server] listening on :${port}`);
});

// Fila cadenciada dos grupos de WhatsApp: uma ação por rodada, ritmo global
// controlado em evolution_fila_estado. EVOLUTION_FILA_TICK_SEGUNDOS=0 desliga.
// O tick é só o batimento; quem decide se pode agir é o slot no banco, então
// diminuir o tick não acelera a fila — apenas confere com mais frequência.
const filaTick = Number(process.env.EVOLUTION_FILA_TICK_SEGUNDOS ?? 30);
if (Number.isFinite(filaTick) && filaTick > 0) {
  let drenando = false;
  const drenar = async () => {
    if (drenando) return;
    drenando = true;
    try {
      const mod = await import('../api/cron/evolution-fila.ts');
      const r = await mod.drenarFilaEvolution();
      if (r.processado || r.erro) console.log('[evolution-fila]', JSON.stringify(r));
    } catch (e) {
      console.error('[evolution-fila] falhou:', e instanceof Error ? e.message : e);
    } finally {
      drenando = false;
    }
  };
  setTimeout(drenar, 20_000);
  setInterval(drenar, filaTick * 1000);
  console.log(`[server] fila de grupos conferida a cada ${filaTick}s`);
}

// Polling da AssinaPDF (sem webhook): a cada N minutos. ASSINATURA_POLL_MINUTOS=0 desliga.
const pollMinutos = Number(process.env.ASSINATURA_POLL_MINUTOS ?? 10);
if (Number.isFinite(pollMinutos) && pollMinutos > 0) {
  let rodando = false;
  const tick = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const mod = await import('../api/cron/assinatura-poll.ts');
      const r = await mod.executarPollAssinatura();
      if (r.consultadas || r.erros.length) console.log('[assinatura-poll]', JSON.stringify(r));
    } catch (e) {
      console.error('[assinatura-poll] falhou:', e instanceof Error ? e.message : e);
    } finally {
      rodando = false;
    }
  };
  setTimeout(tick, 30_000);
  setInterval(tick, pollMinutos * 60_000);
  console.log(`[server] polling da assinatura a cada ${pollMinutos} min`);
}
