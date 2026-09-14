import { sendText } from './evolution';

async function notifyGrupo(envVar: 'STAFF_GROUP_JID' | 'SOCIOS_GROUP_JID', text: string): Promise<{ sent: boolean; reason?: string }> {
  const jid = process.env[envVar];
  if (!jid) {
    console.warn(`[staff-notify] ${envVar} não configurado; aviso pulado`);
    return { sent: false, reason: envVar === 'STAFF_GROUP_JID' ? 'staff_jid_unset' : 'socios_jid_unset' };
  }
  try {
    await sendText(jid, text);
    return { sent: true };
  } catch (e) {
    console.error('[staff-notify] falhou:', e);
    return { sent: false, reason: 'send_failed' };
  }
}

/** Aviso interno no grupo Staff Pipeelo. Nunca lança: aviso é acessório. */
export function notifyStaff(text: string): Promise<{ sent: boolean; reason?: string }> {
  return notifyGrupo('STAFF_GROUP_JID', text);
}

/** Aviso no grupo dos sócios — assinatura de contrato só chega aqui, não no Staff. */
export function notifySocios(text: string): Promise<{ sent: boolean; reason?: string }> {
  return notifyGrupo('SOCIOS_GROUP_JID', text);
}
