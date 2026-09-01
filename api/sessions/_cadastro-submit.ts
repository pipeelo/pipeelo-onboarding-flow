import type { VercelRequest, VercelResponse } from '@vercel/node';
import { CadastroSubmitSchema } from '../_lib/schemas/cadastro';
import { assertSessionAccess, HttpError } from '../_lib/auth-session';
import { getServiceSupabase } from '../_lib/supabase';
import { createSessionLimiter } from '../_lib/ratelimit';
import { criarGrupoParaSessao, type SessaoGrupo } from '../_lib/cadastro-grupo';

type Row = SessaoGrupo & {
  cadastro_enviado_at?: string | null;
  grupo_invite_url?: string | null;
  grupo_erro?: string | null;
};

function estadoAtual(session: Row) {
  return {
    ok: true as const,
    grupo: session.grupo_jid
      ? { status: 'criado' as const, jid: session.grupo_jid, invite_url: session.grupo_invite_url ?? null, nao_adicionados: [] }
      : { status: 'erro' as const, motivo: session.grupo_erro ?? 'grupo_nao_criado' },
  };
}

/**
 * POST /api/sessions/cadastro-submit — salva o cadastro e dispara a criação do grupo.
 * Idempotente: segundo envio devolve o estado atual sem tocar na Evolution. A trava
 * contra corrida (dois POSTs concorrentes) é o próprio UPDATE: só quem ganha a
 * corrida (`cadastro_enviado_at IS NULL`) segue para criar o grupo; quem perde
 * recebe o estado atual, igual ao caminho idempotente.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const body = CadastroSubmitSchema.parse(req.body);
    const session = (await assertSessionAccess(body.slug, body.token)) as Row;

    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? 'unknown';
    const { success } = await createSessionLimiter().limit(`cadastro:${ip}`);
    if (!success) return res.status(429).json({ error: 'rate_limited' });

    if (session.cadastro_enviado_at) {
      return res.status(200).json(estadoAtual(session));
    }

    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from('onboarding_sessions')
      .update({ cadastro: body.cadastro, cadastro_enviado_at: new Date().toISOString() })
      .eq('id', session.id)
      .is('cadastro_enviado_at', null)
      .select('id');
    if (error) {
      console.error('[sessions/cadastro-submit] update falhou:', error.message);
      throw new HttpError(500, 'internal');
    }

    // 0 linhas afetadas: outra requisição concorrente já reivindicou o envio entre o
    // assertSessionAccess e este UPDATE. Devolve o estado já carregado, sem criar grupo.
    if (!data || data.length === 0) {
      return res.status(200).json(estadoAtual(session));
    }

    const grupo = await criarGrupoParaSessao(supabase, session, body.cadastro, {
      host: req.headers.host,
      proto: req.headers['x-forwarded-proto'] as string | undefined,
    });
    return res.status(200).json({ ok: true, grupo });
  } catch (e: unknown) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    const err = e as { name?: string; flatten?: () => unknown };
    if (err.name === 'ZodError') return res.status(400).json({ error: 'invalid_payload', details: err.flatten?.() });
    console.error('[sessions/cadastro-submit]', e);
    return res.status(500).json({ error: 'internal' });
  }
}
