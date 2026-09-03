import type { SupabaseClient } from '@supabase/supabase-js';
import {
  toJid, groupSubject, createGroup, updateParticipants, getParticipants, getInviteUrl,
  chaveNumero, fmtTelefone, temInstanciaDeGrupos, type InstanciaEvolution,
} from './evolution';
import { enfileirar, type NovoItem } from './evolution-fila';
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
  grupo_instancia?: InstanciaEvolution | null;
  notificacao_boas_vindas_enviada_at?: string | null;
};

export type ResultadoGrupo =
  | {
      status: 'criado'; jid: string; invite_url: string | null; nao_adicionados: string[];
      erros?: string[];
    }
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

/** JID real (como o WhatsApp devolve) de um número dentro do grupo, ou null. */
function jidNoGrupo(participantes: Iterable<string>, numero: string): string | null {
  const alvo = chaveNumero(numero);
  for (const p of participantes) if (chaveNumero(p) === alvo) return p;
  return null;
}

/** Hash estável de um conjunto de chaves — só para dar identidade ao item de resumo. */
function hashDe(valores: string[]): string {
  let h = 5381;
  for (const v of valores.slice().sort().join('|')) h = ((h << 5) + h + v.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

async function patch(supabase: SupabaseClient, id: string, data: Record<string, unknown>) {
  const { error } = await supabase.from('onboarding_sessions').update(data).eq('id', id);
  if (error) console.error('[cadastro-grupo] update falhou:', error.message);
}

/**
 * Modo de contenção: o grupo nasce só com o responsável da empresa e é ele quem
 * adiciona os demais. Tira do nosso número o que mais o expõe — adicionar gente
 * que nunca conversou com ele. Liga por env, sem deploy.
 */
export function somenteResponsavel(): boolean {
  return /^(1|true|sim)$/i.test(process.env.GRUPO_SOMENTE_RESPONSAVEL ?? '');
}

/** Mensagem no grupo pedindo que o responsável chame quem faltou. */
export function pedidoDeAdicionar(nome: string | null, faltantes: Array<{ nome: string; whatsapp: string }>): string {
  return [
    nome ? `👋 ${nome}, pode adicionar aqui no grupo, por favor:` : '👋 Pode adicionar aqui no grupo, por favor:',
    ...faltantes.map((f) => `• ${f.nome} — ${fmtTelefone(f.whatsapp)}`),
    '',
    'Assim todo mundo acompanha a implantação por aqui.',
  ].join('\n');
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
    ].join('\n');
  }

  const linhas = [
    `📋 Cadastro recebido: ${c.nome_fantasia}`,
    `✅ Grupo ${subject} criado — admin do cliente: ${c.responsavel_nome} (${fmtTelefone(c.responsavel_whatsapp)})`,
  ];
  linhas.push(
    r.invite_url
      ? `🔗 Equipe Pipeelo entra por aqui: ${r.invite_url}`
      : '🔗 Link do convite não veio — pegar pelo próprio grupo e repassar aqui'
  );
  if (somenteResponsavel()) {
    linhas.push('🔒 Modo contenção: só o responsável entrou; pedimos que ele chame os demais');
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
 * Cria (ou reaproveita) o grupo da sessão e deixa a fila cuidar do resto.
 *
 * No request ficam só as quatro chamadas baratas e visíveis: criar o grupo com os
 * contatos do cliente, conferir quem entrou, promover o admin e pegar o convite.
 * Adicionar a equipe Pipeelo e mandar as mensagens vira `evolution_fila`, drenada
 * a uma ação por vez — era a rajada de ~20 chamadas em menos de um minuto que
 * fazia o WhatsApp derrubar a conexão do número.
 *
 * Nunca lança: cada etapa registra a falha em `grupo_erro` e segue. Reexecutável:
 * com `grupo_jid` salvo, só enfileira quem falta (as chaves impedem duplicata).
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
  const itens: NovoItem[] = [];

  // No modo contenção o grupo nasce só com o responsável; os contatos extras
  // passam a ser problema dele, não do nosso número.
  const soResponsavel = somenteResponsavel();
  const esperadas = soResponsavel ? pessoas.filter((p) => p.admin) : pessoas;
  const faltantes = pessoas.filter((p) => !esperadas.includes(p));

  // Qual número opera este grupo. Grupo já existente mantém o dono original: o
  // número novo não é admin dos grupos criados pelo histórico.
  const instancia: InstanciaEvolution = groupJid
    ? sessao.grupo_instancia ?? 'padrao'
    : temInstanciaDeGrupos() ? 'grupos' : 'padrao';

  // 1. Criar o grupo (reaproveitar não custa chamada: os contatos que faltam vão pra fila)
  if (!groupJid) {
    try {
      const created = await createGroup(
        groupSubject(cadastro.nome_fantasia), soResponsavel ? [adminJid] : todosJids, instancia
      );
      groupJid = created.groupJid;
      inviteUrl = created.inviteCode ? `https://chat.whatsapp.com/${created.inviteCode}` : null;
      await patch(supabase, sessao.id, {
        grupo_jid: groupJid, grupo_invite_url: inviteUrl, grupo_instancia: instancia,
        grupo_criado_at: new Date().toISOString(), grupo_erro: null,
      });
    } catch (e) {
      const motivo = msg(e);
      await patch(supabase, sessao.id, { grupo_erro: motivo });
      const resultado: ResultadoGrupo = { status: 'erro', motivo };
      await notifyStaff(mensagemStaffCadastro(sessao, cadastro, resultado));
      return resultado;
    }
  }

  // 2. Uma única leitura de participantes serve para promover e para conferir quem entrou.
  let dentro: string[] = [];
  try {
    dentro = await getParticipants(groupJid, instancia);
  } catch (e) {
    erros.push(`participantes: ${msg(e)}`);
  }

  // 3. Promover admin — pelo JID real do participante (o WhatsApp pode tirar o nono dígito)
  try {
    await updateParticipants(groupJid, 'promote', [jidNoGrupo(dentro, adminJid) ?? adminJid], instancia);
  } catch (e) {
    erros.push(`promote: ${msg(e)}`);
  }

  // 4. Link de convite (se o create não devolveu), independente do resto
  if (!inviteUrl) {
    try {
      inviteUrl = await getInviteUrl(groupJid, instancia);
      await patch(supabase, sessao.id, { grupo_invite_url: inviteUrl });
    } catch (e) {
      erros.push(`convite: ${msg(e)}`);
    }
  }

  const naoAdicionados = esperadas.filter((p) => !jidNoGrupo(dentro, p.whatsapp)).map((p) => p.whatsapp);

  // 5. Quem ficou de fora recebe convite por e-mail — cada envio isolado, e só
  // é possível quando temos o link do grupo.
  if (inviteUrl) {
    const url = inviteUrl;
    for (const p of esperadas) {
      if (jidNoGrupo(dentro, p.whatsapp) || !p.email) continue;
      try {
        await sendTransactionalEmail({
          template: 'ConviteGrupo',
          sessionId: sessao.id,
          to: p.email,
          // Mesma chave que o item de resumo usa, para o convite nunca sair duas vezes.
          idempotencyKey: `convite-grupo:${sessao.id}:${chaveNumero(p.whatsapp)}`,
          props: { nome: p.nome, empresaNome: cadastro.nome_fantasia, grupoNome: groupSubject(cadastro.nome_fantasia), inviteUrl: url },
        });
      } catch (e) {
        erros.push(`email ${p.whatsapp}: ${msg(e)}`);
      }
    }
  }

  // 6. Boas-vindas entra na fila PRIMEIRO: é o link do onboarding, o cliente não
  // pode esperar a equipe inteira entrar para receber.
  if (!sessao.notificacao_boas_vindas_enviada_at) {
    try {
      const modo = sessao.modo ?? 'completo';
      const { short_url } = await ensureShortLink(supabase, {
        session_id: sessao.id, modo,
        target_url: onboardingTargetUrl({ slug: sessao.slug, access_token: sessao.access_token, modo }),
        host: opts.host, proto: opts.proto,
      });
      itens.push({
        sessionId: sessao.id, tipo: 'texto', grupoJid: groupJid, instancia,
        chave: `boas-vindas:${sessao.id}`, payload: { texto: WELCOME_TEMPLATE(short_url), rotulo: 'boas-vindas' },
      });
      await patch(supabase, sessao.id, { notificacao_boas_vindas_enviada_at: new Date().toISOString() });
    } catch (e) {
      erros.push(`boas-vindas: ${msg(e)}`);
    }
  }

  // 7. Quem deveria estar no grupo e não entrou vai pra fila (acontece em
  // reexecução). A equipe Pipeelo NÃO entra aqui: ela usa o link do convite que
  // vai na mensagem do Staff — adicionar dez desconhecidos era o que derrubava
  // o número.
  const esperados: Array<{ jid: string; nome: string; email?: string }> = [];
  for (const p of esperadas) {
    if (jidNoGrupo(dentro, p.whatsapp)) continue;
    const jid = jidPor.get(p.whatsapp)!;
    esperados.push({ jid, nome: p.nome, email: p.email });
    itens.push({
      sessionId: sessao.id, tipo: 'add', grupoJid: groupJid, instancia,
      chave: `add:${sessao.id}:${chaveNumero(jid)}`, payload: { jid, rotulo: p.nome },
    });
  }

  // 8. No modo contenção, quem ficou de fora é pedido ao responsável em vez de
  // adicionado por nós.
  if (soResponsavel && faltantes.length > 0) {
    itens.push({
      sessionId: sessao.id, tipo: 'texto', grupoJid: groupJid, instancia,
      chave: `pedido-adicionar:${sessao.id}`,
      payload: { texto: pedidoDeAdicionar(cadastro.responsavel_nome, faltantes), rotulo: 'pedido de adicionar' },
    });
  }

  // 9. Aviso final ao Staff quando a fila desta sessão terminar. A chave carrega o
  // conjunto enfileirado, então uma reexecução que traz gente nova gera um resumo
  // novo, e uma que não traz ninguém não gera nada.
  const adds = itens.filter((i) => i.tipo === 'add');
  if (adds.length > 0) {
    itens.push({
      sessionId: sessao.id, tipo: 'resumo', grupoJid: groupJid, instancia,
      chave: `resumo:${sessao.id}:${hashDe(adds.map((a) => a.chave))}`,
      payload: { empresa: cadastro.nome_fantasia, esperados, inviteUrl: inviteUrl ?? undefined },
    });
  }

  await enfileirar(supabase, itens);

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
