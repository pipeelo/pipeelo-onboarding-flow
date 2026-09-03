import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase } from '../_lib/supabase';
import { getParticipants, chaveNumero } from '../_lib/evolution';
import { enviarBoasVindasNoGrupo, type SessaoGrupo } from '../_lib/cadastro-grupo';
import { CadastroSchema } from '../_lib/schemas/cadastro';
import { notifyStaff } from '../_lib/staff-notify';

/**
 * As boas-vindas ficam seguradas até o cliente entrar no grupo (decisão do Felipe,
 * 03/09/2026): mensagem em grupo sem ele não tem leitor, porque o WhatsApp não
 * mostra histórico para quem entra depois. Como hoje a API muitas vezes não
 * consegue adicionar ninguém, o cliente entra pelo convite — e este cron é quem
 * percebe a entrada e manda a mensagem.
 *
 * Auth: Authorization Bearer ${CRON_SECRET}.
 */
export type ResultadoBoasVindas = { verificadas: number; enviadas: number; erros: string[] };

export async function enviarBoasVindasPendentes(): Promise<ResultadoBoasVindas> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('onboarding_sessions')
    .select('id, slug, access_token, empresa_nome, modo, grupo_jid, cadastro, notificacao_boas_vindas_enviada_at')
    .not('grupo_jid', 'is', null)
    .not('cadastro', 'is', null)
    .is('notificacao_boas_vindas_enviada_at', null);
  if (error) throw new Error(`listar sessões: ${error.message}`);

  const erros: string[] = [];
  let enviadas = 0;
  for (const s of data ?? []) {
    try {
      const cadastro = CadastroSchema.parse(s.cadastro);
      const dentro = await getParticipants(s.grupo_jid as string);
      const alvo = chaveNumero(cadastro.responsavel_whatsapp);
      if (!dentro.some((p) => chaveNumero(p) === alvo)) continue;

      await enviarBoasVindasNoGrupo(supabase, s as SessaoGrupo, s.grupo_jid as string, {
        host: (process.env.PUBLIC_BASE_URL ?? 'https://onboarding.pipeelo.com').replace(/^https?:\/\//, ''),
        proto: 'https',
      });
      enviadas++;
      await notifyStaff(`✅ ${cadastro.nome_fantasia}: ${cadastro.responsavel_nome} entrou no grupo e as boas-vindas com o link do onboarding foram enviadas.`);
    } catch (e) {
      erros.push(`${s.slug ?? s.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { verificadas: data?.length ?? 0, enviadas, erros };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (!expected || req.headers.authorization !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const r = await enviarBoasVindasPendentes();
    return res.status(200).json({ ok: true, ...r });
  } catch (e) {
    console.error('[cron/grupo-boas-vindas]', e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'internal' });
  }
}
