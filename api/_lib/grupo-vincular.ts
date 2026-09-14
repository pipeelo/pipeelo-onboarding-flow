import type { SupabaseClient } from '@supabase/supabase-js';
import { chaveNumero, groupSubject, type GrupoDaPrincipal } from './evolution';
import { notifyStaff } from './staff-notify';
import { CadastroSchema } from './schemas/cadastro';

/**
 * VÍNCULO AUTOMÁTICO DO GRUPO CRIADO À MÃO (14/09/2026).
 *
 * Desde 10/09 o Lucas cria o grupo do cliente pelo celular. Decisão do Felipe em
 * 14/09: o trabalho dele é SÓ criar o grupo. Quem descobre o grupo, grava o
 * `grupo_jid` na sessão e manda as boas-vindas é o sistema.
 *
 * Como achar o grupo: nome exato "Pipeelo & {nome fantasia}" (sem diferença de
 * acento, caixa ou espaço), criado depois do cadastro. A folga cobre relógio
 * torto e grupo criado minutos antes de o cliente apertar "enviar".
 * A Trixnet teve dois grupos com o mesmo nome no mesmo dia: por isso, havendo
 * mais de um, vale o que tem o responsável dentro e, entre esses, o mais novo — e
 * o Staff fica sabendo qual foi escolhido.
 */

const FOLGA_ANTES_DO_CADASTRO_MS = 6 * 60 * 60 * 1000;

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export type Escolha = { grupo: GrupoDaPrincipal; candidatos: number };

export function escolherGrupo(
  grupos: GrupoDaPrincipal[],
  nomeFantasia: string,
  responsavelWhatsapp: string,
  cadastroEnviadoEm: string | null,
): Escolha | null {
  const alvo = normalizar(groupSubject(nomeFantasia));
  const desde = cadastroEnviadoEm ? Date.parse(cadastroEnviadoEm) - FOLGA_ANTES_DO_CADASTRO_MS : null;

  const candidatos = grupos.filter((g) => {
    if (normalizar(g.subject) !== alvo) return false;
    if (desde === null || g.creation === null) return true;
    return g.creation * 1000 >= desde;
  });
  if (candidatos.length === 0) return null;

  const chave = chaveNumero(responsavelWhatsapp);
  const comResponsavel = candidatos.filter((g) => g.participantes.some((p) => chaveNumero(p) === chave));
  const base = comResponsavel.length > 0 ? comResponsavel : candidatos;
  const grupo = [...base].sort((a, b) => (b.creation ?? 0) - (a.creation ?? 0))[0];
  return { grupo, candidatos: candidatos.length };
}

export type ResultadoVinculo = { pendentes: number; vinculados: string[]; erros: string[] };

/** Grava o grupo nas sessões que ainda esperam o Lucas. Nunca lança por sessão. */
export async function vincularGruposManuais(
  supabase: SupabaseClient,
  grupos: GrupoDaPrincipal[],
): Promise<ResultadoVinculo> {
  const { data, error } = await supabase
    .from('onboarding_sessions')
    .select('id, slug, empresa_nome, cadastro, cadastro_enviado_at')
    .is('grupo_jid', null)
    .not('cadastro', 'is', null)
    .not('grupo_instrucoes_enviadas_at', 'is', null);
  if (error) throw new Error(`listar sessões sem grupo: ${error.message}`);

  const vinculados: string[] = [];
  const erros: string[] = [];
  for (const s of data ?? []) {
    try {
      const cadastro = CadastroSchema.parse(s.cadastro);
      const escolha = escolherGrupo(grupos, cadastro.nome_fantasia, cadastro.responsavel_whatsapp, s.cadastro_enviado_at);
      if (!escolha) continue;

      const criadoEm = escolha.grupo.creation ? new Date(escolha.grupo.creation * 1000).toISOString() : new Date().toISOString();
      const { error: e } = await supabase
        .from('onboarding_sessions')
        .update({ grupo_jid: escolha.grupo.id, grupo_criado_at: criadoEm, grupo_erro: null })
        .eq('id', s.id)
        .is('grupo_jid', null);
      if (e) throw new Error(e.message);

      vinculados.push(escolha.grupo.id);
      if (escolha.candidatos > 1) {
        await notifyStaff(
          `⚠️ ${cadastro.nome_fantasia}: achei ${escolha.candidatos} grupos "${escolha.grupo.subject}". ` +
            `Vinculei o mais novo com o responsável dentro (${escolha.grupo.id}). Se for o errado, avise.`,
        );
      }
    } catch (e) {
      erros.push(`${s.slug ?? s.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { pendentes: data?.length ?? 0, vinculados, erros };
}
