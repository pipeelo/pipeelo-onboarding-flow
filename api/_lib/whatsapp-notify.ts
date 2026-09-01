/**
 * Notificação WhatsApp de conclusão do onboarding.
 *
 * Chamada fire-and-forget pelo complete-department logo após marcar um
 * departamento como concluído. Decide com base no `modo` da sessão se
 * deve disparar a mensagem agora.
 *
 * Idempotente via coluna `notificacao_conclusao_enviada_at`.
 */

import { findGroupByName, sendText, EvolutionConfigError } from './evolution';
import { getServiceSupabase } from './supabase';
import { buildIntegrationRequestMessage } from './integration-request';
import { addTeamToGroup } from './equipe-grupo';

const TEMPLATE_COMPLETO = (empresa: string) => `✅ *Onboarding concluído!*

${empresa}, recebemos todas as informações do seu provedor. Nosso time de implantação já está com o material e vai iniciar a configuração da sua *IA Pipeelo* nos próximos passos.

Em breve te chamamos com o cronograma de ativação. 🚀`;

const TEMPLATE_COMERCIAL = (empresa: string) => `✅ *CRM Pipeelo configurado!*

${empresa}, recebemos as configurações comerciais. Nosso time vai ativar o seu *CRM Pipeelo* e te chamar com os próximos passos da implantação. 🚀`;

type SessionRow = {
  id: string;
  empresa_nome: string;
  modo: 'completo' | 'comercial' | null;
  notificacao_conclusao_enviada_at: string | null;
  status_identificacao: string | null;
  status_sac_geral: string | null;
  status_financeiro: string | null;
  status_suporte: string | null;
  status_vendas: string | null;
  grupo_jid: string | null;
};

function isOnboardingFinished(s: SessionRow): boolean {
  const modo = s.modo ?? 'completo';
  if (modo === 'comercial') {
    // Comercial: exige Identificação (dados da empresa) + Vendas (CRM).
    return s.status_identificacao === 'concluido' && s.status_vendas === 'concluido';
  }
  return (
    s.status_identificacao === 'concluido' &&
    s.status_sac_geral === 'concluido' &&
    s.status_financeiro === 'concluido' &&
    s.status_suporte === 'concluido' &&
    s.status_vendas === 'concluido'
  );
}

/**
 * Verifica se a sessão acabou de fechar e dispara mensagem no grupo do
 * cliente. Roda em background (chamado sem await pelo handler).
 *
 * Retorna `{ skipped, reason }` se decidiu não disparar; `{ sent: true, group }`
 * se mandou.
 */
export async function maybeNotifyOnboardingComplete(
  sessionId: string
): Promise<
  | { sent: true; group: { id: string; name: string } }
  | { skipped: true; reason: string }
> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('onboarding_sessions')
    .select(
      'id, empresa_nome, modo, notificacao_conclusao_enviada_at, grupo_jid, cadastro, ' +
        'status_identificacao, status_sac_geral, status_financeiro, status_suporte, status_vendas'
    )
    .eq('id', sessionId)
    .maybeSingle<SessionRow>();

  if (error || !data) {
    return { skipped: true, reason: 'session_not_found' };
  }

  if (data.notificacao_conclusao_enviada_at) {
    return { skipped: true, reason: 'already_sent' };
  }

  if (!isOnboardingFinished(data)) {
    return { skipped: true, reason: 'not_finished_yet' };
  }

  // RPC atômica: marca notificacao_conclusao_enviada_at = now() se ainda for
  // NULL e retorna true. Resolve race condition (2 deptos concluídos quase
  // simultaneamente) — apenas UM caller recebe true e segue pro envio.
  const { data: claimed, error: claimErr } = await supabase.rpc(
    'claim_notification_send',
    { p_session_id: sessionId }
  );
  if (claimErr) {
    return { skipped: true, reason: `claim_failed: ${claimErr.message}` };
  }
  if (!claimed) {
    return { skipped: true, reason: 'already_sent_or_claimed' };
  }

  try {
    const group = data.grupo_jid
      ? { id: data.grupo_jid, subject: `Pipeelo & ${data.empresa_nome}` }
      : await findGroupByName(data.empresa_nome);
    if (!group) {
      // Sem grupo: libera o claim pra permitir retry futuro (ex: admin cria o grupo depois).
      await supabase.rpc('release_notification_claim', { p_session_id: sessionId });
      return { skipped: true, reason: 'group_not_found' };
    }

    const text =
      (data.modo ?? 'completo') === 'comercial'
        ? TEMPLATE_COMERCIAL(data.empresa_nome)
        : TEMPLATE_COMPLETO(data.empresa_nome);

    await sendText(group.id, text);

    // Segunda mensagem: pedido de liberação de IPs + cliente de testes +
    // credenciais faltantes (só modo completo). Falha aqui não desfaz o claim —
    // a notificação principal já foi entregue; admin reenvia manualmente se precisar.
    try {
      const integrationMsg = await buildIntegrationRequestMessage(supabase, sessionId, data.modo);
      if (integrationMsg) await sendText(group.id, integrationMsg);
    } catch (e) {
      console.error('[whatsapp-notify] pedido de integração falhou:', e);
    }

    // Equipe da seção "Equipe e Acessos" entra no grupo. Falha aqui não desfaz o claim.
    const nomeFantasia = ((data as { cadastro?: { nome_fantasia?: string } | null }).cadastro?.nome_fantasia) || data.empresa_nome;
    void addTeamToGroup(supabase, sessionId, group.id, nomeFantasia);

    return { sent: true, group: { id: group.id, name: group.subject } };
  } catch (e) {
    if (e instanceof EvolutionConfigError) {
      // Config faltando: libera o claim pra reenviar quando configurar.
      // Esse caminho só dispara antes de qualquer chamada HTTP — não há risco
      // de mensagem entregue.
      await supabase.rpc('release_notification_claim', { p_session_id: sessionId });
      return { skipped: true, reason: 'evolution_unconfigured' };
    }
    // sendText falhou (Evolution 5xx, rede, etc). NÃO libera o claim:
    // Evolution às vezes retorna 5xx com mensagem JÁ entregue. Preferimos
    // perder uma notificação a mandar duas. Admin pode disparar manualmente
    // se necessário via /api/admin/whatsapp-send-welcome.
    console.error('[whatsapp-notify] sendText falhou:', e);
    return { skipped: true, reason: 'send_failed' };
  }
}
