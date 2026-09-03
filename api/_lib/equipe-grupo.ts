import type { SupabaseClient } from '@supabase/supabase-js';
import { toJid, chaveNumero, type InstanciaEvolution } from './evolution';
import { somenteResponsavel, pedidoDeAdicionar } from './cadastro-grupo';
import { enfileirar, type NovoItem } from './evolution-fila';
import { notifyStaff } from './staff-notify';

type PessoaEquipe = { nome?: string; email?: string; whatsapp?: string; adicionar_grupo?: string };

export type OpcoesEquipe = {
  empresaNome: string;
  /** Número dono do grupo. Grupo antigo continua no histórico, que é admin dele. */
  instancia?: InstanciaEvolution;
  /** Link do convite, usado no e-mail de quem a privacidade do WhatsApp barrar. */
  inviteUrl?: string | null;
  /** A quem pedir que adicione a equipe, no modo contenção. */
  responsavelNome?: string | null;
};

/**
 * Lê `equipe_pessoas` (sac_geral) e ENFILEIRA a entrada no grupo de quem tem
 * WhatsApp e marcou "adicionar ao grupo".
 *
 * Antes isto mandava a equipe inteira num único `updateParticipants` — era o
 * ponto sem nenhuma cadência do fluxo, e sem tratamento de `rate-overlimit`.
 * Agora cada pessoa é um item da fila, e o convite por e-mail para quem não
 * entrou (privacidade do WhatsApp) sai no item de resumo, depois que os adds
 * terminarem — só aí dá para saber quem ficou de fora.
 *
 * Com `GRUPO_SOMENTE_RESPONSAVEL` ligado, ninguém é adicionado por nós: o grupo
 * recebe um pedido para o responsável chamar a equipe.
 *
 * Nunca lança.
 */
export async function addTeamToGroup(
  supabase: SupabaseClient,
  sessionId: string,
  groupJid: string,
  opts: OpcoesEquipe
): Promise<{ enfileirados: number; total: number }> {
  const vazio = { enfileirados: 0, total: 0 };
  const { empresaNome, instancia = 'padrao', inviteUrl, responsavelNome } = opts;
  try {
    const { data, error } = await supabase
      .from('onboarding_respostas')
      .select('pergunta_id, valor')
      .eq('session_id', sessionId)
      .in('pergunta_id', ['equipe_pessoas']);
    if (error) throw error;
    const raw = data?.find((r) => r.pergunta_id === 'equipe_pessoas')?.valor;
    const lista: PessoaEquipe[] = Array.isArray(raw) ? raw : [];

    const alvo: Array<{ nome: string; email?: string; whatsapp: string; jid: string }> = [];
    for (const p of lista) {
      if ((p.adicionar_grupo || 'sim') !== 'sim' || !p.whatsapp) continue;
      try {
        alvo.push({
          nome: p.nome?.trim() || p.email || 'sem nome',
          email: p.email?.trim() || undefined,
          whatsapp: p.whatsapp,
          jid: toJid(p.whatsapp),
        });
      } catch { /* número inválido: ignora */ }
    }
    if (alvo.length === 0) return vazio;

    if (somenteResponsavel()) {
      await enfileirar(supabase, [{
        sessionId, tipo: 'texto', grupoJid: groupJid, instancia,
        chave: `pedido-equipe:${sessionId}`,
        payload: {
          texto: pedidoDeAdicionar(responsavelNome ?? null, alvo.map((a) => ({ nome: a.nome, whatsapp: a.whatsapp }))),
          rotulo: 'pedido de adicionar equipe',
        },
      }]);
      await notifyStaff(
        `🔒 Equipe de ${empresaNome}: modo contenção ligado — pedimos ao responsável que adicione as ${alvo.length} pessoas.`
      );
      return { enfileirados: 0, total: alvo.length };
    }

    const itens: NovoItem[] = alvo.map((a) => ({
      sessionId, tipo: 'add' as const, grupoJid: groupJid, instancia,
      chave: `add:${sessionId}:${chaveNumero(a.jid)}`,
      payload: { jid: a.jid, rotulo: a.nome },
    }));
    itens.push({
      sessionId, tipo: 'resumo', grupoJid: groupJid, instancia,
      chave: `resumo-equipe:${sessionId}`,
      payload: {
        empresa: empresaNome,
        inviteUrl: inviteUrl ?? undefined,
        esperados: alvo.map((a) => ({ jid: a.jid, nome: a.nome, email: a.email })),
      },
    });
    await enfileirar(supabase, itens);

    await notifyStaff(
      `👥 Equipe de ${empresaNome} na fila do grupo: ${alvo.length} pessoa${alvo.length === 1 ? '' : 's'} entrando aos poucos — aviso quando terminar.`
    );
    return { enfileirados: alvo.length, total: alvo.length };
  } catch (e) {
    console.error('[equipe-grupo] falhou:', e);
    await notifyStaff(`⚠️ Não consegui enfileirar a equipe no grupo de ${empresaNome}: ${e instanceof Error ? e.message : String(e)}`);
    return vazio;
  }
}
