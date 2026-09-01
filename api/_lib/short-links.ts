import type { SupabaseClient } from '@supabase/supabase-js';

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // sem 0/o/O/1/l/I
const CODE_LEN = 6;
const MAX_RETRIES = 5;

export function generateCode(len = CODE_LEN): string {
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

export type Modo = 'completo' | 'comercial';

export function onboardingTargetUrl(s: { slug: string; access_token?: string | null; modo: Modo }): string {
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '') || 'https://onboarding.pipeelo.com';
  const path = s.modo === 'comercial' ? `comercial/${s.slug}` : s.slug;
  return s.access_token ? `${base}/${path}?token=${s.access_token}` : `${base}/${path}`;
}

/**
 * Idempotente por (session_id, modo): devolve o mesmo code se já existe (atualizando
 * o target se mudou); senão insere um code novo, tentando de novo em colisão (23505).
 */
export async function ensureShortLink(
  supabase: SupabaseClient,
  input: { session_id: string; modo: Modo; target_url: string; host?: string; proto?: string }
): Promise<{ code: string; short_url: string }> {
  const host = input.host ?? 'onboarding.pipeelo.com';
  const proto = input.proto ?? 'https';

  const { data: existing, error: existingErr } = await supabase
    .from('short_links')
    .select('code, target_url')
    .eq('session_id', input.session_id)
    .eq('modo', input.modo)
    .maybeSingle();
  if (existingErr) throw existingErr;

  if (existing) {
    if (existing.target_url !== input.target_url) {
      await supabase.from('short_links').update({ target_url: input.target_url }).eq('code', existing.code);
    }
    return { code: existing.code, short_url: `${proto}://${host}/s/${existing.code}` };
  }

  for (let i = 0; i < MAX_RETRIES; i++) {
    const candidate = generateCode();
    const { error } = await supabase.from('short_links').insert({
      code: candidate, target_url: input.target_url, session_id: input.session_id, modo: input.modo,
    });
    if (!error) return { code: candidate, short_url: `${proto}://${host}/s/${candidate}` };
    if ((error as { code?: string }).code !== '23505') throw error;
  }
  throw new Error('shortlink_generation_failed');
}
