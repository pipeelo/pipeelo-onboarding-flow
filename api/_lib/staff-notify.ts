import { sendText } from './evolution';

/** Aviso interno no grupo Staff Pipeelo. Nunca lança: aviso é acessório. */
export async function notifyStaff(text: string): Promise<{ sent: boolean; reason?: string }> {
  const jid = process.env.STAFF_GROUP_JID;
  if (!jid) {
    console.warn('[staff-notify] STAFF_GROUP_JID não configurado; aviso pulado');
    return { sent: false, reason: 'staff_jid_unset' };
  }
  try {
    await sendText(jid, text);
    return { sent: true };
  } catch (e) {
    console.error('[staff-notify] falhou:', e);
    return { sent: false, reason: 'send_failed' };
  }
}
