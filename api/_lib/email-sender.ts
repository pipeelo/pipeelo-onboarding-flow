import { createHash } from 'node:crypto';
import { render } from '@react-email/render';
import { Resend } from 'resend';
import * as React from 'react';

import { getServiceSupabase } from './supabase';

// Templates importados de Plan 05-01.
// Default exports — cada um aceita props tipadas.
import WelcomeCEO, {
  type WelcomeCEOProps,
} from '../../src/emails/WelcomeCEO';
import ReminderStalled, {
  type ReminderStalledProps,
} from '../../src/emails/ReminderStalled';
import CredentialsReady, {
  type CredentialsReadyProps,
} from '../../src/emails/CredentialsReady';
import JarvisFailedAlert, {
  type JarvisFailedAlertProps,
} from '../../src/emails/JarvisFailedAlert';
import ConviteGrupo, {
  type ConviteGrupoProps,
} from '../../src/emails/ConviteGrupo';

/**
 * Plan 05-02 — Wrapper transacional idempotente sobre Resend.
 *
 * Idempotência (Pitfall 7):
 *   - Antes de enviar, faz lookup em email_log por idempotency_key.
 *   - Se status='sent', retorna { skipped: true, resend_id } SEM enviar.
 *   - Após envio bem-sucedido, INSERT log status='sent'.
 *   - Em erro Resend, INSERT log status='failed' + propaga throw.
 *
 * Idempotency key:
 *   - Default: sha256(template + ':' + sessionId).slice(0, 40)
 *   - Custom: passar `idempotencyKey` (ex: cron reminder usa data UTC pra
 *     permitir re-envio diário em escalation).
 *
 * Subjects ficam aqui (não nos templates) — facilita A/B testing.
 */

export type EmailTemplate =
  | 'WelcomeCEO'
  | 'ReminderStalled'
  | 'CredentialsReady'
  | 'JarvisFailedAlert'
  | 'ConviteGrupo';

// Mapping de subject por template.
const SUBJECTS: Record<EmailTemplate, (props: unknown) => string> = {
  WelcomeCEO: (p) =>
    `Seu onboarding Pipeelo começa aqui — ${(p as WelcomeCEOProps).empresaNome}`,
  ReminderStalled: (p) => {
    const props = p as ReminderStalledProps;
    return `${props.empresaNome} — falta pouco. Continue de onde parou em ${props.departamentoAtual}.`;
  },
  CredentialsReady: (p) =>
    `Sua plataforma Pipeelo está pronta — acesse em até 72h (${(p as CredentialsReadyProps).empresaNome})`,
  JarvisFailedAlert: (p) => {
    const props = p as JarvisFailedAlertProps;
    return `[Jarvis] Falhou — ${props.sessionId.slice(0, 8)} (${props.empresaNome})`;
  },
  ConviteGrupo: (p) => `Entre no grupo ${(p as ConviteGrupoProps).grupoNome} no WhatsApp`,
};

// Renderer mapping — separado por template pra type-safety dos props.
async function renderTemplate(
  template: EmailTemplate,
  props: unknown,
): Promise<string> {
  switch (template) {
    case 'WelcomeCEO':
      return render(React.createElement(WelcomeCEO, props as WelcomeCEOProps));
    case 'ReminderStalled':
      return render(
        React.createElement(ReminderStalled, props as ReminderStalledProps),
      );
    case 'CredentialsReady':
      return render(
        React.createElement(CredentialsReady, props as CredentialsReadyProps),
      );
    case 'JarvisFailedAlert':
      return render(
        React.createElement(
          JarvisFailedAlert,
          props as JarvisFailedAlertProps,
        ),
      );
    case 'ConviteGrupo':
      return render(React.createElement(ConviteGrupo, props as ConviteGrupoProps));
    default: {
      const _exhaustive: never = template;
      throw new Error(`unknown template: ${String(_exhaustive)}`);
    }
  }
}

export interface SendEmailParams {
  template: EmailTemplate;
  sessionId: string;
  to: string;
  props: unknown;
  /** Custom idempotency key — default = sha256(template+':'+sessionId). */
  idempotencyKey?: string;
}

export interface SendEmailResult {
  skipped: boolean;
  resend_id?: string;
}

function deriveIdempotencyKey(template: EmailTemplate, sessionId: string): string {
  return createHash('sha256')
    .update(`${template}:${sessionId}`)
    .digest('hex')
    .slice(0, 40);
}

let cachedResend: Resend | null = null;
function getResend(): Resend {
  if (cachedResend) return cachedResend;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('Missing RESEND_API_KEY env var');
  cachedResend = new Resend(apiKey);
  return cachedResend;
}

export async function sendTransactionalEmail(
  params: SendEmailParams,
): Promise<SendEmailResult> {
  const { template, sessionId, to, props } = params;
  const idempotencyKey =
    params.idempotencyKey ?? deriveIdempotencyKey(template, sessionId);

  const sb = getServiceSupabase();

  // 1) Lookup log por idempotency_key
  const { data: existing } = await sb
    .from('email_log')
    .select('id, resend_id, status')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existing && (existing as { status: string }).status === 'sent') {
    return {
      skipped: true,
      resend_id: (existing as { resend_id?: string }).resend_id,
    };
  }

  // 2) Render
  let html: string;
  try {
    html = await renderTemplate(template, props);
  } catch (renderErr) {
    const msg = renderErr instanceof Error ? renderErr.message : String(renderErr);
    await sb.from('email_log').insert({
      session_id: sessionId,
      template,
      idempotency_key: idempotencyKey,
      recipient: to,
      status: 'failed',
      error: `render: ${msg}`.slice(0, 1000),
    });
    throw new Error(`render failed: ${msg}`);
  }

  // 3) Send via Resend
  const from = process.env.RESEND_FROM_EMAIL ?? 'noreply@mail.pipeelo.com';
  const replyTo = process.env.RESEND_REPLY_TO;

  const subjectFn = SUBJECTS[template];
  const subject = subjectFn(props);

  try {
    const resp = await getResend().emails.send({
      from,
      to,
      subject,
      html,
      headers: { 'Idempotency-Key': idempotencyKey },
      tags: [{ name: 'template', value: template }],
      ...(replyTo ? { replyTo } : {}),
    });

    if ((resp as { error?: { message?: string } }).error) {
      const errMsg = (resp as { error: { message?: string } }).error.message ?? 'unknown';
      await sb.from('email_log').insert({
        session_id: sessionId,
        template,
        idempotency_key: idempotencyKey,
        recipient: to,
        status: 'failed',
        error: `resend: ${errMsg}`.slice(0, 1000),
      });
      throw new Error(`resend error: ${errMsg}`);
    }

    const resendId = (resp as { data?: { id?: string } }).data?.id;

    await sb.from('email_log').insert({
      session_id: sessionId,
      template,
      idempotency_key: idempotencyKey,
      recipient: to,
      resend_id: resendId,
      status: 'sent',
    });

    return { skipped: false, resend_id: resendId };
  } catch (err) {
    // Já gravou failed acima se foi erro do Resend.error;
    // este catch pega throws de network ou re-throw acima.
    const msg = err instanceof Error ? err.message : String(err);
    if (!/^resend error|^render failed/.test(msg)) {
      await sb.from('email_log').insert({
        session_id: sessionId,
        template,
        idempotency_key: idempotencyKey,
        recipient: to,
        status: 'failed',
        error: `network: ${msg}`.slice(0, 1000),
      });
    }
    throw err;
  }
}

// Re-export pra testes que precisam resetar o cache do client.
export function __resetResendCache() {
  cachedResend = null;
}
