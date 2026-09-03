import type { SupabaseClient } from '@supabase/supabase-js';
import {
  toJid, groupSubject, createGroup, updateParticipants, getParticipants, getInviteUrl, sendText, chaveNumero,
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

const esperar = (ms: number) => (process.env.VITEST ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

/**
 * RITMO HUMANO (03/09/2026). O número Avisos foi deslogado pelo WhatsApp (401) depois
 * de criar dois grupos e disparar dezenas de chamadas de participante em poucos
 * segundos. Uma pessoa não faz isso: ela cria o grupo, olha a tela, adiciona um
 * contato, espera, adiciona outro. Toda etapa daqui em diante tem pausa ALEATÓRIA —
 * cadência fixa também tem cara de robô.
 *
 * O preço é o tempo: com a equipe cheia a criação passa de um minuto. Por isso o
 * `cadastro-submit` não espera mais por ela (roda em background).
 */
const RITMO = {
  aposCriarGrupo: [6_000, 14_000],
  entreParticipantes: [8_000, 20_000],
  antesDePromover: [4_000, 9_000],
  antesDoConvite: [3_000, 7_000],
  antesDasBoasVindas: [5_000, 12_000],
  aposRateLimit: [25_000, 45_000],
} as const;

/** Pausa com jitter dentro da faixa. Em teste não espera nada. */
export function sortearPausa([min, max]: readonly [number, number]): number {
  return Math.round(min + Math.random() * (max - min));
}

const pausar = (faixa: readonly [number, number]) => esperar(sortearPausa(faixa));

/**
 * Adiciona um número por vez, com pausa longa e aleatória entre cada um. Em rate
 * limit espera bem mais e tenta uma vez só. Devolve quem falhou.
 */
export async function adicionarUmPorUm(groupJid: string, jids: string[]): Promise<string[]> {
  const falhas: string[] = [];
  for (const [i, jid] of jids.entries()) {
    if (i > 0) await pausar(RITMO.entreParticipantes);
    try {
      await updateParticipants(groupJid, 'add', [jid]);
    } catch (e) {
      if (/rate-overlimit/i.test(msg(e))) {
        await pausar(RITMO.aposRateLimit);
        try { await updateParticipants(groupJid, 'add', [jid]); continue; } catch (e2) { falhas.push(`${jid}: ${msg(e2)}`); }
      } else {
        falhas.push(`${jid}: ${msg(e)}`);
      }
    }
  }
  return falhas;
}

/** JID real (como o WhatsApp devolve) de um número dentro do grupo, ou null. */
function jidNoGrupo(participantes: Iterable<string>, numero: string): string | null {
  const alvo = chaveNumero(numero);
  for (const p of participantes) if (chaveNumero(p) === alvo) return p;
  return null;
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

/**
 * Convite por WhatsApp para quem a API não conseguiu adicionar. Sai pela instância
 * principal (DM), que é o número que o cliente já conhece.
 */
export function mensagemConviteGrupo(nome: string, empresa: string, inviteUrl: string): string {
  const primeiro = (nome || '').trim().split(/\s+/)[0] || '';
  return [
    `Olá${primeiro ? `, ${primeiro}` : ''}! Aqui é a Pipeelo. 👋`,
    '',
    `Criamos o grupo *${groupSubject(empresa)}* no WhatsApp para tocar a implantação com você.`,
    'A configuração de privacidade do seu WhatsApp não permitiu que a gente te adicionasse direto, então entre por este link:',
    '',
    inviteUrl,
  ].join('\n');
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
    ].join('\n');
  }

  const linhas = [
    `📋 Cadastro recebido: ${c.nome_fantasia}`,
    `✅ Grupo ${subject} criado — admin do cliente: ${c.responsavel_nome} (${fmtTelefone(c.responsavel_whatsapp)})`,
  ];
  if (r.equipe_pipeelo) {
    const { adicionados, total } = r.equipe_pipeelo;
    linhas.push(adicionados === total ? `👥 Equipe Pipeelo no grupo: ${total} de ${total}` : `👥 Equipe Pipeelo no grupo: ${adicionados} de ${total} — ver falhas abaixo`);
    // Quem não entrou pela API entra pelo convite. Sem o link aqui, o time fica
    // dependendo de alguém abrir o painel para descobrir como entrar.
    if (adicionados < total && r.invite_url) linhas.push(`🔗 Entrar no grupo: ${r.invite_url}`);
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
  let equipe: { adicionados: number; total: number } | undefined;

  // 1. Criar (ou reaproveitar) o grupo
  try {
    if (groupJid) {
      // Um por um, mesmo aqui: adicionar o bloco inteiro de uma vez é o padrão que
      // derrubou o número antes.
      const falhas = await adicionarUmPorUm(groupJid, todosJids);
      if (falhas.length) erros.push(`contatos do cliente: ${falhas.join('; ')}`);
    } else {
      const created = await createGroup(groupSubject(cadastro.nome_fantasia), todosJids);
      groupJid = created.groupJid;
      inviteUrl = created.inviteCode ? `https://chat.whatsapp.com/${created.inviteCode}` : null;
      await patch(supabase, sessao.id, {
        grupo_jid: groupJid, grupo_invite_url: inviteUrl, grupo_criado_at: new Date().toISOString(), grupo_erro: null,
      });
      // Grupo recém-criado: ninguém sai adicionando gente no mesmo segundo.
      await pausar(RITMO.aposCriarGrupo);
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
      const jaNoGrupo = await getParticipants(groupJid);
      const doCliente = (j: string) => todosJids.some((c) => chaveNumero(c) === chaveNumero(j));
      const alvo = equipePipeelo.filter((j) => !doCliente(j));
      const faltam = alvo.filter((j) => !jidNoGrupo(jaNoGrupo, j));
      const falhas = await adicionarUmPorUm(groupJid, faltam);
      const depois = await getParticipants(groupJid);
      equipe = { adicionados: alvo.filter((j) => jidNoGrupo(depois, j)).length, total: alvo.length };
      if (falhas.length) erros.push(`equipe pipeelo: ${falhas.join('; ')}`);
    } catch (e) {
      erros.push(`equipe pipeelo: ${msg(e)}`);
    }
  } else {
    console.warn('[cadastro-grupo] STAFF_GROUP_JID não configurado; equipe Pipeelo não adicionada');
  }

  // 2. Promover admin — pelo JID real do participante (o WhatsApp pode tirar o nono dígito)
  await pausar(RITMO.antesDePromover);
  try {
    const atuais = await getParticipants(groupJid);
    await updateParticipants(groupJid, 'promote', [jidNoGrupo(atuais, adminJid) ?? adminJid]);
  } catch (e) {
    erros.push(`promote: ${msg(e)}`);
  }

  // 3a. Buscar o link de convite (se ainda não temos), independente do resto
  if (!inviteUrl) {
    await pausar(RITMO.antesDoConvite);
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
    naoAdicionados = pessoas.filter((p) => !jidNoGrupo(dentro, p.whatsapp)).map((p) => p.whatsapp);
  } catch (e) {
    erros.push(`participantes: ${msg(e)}`);
  }

  // 3c. Quem ficou de fora recebe o convite: WhatsApp primeiro (chega na hora e
  // todo contato tem número), e-mail como segunda via para quem tem endereço.
  // Adicionar pela API falha por privacidade do destinatário e, desde 09/2026,
  // também por restrição do WhatsApp ao número que administra o grupo — o convite
  // é o caminho que sempre funciona.
  if (inviteUrl) {
    const url = inviteUrl;
    for (const p of pessoas) {
      if (jidNoGrupo(dentro, p.whatsapp)) continue;
      try {
        await sendText(toJid(p.whatsapp), mensagemConviteGrupo(p.nome, cadastro.nome_fantasia, url));
      } catch (e) {
        erros.push(`convite whatsapp ${p.whatsapp}: ${msg(e)}`);
      }
    }
    for (const p of pessoas) {
      if (jidNoGrupo(dentro, p.whatsapp) || !p.email) continue;
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
    // Escrever a mensagem leva tempo para uma pessoa.
    await pausar(RITMO.antesDasBoasVindas);
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
