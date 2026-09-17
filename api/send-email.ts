import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

interface OnboardingEmailRequest {
  empresaNome: string;
  departamento: string;
  departamentoNome: string;
  responsavelNome: string;
  respostas: Record<string, unknown>;
  sessionId: string;
  allDepartmentsComplete?: boolean;
}

const PROMPT_MAPPING: Record<string, Record<string, Array<{ questionId: string; placeholder?: string; section?: string; fromSacGeral?: boolean; label?: string }>>> = {
  sac_geral: {
    secao_8_empresa: [
      { questionId: "empresa_endereco_sede", placeholder: "[Endereço da sede]", section: "SEÇÃO 8" },
      { questionId: "empresa_cidades", placeholder: "[Cidades atendidas]", section: "SEÇÃO 8" },
      { questionId: "empresa_enderecos", placeholder: "[Endereço]", section: "SEÇÃO 8" },
      { questionId: "empresa_telefones", placeholder: "[Telefones]", section: "SEÇÃO 8" },
      { questionId: "empresa_site", placeholder: "[Site]", section: "SEÇÃO 8" },
    ],
    identidade_ia: [
      { questionId: "nome_ia_customizado", label: "Nome IA customizado" },
      { questionId: "nome_ia", label: "Nome da IA" },
    ],
    horarios: [
      // questions.json 4.0: um `horario_<departamento>` por departamento marcado.
      // Os ids dinâmicos aparecem na tabela "Expandir todas as respostas".
      { questionId: "plantao_departamentos", label: "Departamentos com plantão" },
    ],
    estrutura: [
      { questionId: "departamentos_lista", label: "Departamentos existentes" },
      { questionId: "clientes_prioritarios", label: "Clientes prioritários" },
    ],
    processos: [
      { questionId: "cancelamento_padrao", label: "Cancelamento segue o padrão" },
      { questionId: "cancelamento_fluxo_desejado", label: "Fluxo de cancelamento desejado" },
    ],
    app: [
      { questionId: "app_tem", label: "Tem aplicativo" },
      { questionId: "app_nome", label: "Nome do app" },
      { questionId: "app_link", label: "Link do app" },
      { questionId: "app_acoes_atendentes", label: "Ações dos atendentes no app" },
    ],
  },
  financeiro: {
    secao_11_empresa: [
      { questionId: "empresa_cidades", placeholder: "[Cidades atendidas]", section: "SEÇÃO 11", fromSacGeral: true },
      { questionId: "empresa_enderecos", placeholder: "[Endereço]", section: "SEÇÃO 11", fromSacGeral: true },
      { questionId: "empresa_telefones", placeholder: "[Telefones]", section: "SEÇÃO 11", fromSacGeral: true },
      { questionId: "empresa_site", placeholder: "[Site]", section: "SEÇÃO 11", fromSacGeral: true },
      { questionId: "empresa_portal_cliente", placeholder: "[Link central]", section: "SEÇÃO 11", fromSacGeral: true },
    ],
    pagamento: [
      { questionId: "formas_pagamento_disponiveis", label: "Formas de pagamento" },
      { questionId: "metodo_pagamento_padrao", label: "Método padrão" },
      { questionId: "gateway_pagamento", label: "Gateway" },
    ],
    bloqueio: [
      { questionId: "dias_atraso_bloqueio", label: "Dias para bloqueio" },
      { questionId: "tipo_bloqueio", label: "Tipo de bloqueio" },
      { questionId: "fluxo_reducao_bloqueio", label: "Fluxo redução/bloqueio" },
      { questionId: "liberacao_confianca", label: "Liberação em confiança" },
    ],
    taxas: [
      { questionId: "taxa_religacao", label: "Taxa religação" },
      { questionId: "valor_taxa_religacao", label: "Valor religação" },
      { questionId: "outras_taxas", label: "Outras taxas" },
      { questionId: "multa_juros_atraso", label: "Multa/juros atraso" },
    ],
  },
  suporte: {
    secao_11_empresa: [
      { questionId: "empresa_cidades", placeholder: "[Cidades]", section: "SEÇÃO 11", fromSacGeral: true },
    ],
    diagnostico: [
      { questionId: "sinal_onu_minimo", label: "Sinal ONU mínimo (dBm)" },
      { questionId: "sinal_onu_maximo", label: "Sinal ONU máximo (dBm)" },
      { questionId: "sinal_onu_aceitavel", label: "Sinal ONU aceitável (dBm)" },
      { questionId: "fluxo_diagnostico", label: "Fluxo de diagnóstico" },
    ],
    integracoes: [
      { questionId: "erp_utilizado", label: "ERP utilizado" },
      { questionId: "olt_sistema", label: "OLT/Sistema de gerenciamento" },
      { questionId: "reset_onu_tipo", label: "Reset ONU" },
      { questionId: "protocolo_tr069", label: "TR-069 ativo" },
    ],
    alteracoes_remotas: [
      { questionId: "troca_senha_wifi", label: "Troca senha WiFi" },
      { questionId: "troca_nome_wifi", label: "Troca nome WiFi" },
      { questionId: "verificar_dispositivos", label: "Ver dispositivos" },
    ],
  },
  vendas: {
    secao_13_empresa: [
      { questionId: "empresa_cidades", placeholder: "[Cidades]", section: "SEÇÃO 13", fromSacGeral: true },
    ],
    portfolio: [
      { questionId: "tabela_planos", label: "Tabela de planos" },
      { questionId: "plano_campeao", label: "Plano campeão" },
      { questionId: "tem_fidelidade", label: "Tem fidelidade" },
      { questionId: "periodo_fidelidade", label: "Período fidelidade" },
      { questionId: "diferenciais_concorrencia", label: "Diferenciais" },
    ],
    metodo: [
      { questionId: "metodo_vendas", label: "Método de vendas (DEF/SPIN)" },
      { questionId: "recomendacao_perfil_1_2", label: "Recomendação 1-2 pessoas" },
      { questionId: "recomendacao_perfil_3_4", label: "Recomendação 3-4 pessoas" },
      { questionId: "recomendacao_perfil_5mais", label: "Recomendação 5+ pessoas" },
    ],
    instalacao: [
      { questionId: "tempo_instalacao", label: "Prazo instalação" },
      { questionId: "taxa_instalacao", label: "Taxa instalação" },
      { questionId: "agendamento_instalacao", label: "Agendamento" },
    ],
  },
};

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "<não informado>";
  if (value === "NAO_POSSUI") return "Não possui";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.selected)) {
      let out = (obj.selected as string[]).join(", ");
      if (obj.outroTexto) out += ` (Outro: ${obj.outroTexto})`;
      return out;
    }
    if (obj.segunda_sexta || obj.sabado || obj.domingo_feriado) {
      const parts: string[] = [];
      const ss = obj.segunda_sexta as Record<string, unknown> | undefined;
      const sab = obj.sabado as Record<string, unknown> | undefined;
      const dom = obj.domingo_feriado as Record<string, unknown> | undefined;
      if (ss && !ss.nao_atende) parts.push(`Seg-Sex: ${ss.inicio} às ${ss.fim}`);
      if (sab && !sab.nao_atende) parts.push(`Sáb: ${sab.inicio} às ${sab.fim}`);
      else if (sab?.nao_atende) parts.push("Sáb: Não atende");
      if (dom && !dom.nao_atende) parts.push(`Dom/Feriado: ${dom.inicio} às ${dom.fim}`);
      else if (dom?.nao_atende) parts.push("Dom/Feriado: Não atende");
      return parts.join(" | ");
    }
    if (typeof obj.logradouro === "string" && typeof obj.cidade === "string") {
      return [
        [obj.logradouro, obj.numero].filter(Boolean).join(", "),
        obj.complemento,
        obj.bairro,
        [obj.cidade, obj.uf].filter(Boolean).join("/"),
        obj.cep ? `CEP ${obj.cep}` : "",
      ].filter(Boolean).join(" - ");
    }
    if (Array.isArray(value)) {
      return (value as unknown[])
        .map((v) => (v && typeof v === "object" ? Object.values(v as Record<string, unknown>).filter(Boolean).join(" · ") : String(v)))
        .join(" | ");
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function generateBlock(title: string, items: Array<{ questionId: string; label?: string; placeholder?: string; section?: string; fromSacGeral?: boolean }>, respostas: Record<string, unknown>): string {
  const rows = items
    .map((item) => {
      const value = formatValue(respostas[item.questionId]);
      const key = item.placeholder ?? item.label ?? item.questionId;
      const note = item.fromSacGeral ? ' <span style="color:#f59e0b">⚠ do SAC</span>' : "";
      return `<tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:500">${key}</td><td style="padding:8px;border:1px solid #e2e8f0">${value}${note}</td></tr>`;
    })
    .join("");
  return `<h3 style="color:#1ECAA3;text-transform:uppercase;font-size:14px">${title}</h3><table style="width:100%;border-collapse:collapse">${rows}</table>`;
}

function buildDepartmentContent(departamento: string, respostas: Record<string, unknown>): string {
  const mapping = PROMPT_MAPPING[departamento];
  if (!mapping) return "";
  return Object.entries(mapping)
    .map(([title, items]) => generateBlock(title.replace(/_/g, " "), items, respostas))
    .join("");
}

const colors: Record<string, string> = {
  sac_geral: "#9333ea",
  financeiro: "#1ECAA3",
  suporte: "#3b82f6",
  vendas: "#f59e0b",
};

const emojis: Record<string, string> = {
  identificacao: "🪪",
  sac_geral: "🏢",
  financeiro: "💰",
  suporte: "🔧",
  vendas: "📈",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const data = req.body as OnboardingEmailRequest;
    const { empresaNome, departamento, departamentoNome, responsavelNome, respostas, sessionId } = data;

    const color = colors[departamento] || "#1ECAA3";
    const emoji = emojis[departamento] || "✅";
    const content = buildDepartmentContent(departamento, respostas);

    const allRows = Object.entries(respostas)
      .map(([k, v]) => `<tr><td style="padding:6px;border:1px solid #e2e8f0;font-family:monospace;font-size:12px;background:#f8fafc">${k}</td><td style="padding:6px;border:1px solid #e2e8f0">${formatValue(v)}</td></tr>`)
      .join("");

    const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;margin:0;padding:20px;background:#f5f5f5">
<div style="max-width:800px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.1)">
<div style="background:linear-gradient(135deg,${color} 0%,${color}dd 100%);color:white;padding:30px;text-align:center">
<h1 style="margin:0">${emoji} ${departamentoNome} - Onboarding concluído</h1>
</div>
<div style="padding:30px">
<div style="background:#f8f9fa;border-radius:8px;padding:20px;margin-bottom:20px">
<div><strong>Empresa:</strong> ${empresaNome}</div>
<div><strong>Responsável:</strong> ${responsavelNome}</div>
<div><strong>Session:</strong> <code>${sessionId}</code></div>
<div><strong>Data/Hora:</strong> ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</div>
</div>
${content}
<details style="margin-top:20px"><summary style="cursor:pointer;color:#1ECAA3;font-weight:600">Expandir todas as respostas (${Object.keys(respostas).length})</summary>
<table style="width:100%;border-collapse:collapse;margin-top:10px"><thead><tr><th style="background:#1ECAA3;color:white;padding:10px;text-align:left">Pergunta</th><th style="background:#1ECAA3;color:white;padding:10px;text-align:left">Resposta</th></tr></thead><tbody>${allRows}</tbody></table>
</details>
</div>
<div style="background:#f8f9fa;padding:20px;text-align:center;color:#666;font-size:12px">Sistema de onboarding Pipeelo · Session ${sessionId}</div>
</div></body></html>`;

    const emailResponse = await resend.emails.send({
      from: "Pipeelo Onboarding <noreply@pipeelo.com>",
      to: ["onboarding@pipeelo.com"],
      subject: `${emoji} Onboarding ${empresaNome} - ${departamentoNome}`,
      html,
    });

    return res.status(200).json({ success: true, emailResponse });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("send-email error:", message);
    return res.status(500).json({ error: message });
  }
}
