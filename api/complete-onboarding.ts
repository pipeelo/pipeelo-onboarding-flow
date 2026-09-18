import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  OnboardingPayloadSchema,
  PAYLOAD_VERSION,
} from "../contracts/src/onboarding-payload.js";
import { requireSupabase } from "./_lib/supabase.js";
import { aplicarCompatLegado } from "./_lib/compat-legado.js";
import {
  enqueueOutbox,
  markInFlight,
  markDelivered,
  markFailedAttempt,
  deliverOutbox,
} from "./_lib/outbox.js";

function expandHorarioSemanal(horario: Record<string, unknown> | null | undefined) {
  if (!horario || typeof horario !== "object") return horario;
  const result: Record<string, unknown> = {};
  const ss = horario.segunda_sexta as Record<string, unknown> | undefined;
  const sab = horario.sabado as Record<string, unknown> | undefined;
  const df = horario.domingo_feriado as Record<string, unknown> | undefined;
  if (ss) {
    for (const dia of ["segunda_feira", "terca_feira", "quarta_feira", "quinta_feira", "sexta_feira"]) {
      result[dia] = { inicio: ss.inicio ?? null, fim: ss.fim ?? null, nao_atende: ss.nao_atende ?? false };
    }
  }
  if (sab) result.sabado = { inicio: sab.inicio ?? null, fim: sab.fim ?? null, nao_atende: sab.nao_atende ?? false };
  if (df) {
    result.domingo = { inicio: df.inicio ?? null, fim: df.fim ?? null, nao_atende: df.nao_atende ?? false };
    result.feriado = { inicio: df.inicio ?? null, fim: df.fim ?? null, nao_atende: df.nao_atende ?? false };
  }
  return result;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { sessionId, testWebhookUrl } = req.body as { sessionId?: string; testWebhookUrl?: string };
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });

    const supabase = requireSupabase();
    const { data: session, error: sessionError } = await supabase
      .from("onboarding_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();
    if (sessionError || !session) return res.status(404).json({ error: "Session not found" });

    const requiredDepts = ["status_sac_geral", "status_financeiro", "status_suporte", "status_vendas"];
    const incomplete = requiredDepts.find((k) => session[k] !== "concluido");
    if (incomplete) return res.status(200).json({ message: "Not all departments are complete" });

    const { data: respostas, error: respostasError } = await supabase
      .from("onboarding_respostas")
      .select("*")
      .eq("session_id", sessionId);
    if (respostasError) return res.status(500).json({ error: "Error fetching responses" });

    const respostasPorDepartamento: Record<string, Record<string, unknown>> = {
      identificacao: {},
      sac_geral: {},
      financeiro: {},
      suporte: {},
      vendas: {},
    };

    for (const r of respostas || []) {
      const bucket = respostasPorDepartamento[r.departamento];
      if (!bucket) continue;
      bucket[r.pergunta_id] = r.valor;
    }

    // questions.json 4.x → ids legado que o admin-pipeelo lê (ver compat-legado.ts).
    // Roda ANTES da expansão de horário, porque deriva `horario_atendimento` do
    // horário por departamento e o admin espera o formato expandido em ambos.
    aplicarCompatLegado(respostasPorDepartamento, {
      empresa_nome: session.empresa_nome,
      erp: session.erp ?? null,
      gerenciamento_rede: session.gerenciamento_rede ?? null,
      qtd_sessoes: session.qtd_sessoes ?? null,
      cadastro: session.cadastro ?? null,
    });

    for (const bucket of Object.values(respostasPorDepartamento)) {
      for (const [id, valor] of Object.entries(bucket)) {
        if (valor && typeof valor === "object" && !Array.isArray(valor)) {
          const h = valor as Record<string, unknown>;
          if (h.segunda_sexta || h.sabado || h.domingo_feriado) bucket[id] = expandHorarioSemanal(h);
        }
      }
    }

    const payload = {
      payload_version: PAYLOAD_VERSION,
      session: {
        id: session.id,
        empresa_nome: session.empresa_nome,
        ceo_email: session.ceo_email,
        cnpj: session.cnpj,
        access_token: session.access_token ?? null,
        tenant_id: session.tenant_id ?? null,
        pipeelo_token: session.pipeelo_token ?? null,
        modo: session.modo ?? 'completo',
        contratou_crm: session.contratou_crm ?? false,
        // Dados comerciais do deal preenchidos pelo admin na criação do link.
        // numeric pode chegar como string do PostgREST → normaliza pra number.
        comercial: {
          valor_sessao: session.valor_sessao != null ? Number(session.valor_sessao) : null,
          qtd_sessoes: session.qtd_sessoes != null ? Number(session.qtd_sessoes) : null,
          valor_mensal: session.valor_mensal != null ? Number(session.valor_mensal) : null,
          dia_vencimento: session.dia_vencimento != null ? Number(session.dia_vencimento) : null,
          observacoes: session.observacoes ?? null,
        },
        created_at: session.created_at,
        responsaveis: {
          sac_geral: session.responsavel_sac_geral,
          financeiro: session.responsavel_financeiro,
          suporte: session.responsavel_suporte,
          vendas: session.responsavel_vendas,
        },
        datas_conclusao: {
          sac_geral: session.concluido_sac_geral_at,
          financeiro: session.concluido_financeiro_at,
          suporte: session.concluido_suporte_at,
          vendas: session.concluido_vendas_at,
        },
      },
      respostas: respostasPorDepartamento,
    };

    // PIPE-01/PIPE-02/PIPE-08: validar contrato antes de mandar pro admin.
    // Falha early com 500 estruturado em vez de mandar payload inválido pelo wire.
    const parseResult = OnboardingPayloadSchema.safeParse(payload);
    if (!parseResult.success) {
      // PII-safe log: só sessionId + paths/codes dos issues, nada de respostas/cnpj/email crus.
      console.error("[complete-onboarding] invalid_outbound_payload", {
        sessionId: session.id,
        issues: parseResult.error.issues.map((i) => ({
          path: i.path,
          code: i.code,
        })),
      });
      return res.status(500).json({
        error: "invalid_outbound_payload",
        issues: parseResult.error.issues,
      });
    }
    const validatedPayload = parseResult.data;

    const targetUrl = testWebhookUrl || `${process.env.PIPEELO_ADMIN_API_URL || "https://admin.pipeelo.com"}/api/clients/onboarding/create`;

    // Plan 02-02: outbox-first. Grava row pending ANTES de qualquer fetch.
    // Garante que mesmo com queda de rede, cron drena depois.
    const outboxRow = await enqueueOutbox({
      sessionId: session.id,
      targetUrl,
      payload: validatedPayload,
    });

    // Idempotency hit: row já delivered (re-entrada na mesma sessão) → 200 imediato sem refetch.
    if (outboxRow.status === "delivered") {
      return res.status(200).json({
        success: true,
        idempotent_hit: true,
        outbox_id: outboxRow.id,
      });
    }

    // Tenta entrega inline (best-effort).
    await markInFlight(outboxRow.id);
    const result = await deliverOutbox(outboxRow);

    if (result.ok) {
      await markDelivered(outboxRow.id);
      return res.status(200).json({
        success: true,
        message: "Webhook sent successfully",
        outbox_id: outboxRow.id,
      });
    }

    // Falha inline → marca pra retry. Cron /api/cron/reconcile-webhooks drena depois.
    // Resposta 202 (Accepted): cliente vê tela de sucesso, eventual delivery garantido.
    console.error("[complete-onboarding] inline delivery failed, queued for retry", {
      sessionId: session.id,
      outboxId: outboxRow.id,
      status: result.status,
    });

    await markFailedAttempt(
      outboxRow.id,
      `${result.status ?? "no-resp"}: ${result.body ?? ""}`,
      outboxRow.attempt_count,
      outboxRow.max_attempts,
    );

    return res.status(202).json({
      success: true,
      queued_for_retry: true,
      outbox_id: outboxRow.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("complete-onboarding error:", message);
    return res.status(500).json({ error: message });
  }
}
