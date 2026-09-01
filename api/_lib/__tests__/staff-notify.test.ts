import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../evolution', () => ({ sendText: vi.fn(async () => ({ ok: true })) }));
import { sendText } from '../evolution';
import { notifyStaff } from '../staff-notify';

describe('notifyStaff', () => {
  beforeEach(() => { vi.clearAllMocks(); delete process.env.STAFF_GROUP_JID; });

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
