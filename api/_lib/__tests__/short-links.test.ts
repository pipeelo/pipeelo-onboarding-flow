import { describe, it, expect, vi } from 'vitest';
import { ensureShortLink, onboardingTargetUrl } from '../short-links';

function makeSupabase(existing: { code: string; target_url: string } | null, insertErr: { code: string } | null = null) {
  const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
  const insert = vi.fn(async () => ({ error: insertErr }));
  const maybeSingle = vi.fn(async () => ({ data: existing, error: null }));
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), maybeSingle, update, insert };
  const from = vi.fn(() => chain);
  return { client: { from } as never, chain };
}

describe('ensureShortLink', () => {
  it('reaproveita o code existente e atualiza o target se mudou', async () => {
    const s = makeSupabase({ code: 'abc123', target_url: 'https://old' });
    const r = await ensureShortLink(s.client, { session_id: 'x', modo: 'completo', target_url: 'https://new' });
    expect(r).toEqual({ code: 'abc123', short_url: 'https://onboarding.pipeelo.com/s/abc123' });
    expect(s.chain.update).toHaveBeenCalledWith({ target_url: 'https://new' });
  });
  it('gera code novo de 6 chars quando não existe', async () => {
    const s = makeSupabase(null);
    const r = await ensureShortLink(s.client, { session_id: 'x', modo: 'completo', target_url: 'https://t', host: 'h.test', proto: 'http' });
    expect(r.code).toHaveLength(6);
    expect(r.short_url).toBe(`http://h.test/s/${r.code}`);
    expect(s.chain.insert).toHaveBeenCalled();
  });
  it('propaga erro que não é colisão', async () => {
    const s = makeSupabase(null, { code: '42P01' });
    await expect(ensureShortLink(s.client, { session_id: 'x', modo: 'completo', target_url: 'https://t' })).rejects.toBeTruthy();
  });
});

describe('onboardingTargetUrl', () => {
  it('monta URL completa com token', () => {
    expect(onboardingTargetUrl({ slug: 'abc', access_token: 'tok', modo: 'completo' }))
      .toBe('https://onboarding.pipeelo.com/abc?token=tok');
    expect(onboardingTargetUrl({ slug: 'abc', access_token: 'tok', modo: 'comercial' }))
      .toBe('https://onboarding.pipeelo.com/comercial/abc?token=tok');
  });
});
