import type { SupabaseClient } from '@supabase/supabase-js';
import { toJid, updateParticipants, getParticipants, getInviteUrl, groupSubject } from './evolution';
import { notifyStaff } from './staff-notify';
import { sendTransactionalEmail } from './email-sender';

type PessoaEquipe = { nome?: string; email?: string; whatsapp?: string; adicionar_grupo?: string };

/**
 * Lê `equipe_pessoas` (sac_geral) e adiciona ao grupo quem tem WhatsApp e marcou
 * "adicionar ao grupo". Quem não entrou (privacidade) recebe o convite por e-mail.
 * Nunca lança.
 */
export async function addTeamToGroup(
  supabase: SupabaseClient,
  sessionId: string,
  groupJid: string,
  empresaNome: string
): Promise<{ adicionados: number; total: number; nao_adicionados: string[] }> {
  const vazio = { adicionados: 0, total: 0, nao_adicionados: [] as string[] };
  try {
    const { data, error } = await supabase
      .from('onboarding_respostas')
      .select('pergunta_id, valor')
      .eq('session_id', sessionId)
      .in('pergunta_id', ['equipe_pessoas']);
    if (error) throw error;
    const raw = data?.find((r) => r.pergunta_id === 'equipe_pessoas')?.valor;
    const lista: PessoaEquipe[] = Array.isArray(raw) ? raw : [];

    const alvo: Array<{ nome: string; email?: string; jid: string }> = [];
    for (const p of lista) {
      if ((p.adicionar_grupo ?? 'sim') !== 'sim' || !p.whatsapp) continue;
      const digitos = p.whatsapp.replace(/\D/g, '');
      if (digitos.length !== 10 && digitos.length !== 11) continue; // número inválido: ignora
      try {
        alvo.push({ nome: p.nome?.trim() || p.email || 'sem nome', email: p.email?.trim() || undefined, jid: toJid(digitos) });
      } catch { /* número inválido: ignora */ }
    }
    if (alvo.length === 0) return vazio;

    await updateParticipants(groupJid, 'add', alvo.map((a) => a.jid));
    const dentro = new Set(await getParticipants(groupJid));
    const fora = alvo.filter((a) => !dentro.has(a.jid));

    if (fora.length) {
      const inviteUrl = await getInviteUrl(groupJid);
      for (const f of fora) {
        if (!f.email) continue;
        await sendTransactionalEmail({
          template: 'ConviteGrupo', sessionId, to: f.email,
          idempotencyKey: `convite-grupo:${sessionId}:${f.jid}`,
          props: { nome: f.nome, empresaNome, grupoNome: groupSubject(empresaNome), inviteUrl },
        });
      }
    }

    const resumo = { adicionados: alvo.length - fora.length, total: alvo.length, nao_adicionados: fora.map((f) => f.nome) };
    const linhas = [`👥 Equipe adicionada ao grupo ${groupSubject(empresaNome)}: ${resumo.adicionados} de ${resumo.total}`];
    if (fora.length) linhas.push(`Não entraram (privacidade): ${resumo.nao_adicionados.join(', ')} — convite enviado por e-mail`);
    await notifyStaff(linhas.join('\n'));
    return resumo;
  } catch (e) {
    console.error('[equipe-grupo] falhou:', e);
    await notifyStaff(`⚠️ Não consegui adicionar a equipe ao grupo de ${empresaNome}: ${e instanceof Error ? e.message : String(e)}`);
    return vazio;
  }
}
