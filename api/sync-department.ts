import type { VercelRequest, VercelResponse } from "@vercel/node";
import { pipeeloApi } from "./_lib/admin-pipeelo.js";
import { requireSupabase } from "./_lib/supabase.js";

interface SyncRequest {
  sessionId: string;
  departamento: "sac_geral" | "financeiro" | "suporte" | "vendas";
}

type HorarioDia = { inicio?: string; fim?: string; nao_atende?: boolean };
type HorarioSemanal = {
  segunda_sexta?: HorarioDia;
  sabado?: HorarioDia;
  domingo_feriado?: HorarioDia;
};

const CATEGORY_CONFIG: Record<SyncRequest["departamento"], { name: string; color: string }> = {
  sac_geral: { name: "Geral", color: "#9333ea" },
  financeiro: { name: "Financeiro", color: "#1ECAA3" },
  suporte: { name: "Suporte", color: "#3b82f6" },
  vendas: { name: "Vendas", color: "#f59e0b" },
};

function horarioToOfficeHours(horario: HorarioSemanal | null | undefined) {
  const ss = horario?.segunda_sexta;
  const sab = horario?.sabado;
  const df = horario?.domingo_feriado;
  const toRange = (h: HorarioDia | undefined): [string, string] | false => {
    if (!h || h.nao_atende || !h.inicio || !h.fim) return false;
    return [h.inicio, h.fim];
  };
  const weekday = toRange(ss);
  const sabRange = toRange(sab);
  const domRange = toRange(df);
  return {
    week_days: {
      monday: { first: weekday, second: false },
      tuesday: { first: weekday, second: false },
      wednesday: { first: weekday, second: false },
      thursday: { first: weekday, second: false },
      friday: { first: weekday, second: false },
      saturday: { first: sabRange, second: false },
      sunday: { first: domRange, second: false },
    },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body as SyncRequest;
    if (!body.sessionId || !body.departamento) {
      return res.status(400).json({ error: "sessionId and departamento are required" });
    }
    if (!CATEGORY_CONFIG[body.departamento]) {
      return res.status(400).json({ error: "Invalid departamento" });
    }

    const supabase = requireSupabase();
    const { data: session, error: sessionErr } = await supabase
      .from("onboarding_sessions")
      .select("id, tenant_id, pipeelo_token")
      .eq("id", body.sessionId)
      .single();
    if (sessionErr || !session) return res.status(404).json({ error: "Session not found" });
    if (!session.pipeelo_token) {
      return res.status(400).json({ error: "Session has no pipeelo_token — run provision-tenant first" });
    }

    const { data: respostas } = await supabase
      .from("onboarding_respostas")
      .select("pergunta_id, valor")
      .eq("session_id", body.sessionId)
      .eq("departamento", body.departamento);

    const respostasMap: Record<string, unknown> = {};
    for (const r of respostas || []) respostasMap[r.pergunta_id] = r.valor;

    const cfg = CATEGORY_CONFIG[body.departamento];

    const categoryRes = await pipeeloApi<{ id?: string; data?: { id?: string } }>(
      session.pipeelo_token,
      "/v1/categories",
      {
        method: "POST",
        body: {
          name: cfg.name,
          color: cfg.color,
          is_online_required: true,
          distribution_type: "least-busy",
        },
      }
    ).catch((err: unknown) => {
      const e = err as { status?: number };
      if (e.status === 422) return null;
      throw err;
    });

    const categoryId = categoryRes?.id ?? categoryRes?.data?.id;

    // questions.json 4.0: um `horario_<departamento>` por item marcado em
    // `departamentos_lista` (SAC Geral). Geral = atendimento_geral.
    const horarioKey = body.departamento === "sac_geral" ? "horario_atendimento_geral" : `horario_${body.departamento}`;
    const horario = respostasMap[horarioKey] as HorarioSemanal | undefined;
    if (categoryId && horario) {
      await pipeeloApi(session.pipeelo_token, `/v1/categories/${categoryId}/office-hours`, {
        method: "POST",
        body: horarioToOfficeHours(horario),
      }).catch((err) => {
        console.warn("office-hours failed:", err);
      });
    }

    return res.status(200).json({
      success: true,
      departamento: body.departamento,
      categoryId: categoryId ?? null,
      perguntasSincronizadas: Object.keys(respostasMap).length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("sync-department error:", message);
    return res.status(500).json({ error: message });
  }
}
