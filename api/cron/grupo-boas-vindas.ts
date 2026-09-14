import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase } from '../_lib/supabase';
import { getParticipants, chaveNumero, listarGruposDaPrincipal, type GrupoDaPrincipal } from '../_lib/evolution';
import { vincularGruposManuais } from '../_lib/grupo-vincular';
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
 * Desde 14/09/2026 o cron também VINCULA o grupo criado à mão pelo Lucas: acha o
 * grupo pelo nome na lista do Avisos, grava o `grupo_jid` e, na mesma rodada, as
 * boas-vindas saem. O Lucas só cria o grupo.
 *
 * Roda como WATCHER no `server/index.ts` (a cada `GRUPO_WATCHER_SEGUNDOS`, padrão
 * 20 s): o Felipe quer a mensagem na sequência da criação do grupo. Para não ler a
 * lista de grupos do Avisos a cada 20 s à toa, a rodada só vai à Evolution quando
 * existe sessão esperando grupo ou esperando boas-vindas — duas contagens no banco.
 *
 * Auth: Authorization Bearer ${CRON_SECRET}.
 */
export type ResultadoBoasVindas = {
  verificadas: number;
  vinculados: string[];
  enviadas: number;
  erros: string[];
  /** true quando não havia nada esperando e a Evolution nem foi consultada. */
  ocioso?: boolean;
};

/** Há sessão com cadastro esperando o Lucas criar o grupo ou esperando as boas-vindas? */
export async function existePendenciaDeGrupo(supabase: ReturnType<typeof getServiceSupabase>): Promise<boolean> {
  const semGrupo = await supabase
    .from('onboarding_sessions')
    .select('id', { count: 'exact', head: true })
    .is('grupo_jid', null)
    .not('cadastro', 'is', null)
    .not('grupo_instrucoes_enviadas_at', 'is', null);
  if (semGrupo.error) throw new Error(`contar sessões sem grupo: ${semGrupo.error.message}`);
  if ((semGrupo.count ?? 0) > 0) return true;

  const semBoasVindas = await supabase
    .from('onboarding_sessions')
    .select('id', { count: 'exact', head: true })
    .not('grupo_jid', 'is', null)
    .not('cadastro', 'is', null)
    .is('notificacao_boas_vindas_enviada_at', null);
  if (semBoasVindas.error) throw new Error(`contar sessões sem boas-vindas: ${semBoasVindas.error.message}`);
  return (semBoasVindas.count ?? 0) > 0;
}

export async function enviarBoasVindasPendentes(): Promise<ResultadoBoasVindas> {
  const supabase = getServiceSupabase();
  if (!(await existePendenciaDeGrupo(supabase))) {
    return { verificadas: 0, vinculados: [], enviadas: 0, erros: [], ocioso: true };
  }
  const erros: string[] = [];

  // Uma leitura da lista de grupos serve para vincular e para saber quem está dentro.
  let grupos: GrupoDaPrincipal[] | null = null;
  let vinculados: string[] = [];
  try {
    grupos = await listarGruposDaPrincipal();
    const v = await vincularGruposManuais(supabase, grupos);
    vinculados = v.vinculados;
    erros.push(...v.erros);
  } catch (e) {
    erros.push(`vincular grupos: ${e instanceof Error ? e.message : String(e)}`);
  }

  const { data, error } = await supabase
    .from('onboarding_sessions')
    .select('id, slug, access_token, empresa_nome, modo, grupo_jid, cadastro, notificacao_boas_vindas_enviada_at')
    .not('grupo_jid', 'is', null)
    .not('cadastro', 'is', null)
    .is('notificacao_boas_vindas_enviada_at', null);
  if (error) throw new Error(`listar sessões: ${error.message}`);

  let enviadas = 0;
  for (const s of data ?? []) {
    try {
      const cadastro = CadastroSchema.parse(s.cadastro);
      const daLista = grupos?.find((g) => g.id === s.grupo_jid);
      const dentro = daLista ? daLista.participantes : await getParticipants(s.grupo_jid as string);
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
  return { verificadas: data?.length ?? 0, vinculados, enviadas, erros };
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
