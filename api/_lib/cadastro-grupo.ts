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
  | { status: 'criado'; jid: string; invite_url: string | null; nao_adicionados: string[]; erros?: string[] }
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

export function mensagemStaffCadastro(s: SessaoGrupo, c: Cadastro, r: ResultadoGrupo): string {
  const subject = groupSubject(c.nome_fantasia);
  const grupo = r.status === 'criado' ? `${subject} (criado ✅)` : `${subject} (falhou ❌ ${r.motivo})`;
  const docs = c.doc_contrato_social.length + c.doc_responsaveis.length;
  const linhas = [
    `📋 Cadastro recebido: ${c.nome_fantasia}`,
    `Grupo: ${grupo}`,
    `Admin: ${c.responsavel_nome} — ${c.responsavel_whatsapp}`,
    `Documentos: ${docs} arquivo${docs === 1 ? '' : 's'}`,
    `Contrato → ${c.contrato_email} · Vencimento dia ${c.dia_vencimento}`,
    `Painel: ${(process.env.PUBLIC_BASE_URL ?? 'https://onboarding.pipeelo.com').replace(/\/+$/, '')}/admin?s=${s.slug}`,
  ];
  if (r.status === 'criado' && r.nao_adicionados.length) {
    // Só o responsável tem e-mail no Cadastro; contatos extras não têm campo de e-mail.
    const comEmail = r.nao_adicionados.filter((w) => w === c.responsavel_whatsapp);
    const semEmail = r.nao_adicionados.filter((w) => w !== c.responsavel_whatsapp);
    if (comEmail.length) {
      linhas.push(`Não entraram (privacidade): ${comEmail.join(', ')} — convite enviado por e-mail`);
    }
    if (semEmail.length) {
      linhas.push(`Sem e-mail para convite (chamar manualmente): ${semEmail.join(', ')}`);
    }
  }
  if (r.status === 'criado' && r.erros?.length) {
    linhas.push(`⚠️ Falhas: ${r.erros.join(' | ')}`);
  }
  return linhas.join('\n');
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

  // 2. Promover admin
  try {
    await updateParticipants(groupJid, 'promote', [adminJid]);
  } catch (e) {
    erros.push(`promote: ${msg(e)}`);
  }

  // 3. Conferir quem entrou; quem ficou de fora recebe convite por e-mail
  let naoAdicionados: string[] = [];
  try {
    if (!inviteUrl) inviteUrl = await getInviteUrl(groupJid);
    const dentro = new Set(await getParticipants(groupJid));
    naoAdicionados = pessoas.filter((p) => !dentro.has(jidPor.get(p.whatsapp)!)).map((p) => p.whatsapp);
    for (const p of pessoas) {
      if (dentro.has(jidPor.get(p.whatsapp)!) || !p.email) continue;
      await sendTransactionalEmail({
        template: 'ConviteGrupo',
        sessionId: sessao.id,
        to: p.email,
        idempotencyKey: `convite-grupo:${sessao.id}:${p.whatsapp}`,
        props: { nome: p.nome, empresaNome: cadastro.nome_fantasia, grupoNome: groupSubject(cadastro.nome_fantasia), inviteUrl },
      });
    }
    if (inviteUrl) await patch(supabase, sessao.id, { grupo_invite_url: inviteUrl });
  } catch (e) {
    erros.push(`conferencia: ${msg(e)}`);
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
