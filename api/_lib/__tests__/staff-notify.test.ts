import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../evolution', () => ({ sendText: vi.fn(async () => ({ ok: true })) }));
import { sendText } from '../evolution';
import { notifyStaff, notifySocios } from '../staff-notify';

describe('notifyStaff', () => {
  beforeEach(() => { vi.clearAllMocks(); delete process.env.STAFF_GROUP_JID; delete process.env.SOCIOS_GROUP_JID; });

  it('pula sem STAFF_GROUP_JID', async () => {
    const r = await notifyStaff('oi');
    expect(r).toEqual({ sent: false, reason: 'staff_jid_unset' });
    expect(sendText).not.toHaveBeenCalled();
  });
  it('envia para o JID configurado', async () => {
    process.env.STAFF_GROUP_JID = '1@g.us';
    const r = await notifyStaff('oi');
    expect(r).toEqual({ sent: true });
    expect(sendText).toHaveBeenCalledWith('1@g.us', 'oi');
  });
  it('não lança quando a Evolution falha', async () => {
    process.env.STAFF_GROUP_JID = '1@g.us';
    (sendText as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('x'));
    const r = await notifyStaff('oi');
    expect(r).toEqual({ sent: false, reason: 'send_failed' });
  });
});

describe('notifySocios', () => {
  beforeEach(() => { vi.clearAllMocks(); delete process.env.STAFF_GROUP_JID; delete process.env.SOCIOS_GROUP_JID; });

  it('pula sem SOCIOS_GROUP_JID e não cai no Staff', async () => {
    process.env.STAFF_GROUP_JID = '1@g.us';
    const r = await notifySocios('oi');
    expect(r).toEqual({ sent: false, reason: 'socios_jid_unset' });
    expect(sendText).not.toHaveBeenCalled();
  });
  it('envia para o JID dos sócios', async () => {
    process.env.SOCIOS_GROUP_JID = '2@g.us';
    const r = await notifySocios('oi');
    expect(r).toEqual({ sent: true });
    expect(sendText).toHaveBeenCalledWith('2@g.us', 'oi');
  });
});
