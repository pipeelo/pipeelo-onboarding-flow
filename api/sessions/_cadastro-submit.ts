import type { VercelRequest, VercelResponse } from '@vercel/node';
import { CadastroSubmitSchema } from '../_lib/schemas/cadastro';
import { assertSessionAccess, HttpError } from '../_lib/auth-session';
import { getServiceSupabase } from '../_lib/supabase';
import { createSessionLimiter } from '../_lib/ratelimit';
import type { SessaoGrupo } from '../_lib/cadastro-grupo';
import { enviarInstrucoesGrupo } from '../_lib/grupo-instrucoes';
import { processarPosCadastro, type SessaoPosCadastro } from '../_lib/pos-cadastro';

type Row = SessaoGrupo & SessaoPosCadastro & {
  cadastro_enviado_at?: string | null;
  grupo_invite_url?: string | null;
  grupo_erro?: string | null;
};

function estadoAtual(session: Row) {
  return {
    ok: true as const,
    // Sem grupo_jid não é erro do cliente: o grupo é criado à mão pelo time a partir
    // do roteiro que foi para o Staff.
    grupo: session.grupo_jid
      ? { status: 'criado' as const, jid: session.grupo_jid, invite_url: session.grupo_invite_url ?? null, nao_adicionados: [] }
      : { status: 'manual' as const },
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
    // A sessão já está autenticada por slug+token; se o Upstash cair, seguimos
    // sem limitar em vez de derrubar o cadastro (fail-open). Um { success: false }
    // real ainda bloqueia com 429.
    try {
      const { success } = await createSessionLimiter().limit(`cadastro:${ip}`);
      if (!success) return res.status(429).json({ error: 'rate_limited' });
    } catch (e) {
      console.warn('[cadastro-submit] rate limit indisponível, seguindo sem limitar:', e instanceof Error ? e.message : String(e));
    }

    if (session.cadastro_enviado_at) {
      return res.status(200).json(estadoAtual(session));
    }

    const supabase = getServiceSupabase();
    const enviadoEm = new Date().toISOString();
    const { data, error } = await supabase
      .from('onboarding_sessions')
      .update({ cadastro: body.cadastro, cadastro_enviado_at: enviadoEm })
      .eq('id', session.id)
      .is('cadastro_enviado_at', null)
      .select('id');
    if (error) {
      console.error('[sessions/cadastro-submit] update falhou:', error.message);
      throw new HttpError(500, 'internal');
    }

    // 0 linhas afetadas: outra requisição concorrente já reivindicou o envio entre o
    // assertSessionAccess e este UPDATE. Relê a sessão uma vez pra tentar pegar o
    // grupo que a requisição vencedora acabou de criar, em vez do estado carregado
    // antes da corrida (que ainda não tinha grupo_jid).
    if (!data || data.length === 0) {
      let atual: Row = session;
      if (!session.grupo_jid) {
        const { data: fresh } = await supabase
          .from('onboarding_sessions')
          .select('grupo_jid, grupo_invite_url, grupo_erro')
          .eq('id', session.id)
          .maybeSingle<Pick<Row, 'grupo_jid' | 'grupo_invite_url' | 'grupo_erro'>>();
        if (fresh) atual = { ...session, ...fresh };
      }
      return res.status(200).json(estadoAtual(atual));
    }

    // O grupo NÃO é mais criado pela API (10/09/2026): a instância de grupos levou
    // bloqueio 403 do WhatsApp no meio de um cadastro. Em vez disso, o Lucas recebe o
    // roteiro no Staff e cria o grupo à mão. O pós-cadastro segue em background — o
    // link de assinatura vai por DM para o responsável, não depende do grupo.
    void enviarInstrucoesGrupo(supabase, session, body.cadastro, {
      host: req.headers.host,
      proto: req.headers['x-forwarded-proto'] as string | undefined,
    })
      .catch((e) => { console.error('[cadastro-submit] instruções de grupo:', e); })
      .then(() => processarPosCadastro(supabase, { ...session, cadastro_enviado_at: enviadoEm }, body.cadastro))
      .catch(console.error);

    return res.status(200).json({ ok: true, grupo: { status: 'manual' as const } });
  } catch (e: unknown) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    const err = e as { name?: string; flatten?: () => unknown };
    if (err.name === 'ZodError') return res.status(400).json({ error: 'invalid_payload', details: err.flatten?.() });
    console.error('[sessions/cadastro-submit]', e);
    return res.status(500).json({ error: 'internal' });
  }
}
