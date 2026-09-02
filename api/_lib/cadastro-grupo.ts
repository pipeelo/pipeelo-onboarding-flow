import type { SupabaseClient } from '@supabase/supabase-js';
import {
  toJid, groupSubject, createGroup, updateParticipants, getParticipants, getInviteUrl, sendText,
} from './evolution';
import { ensureShortLink, onboardingTargetUrl } from './short-links';
import { WELCOME_TEMPLATE } from './welcome-template';
import { notifyStaff } from './staff-notify';
import { sendTransactionalEmail } from './email-sender';
import type { Cadastro } from './schemas/cadastro';

export type SessaoGrupo = {
  id: string;
  slug: string;
  access_token: string | null;
  empresa_nome: string;
  modo: 'completo' | 'comercial' | null;
  grupo_jid?: string | null;
  notificacao_boas_vindas_enviada_at?: string | null;
};

export type ResultadoGrupo =
  | { status: 'criado'; jid: string; invite_url: string | null; nao_adicionados: string[]; erros?: string[]; equipe_pipeelo?: { adicionados: number; total: number } }
  | { status: 'erro'; motivo: string };

type Pessoa = { nome: string; whatsapp: string; email?: string; admin: boolean };

function pessoasDoCadastro(c: Cadastro): Pessoa[] {
  return [
    { nome: c.responsavel_nome, whatsapp: c.responsavel_whatsapp, email: c.responsavel_email, admin: true },
    ...c.contatos_extras.map((x) => ({ nome: x.nome, whatsapp: x.whatsapp, admin: false })),
  ];
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function patch(supabase: SupabaseClient, id: string, data: Record<string, unknown>) {
  const { error } = await supabase.from('onboarding_sessions').update(data).eq('id', id);
  if (error) console.error('[cadastro-grupo] update falhou:', error.message);
}

function fmtTelefone(d: string): string {
  const n = d.replace(/\D/g, '');
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return d;
}

/** Traduz o erro bruto (JSON da Evolution, env faltando) para uma frase curta. */
export function resumirErro(e: string): string {
  if (/RESEND_API_KEY/.test(e)) return 'e-mail de convite não configurado (RESEND_API_KEY)';
  const m = e.match(/"status":\s*(\d{3})/);
  if (m) return `Evolution respondeu ${m[1]}`;
  return e.length > 120 ? `${e.slice(0, 117)}…` : e;
}

export function mensagemStaffCadastro(s: SessaoGrupo, c: Cadastro, r: ResultadoGrupo): string {
  const subject = groupSubject(c.nome_fantasia);
  const base = (process.env.PUBLIC_BASE_URL ?? 'https://onboarding.pipeelo.com').replace(/\/+$/, '');
  const docs = c.doc_contrato_social.length + c.doc_responsaveis.length;
  const nomePor = new Map<string, string>([[c.responsavel_whatsapp, c.responsavel_nome], ...c.contatos_extras.map((x) => [x.whatsapp, x.nome] as [string, string])]);

  if (r.status === 'erro') {
    return [
      `📋 Cadastro recebido: ${c.nome_fantasia}`,
      `❌ Grupo ${subject} NÃO foi criado: ${resumirErro(r.motivo)}`,
      `Contato: ${c.responsavel_nome} — ${fmtTelefone(c.responsavel_whatsapp)}`,
      `Ação: abrir ${base}/admin e clicar em "Recriar grupo".`,
    ].join('
');
  }

  const linhas = [
    `📋 Cadastro recebido: ${c.nome_fantasia}`,
    `✅ Grupo ${subject} criado — admin do cliente: ${c.responsavel_nome} (${fmtTelefone(c.responsavel_whatsapp)})`,
  ];
  if (r.equipe_pipeelo) {
    const { adicionados, total } = r.equipe_pipeelo;
    linhas.push(adicionados === total ? `👥 Equipe Pipeelo no grupo: ${total} de ${total}` : `👥 Equipe Pipeelo no grupo: ${adicionados} de ${total} — ver falhas abaixo`);
  }
  linhas.push(`📎 ${docs} documento${docs === 1 ? '' : 's'} · contrato → ${c.contrato_email} · vencimento dia ${c.dia_vencimento}`);
  linhas.push(`Painel: ${base}/admin`);

  if (r.nao_adicionados.length) {
    // Só o responsável tem e-mail no Cadastro; contatos extras não têm campo de e-mail.
    const emailOk = !r.erros?.some((e) => /^email /.test(e));
    linhas.push('', 'Não entraram no grupo (privacidade do WhatsApp):');
    for (const w of r.nao_adicionados) {
      const nome = nomePor.get(w) ?? 'contato';
      const temEmail = w === c.responsavel_whatsapp;
      const fim = temEmail && emailOk ? 'convite enviado por e-mail' : 'sem convite por e-mail, chamar manualmente';
      linhas.push(`• ${nome} — ${fmtTelefone(w)} — ${fim}`);
    }
  }
  if (r.erros?.length) {
    linhas.push('', `⚠️ Falhas: ${r.erros.map(resumirErro).join(' | ')}`);
  }
  return linhas.join('
');
}

/**
 * Cria (ou reaproveita) o grupo da sessão, promove o contato principal, confere quem
 * entrou, manda boas-vindas e avisa o Staff. Nunca lança: cada etapa registra a falha
 * em `grupo_erro` e segue. Reexecutável: com `grupo_jid` já salvo, só adiciona quem
 * falta e pula a boas-vindas já enviada.
 */
export async function criarGrupoParaSessao(
  supabase: SupabaseClient,
  sessao: SessaoGrupo,
  cadastro: Cadastro,
  opts: { host?: string; proto?: string } = {}
): Promise<ResultadoGrupo> {
  const pessoas = pessoasDoCadastro(cadastro);
  const jidPor = new Map(pessoas.map((p) => [p.whatsapp, toJid(p.whatsapp)]));
  const todosJids = [...jidPor.values()];
  const adminJid = jidPor.get(cadastro.responsavel_whatsapp)!;
  const erros: string[] = [];
  let groupJid = sessao.grupo_jid ?? null;
  let inviteUrl: string | null = null;
  let equipe: { adicionados: number; total: number } | undefined;

  // 1. Criar (ou reaproveitar) o grupo
  try {
    if (groupJid) {
      await updateParticipants(groupJid, 'add', todosJids);
    } else {
      const created = await createGroup(groupSubject(cadastro.nome_fantasia), todosJids);
      groupJid = created.groupJid;
      inviteUrl = created.inviteCode ? `https://chat.whatsapp.com/${created.inviteCode}` : null;
      await patch(supabase, sessao.id, {
        grupo_jid: groupJid, grupo_invite_url: inviteUrl, grupo_criado_at: new Date().toISOString(), grupo_erro: null,
      });
    }
  } catch (e) {
    const motivo = msg(e);
    await patch(supabase, sessao.id, { grupo_erro: motivo });
    const resultado: ResultadoGrupo = { status: 'erro', motivo };
    await notifyStaff(mensagemStaffCadastro(sessao, cadastro, resultado));
    return resultado;
  }

  // 1b. Equipe Pipeelo: todo mundo que está no grupo Staff entra no grupo do cliente.
  // Falha aqui não bloqueia; fica em grupo_erro e o Staff é avisado.
  const staffJid = process.env.STAFF_GROUP_JID;
  if (staffJid) {
    try {
      const equipePipeelo = await getParticipants(staffJid);
      const jaNoGrupo = new Set(await getParticipants(groupJid));
      const faltam = equipePipeelo.filter((j) => !jaNoGrupo.has(j) && !todosJids.includes(j));
      await updateParticipants(groupJid, 'add', faltam);
      const depois = new Set(await getParticipants(groupJid));
      const alvo = equipePipeelo.filter((j) => !todosJids.includes(j));
      equipe = { adicionados: alvo.filter((j) => depois.has(j)).length, total: alvo.length };
    } catch (e) {
      erros.push(`equipe pipeelo: ${msg(e)}`);
    }
  } else {
    console.warn('[cadastro-grupo] STAFF_GROUP_JID não configurado; equipe Pipeelo não adicionada');
  }

  // 2. Promover admin
  try {
    await updateParticipants(groupJid, 'promote', [adminJid]);
  } catch (e) {
    erros.push(`promote: ${msg(e)}`);
  }

  // 3a. Buscar o link de convite (se ainda não temos), independente do resto
  if (!inviteUrl) {
    try {
      inviteUrl = await getInviteUrl(groupJid);
      await patch(supabase, sessao.id, { grupo_invite_url: inviteUrl });
    } catch (e) {
      erros.push(`convite: ${msg(e)}`);
    }
  }

  // 3b. Conferir quem entrou — falha aqui não impede o convite por e-mail abaixo
  let naoAdicionados: string[] = [];
  let dentro = new Set<string>();
  try {
    dentro = new Set(await getParticipants(groupJid));
    naoAdicionados = pessoas.filter((p) => !dentro.has(jidPor.get(p.whatsapp)!)).map((p) => p.whatsapp);
  } catch (e) {
    erros.push(`participantes: ${msg(e)}`);
  }

  // 3c. Quem ficou de fora recebe convite por e-mail — cada envio isolado, e só
  // é possível quando temos o link do grupo.
  if (inviteUrl) {
    const url = inviteUrl;
    for (const p of pessoas) {
      if (dentro.has(jidPor.get(p.whatsapp)!) || !p.email) continue;
      try {
        await sendTransactionalEmail({
          template: 'ConviteGrupo',
          sessionId: sessao.id,
          to: p.email,
          idempotencyKey: `convite-grupo:${sessao.id}:${p.whatsapp}`,
          props: { nome: p.nome, empresaNome: cadastro.nome_fantasia, grupoNome: groupSubject(cadastro.nome_fantasia), inviteUrl: url },
        });
      } catch (e) {
        erros.push(`email ${p.whatsapp}: ${msg(e)}`);
      }
    }
  }

  // 4. Boas-vindas com link curto do onboarding (uma vez só)
  if (!sessao.notificacao_boas_vindas_enviada_at) {
    try {
      const modo = sessao.modo ?? 'completo';
      const { short_url } = await ensureShortLink(supabase, {
        session_id: sessao.id, modo,
        target_url: onboardingTargetUrl({ slug: sessao.slug, access_token: sessao.access_token, modo }),
        host: opts.host, proto: opts.proto,
      });
      await sendText(groupJid, WELCOME_TEMPLATE(short_url));
      await patch(supabase, sessao.id, { notificacao_boas_vindas_enviada_at: new Date().toISOString() });
    } catch (e) {
      erros.push(`boas-vindas: ${msg(e)}`);
    }
  }

  // Sempre grava o estado final de grupo_erro — limpa uma falha anterior quando a
  // reexecução dá certo (ex.: reaproveitar grupo depois de um erro de promote).
  await patch(supabase, sessao.id, { grupo_erro: erros.length ? erros.join(' | ') : null });

  const resultado: ResultadoGrupo = {
    status: 'criado', jid: groupJid, invite_url: inviteUrl, nao_adicionados: naoAdicionados,
    erros: erros.length ? erros : undefined,
  };
  await notifyStaff(mensagemStaffCadastro(sessao, cadastro, resultado));
  return resultado;
}
