import type { SupabaseClient } from '@supabase/supabase-js';
import { groupSubject } from './evolution';
import { fmtTelefone, type SessaoGrupo } from './cadastro-grupo';
import { ensureShortLink, onboardingTargetUrl } from './short-links';
import { WELCOME_TEMPLATE } from './welcome-template';
import { notifyStaff } from './staff-notify';
import type { Cadastro } from './schemas/cadastro';

/**
 * CRIAÇÃO MANUAL DO GRUPO (10/09/2026).
 *
 * A instância `Grupos` (551152414872) levou bloqueio 403 do WhatsApp no instante em
 * que tentou criar o grupo da GOLDFIBRA — doze segundos depois do cadastro entrar, com
 * a conta ociosa e antes de qualquer adição de participante. Foi o segundo grupo do
 * dia: o primeiro (TRIX NET) nasceu normal. Nenhum ritmo humano resolve bloqueio de
 * conta, então o onboarding parou de criar grupo e passou a mandar o roteiro para o
 * Lucas no grupo Staff.
 *
 * O aviso sai pela instância que estiver no grupo Staff (`sendText` sonda antes), então
 * continua funcionando com a `Grupos` fora do ar.
 */

const PAINEL = () => (process.env.PUBLIC_BASE_URL ?? 'https://onboarding.pipeelo.com').replace(/\/+$/, '');

type Contato = { nome: string; whatsapp: string; admin: boolean };

function contatosDoCadastro(c: Cadastro): Contato[] {
  return [
    { nome: c.responsavel_nome, whatsapp: c.responsavel_whatsapp, admin: true },
    ...c.contatos_extras.map((x) => ({ nome: x.nome, whatsapp: x.whatsapp, admin: false })),
  ];
}

/**
 * O roteiro que o Lucas segue no grupo Staff: nome do grupo, quem entra, quem vira
 * admin e a mensagem pronta para colar. Tudo numerado — quem lê não precisa decidir
 * nada nem abrir o painel para completar a tarefa.
 */
export function mensagemInstrucoesGrupo(cadastro: Cadastro, shortUrl: string): string {
  const contatos = contatosDoCadastro(cadastro);
  const docs = cadastro.doc_contrato_social.length + cadastro.doc_responsaveis.length;

  const linhas = [
    `🆕 *Novo cliente: ${cadastro.nome_fantasia}*`,
    '',
    '*Lucas*, o grupo deste cliente é criado à mão. Passo a passo:',
    '',
    '*1) Criar o grupo com este nome exato:*',
    groupSubject(cadastro.nome_fantasia),
    '',
    '*2) Adicionar os contatos do cliente:*',
    ...contatos.map((p) => `• ${p.nome} — ${fmtTelefone(p.whatsapp)}${p.admin ? ' — *deixar como admin*' : ''}`),
    '',
    '*3) Adicionar a equipe Pipeelo* — a mesma turma que está aqui no Staff.',
    '',
    '*4) Mandar esta mensagem no grupo:*',
    '- - - - - - - - - -',
    WELCOME_TEMPLATE(shortUrl),
    '- - - - - - - - - -',
    '',
    `📎 ${docs} documento${docs === 1 ? '' : 's'} · contrato → ${cadastro.contrato_email} · vencimento dia ${cadastro.dia_vencimento}`,
    `Painel: ${PAINEL()}/admin`,
  ];
  return linhas.join('\n');
}

/**
 * Gera o link do formulário e manda o roteiro no Staff. Nunca lança: o cadastro do
 * cliente não pode falhar porque o aviso interno falhou. Devolve o que aconteceu para
 * quem chamou registrar.
 */
export async function enviarInstrucoesGrupo(
  supabase: SupabaseClient,
  sessao: SessaoGrupo,
  cadastro: Cadastro,
  opts: { host?: string; proto?: string } = {},
): Promise<{ status: 'enviado' | 'falhou'; short_url?: string; motivo?: string }> {
  try {
    const modo = sessao.modo ?? 'completo';
    const { short_url } = await ensureShortLink(supabase, {
      session_id: sessao.id,
      modo,
      target_url: onboardingTargetUrl({ slug: sessao.slug, access_token: sessao.access_token, modo }),
      host: opts.host,
      proto: opts.proto,
    });

    const { sent, reason } = await notifyStaff(mensagemInstrucoesGrupo(cadastro, short_url));
    const agora = new Date().toISOString();
    // `grupo_erro` guarda o motivo de o Staff não ter recebido — é o que o painel mostra.
    const { error } = await supabase
      .from('onboarding_sessions')
      .update(
        sent
          ? { grupo_instrucoes_enviadas_at: agora, grupo_erro: null }
          : { grupo_erro: `instruções não chegaram ao Staff: ${reason ?? 'desconhecido'}` },
      )
      .eq('id', sessao.id);
    if (error) console.error('[grupo-instrucoes] update falhou:', error.message);

    if (!sent) return { status: 'falhou', short_url, motivo: reason };
    return { status: 'enviado', short_url };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.error('[grupo-instrucoes] falhou:', motivo);
    await supabase
      .from('onboarding_sessions')
      .update({ grupo_erro: `instruções de grupo: ${motivo}` })
      .eq('id', sessao.id);
    return { status: 'falhou', motivo };
  }
}
