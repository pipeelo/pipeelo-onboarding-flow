import type { SupabaseClient } from '@supabase/supabase-js';
import { groupSubject } from './evolution';
import { notifyStaff } from './staff-notify';

type PessoaEquipe = {
  nome?: string; email?: string; whatsapp?: string; adicionar_grupo?: string; papel?: string; departamentos?: string;
};

type PlanilhaEquipe = { path?: string; nome_original?: string; tamanho?: number };

/**
 * EQUIPE DO CLIENTE NO GRUPO: SÓ PELAS MÃOS DO LUCAS (Felipe, 16/09/2026).
 *
 * Até aqui o sistema adicionava sozinho quem marcou "adicionar ao grupo" na seção
 * Equipe e Acessos. Escrita de participante em grupo é o que derruba e bane número (a
 * instância `Grupos` foi banida em 14/09, e a OLV TELECOM falhou em 16/09 com "The
 * Grupos instance does not exist"). Agora o onboarding NÃO chama a Evolution para isso:
 * manda no Staff a lista com nome e telefone para o Lucas adicionar, igual ao roteiro de
 * criação do grupo (`grupo-instrucoes.ts`). Nunca lança.
 *
 * questions.json 4.0 (17/09/2026): a equipe chega SÓ pela planilha modelo
 * (`equipe_planilha_upload`, bucket onboarding-uploads). O onboarding não lê o .xlsx no
 * servidor: o Staff recebe o nome do arquivo e o caminho para baixar no /admin. Sessões
 * antigas que ainda têm `equipe_pessoas` (formulário) continuam saindo como lista.
 */
export async function pedirEquipeNoGrupo(
  supabase: SupabaseClient,
  sessionId: string,
  empresaNome: string
): Promise<{ total: number; enviado: boolean }> {
  try {
    const { data, error } = await supabase
      .from('onboarding_respostas')
      .select('pergunta_id, valor')
      .eq('session_id', sessionId)
      .in('pergunta_id', ['equipe_pessoas', 'equipe_planilha_upload']);
    if (error) throw error;

    const planilha = data?.find((r) => r.pergunta_id === 'equipe_planilha_upload')?.valor as PlanilhaEquipe | undefined;
    if (planilha && typeof planilha === 'object' && planilha.path) {
      const r = await notifyStaff(mensagemPlanilhaEquipe(empresaNome, planilha));
      return { total: 1, enviado: r.sent };
    }

    const raw = data?.find((r) => r.pergunta_id === 'equipe_pessoas')?.valor;
    const lista: PessoaEquipe[] = Array.isArray(raw) ? raw : [];
    const alvo = lista.filter((p) => (p.adicionar_grupo || 'sim') === 'sim' && p.whatsapp?.trim());
    if (alvo.length === 0) return { total: 0, enviado: false };

    const texto = mensagemEquipeNoGrupo(empresaNome, alvo);
    const r = await notifyStaff(texto);
    return { total: alvo.length, enviado: r.sent };
  } catch (e) {
    console.error('[equipe-grupo] falhou:', e);
    await notifyStaff(
      `⚠️ ${empresaNome} concluiu o onboarding, mas não consegui montar a lista da equipe para o grupo: `
      + `${e instanceof Error ? e.message : String(e)}. Confiram a seção Equipe e Acessos no /admin.`,
    ).catch(() => undefined);
    return { total: 0, enviado: false };
  }
}

function fmtTelefone(bruto: string): string {
  let n = bruto.replace(/\D/g, '');
  if ((n.length === 12 || n.length === 13) && n.startsWith('55')) n = n.slice(2);
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return bruto.trim();
}

const PAPEL_LABEL: Record<string, string> = {
  administrador: 'administrador(a)',
  gerente: 'gerente',
  gestor: 'gestor(a)',
};

export function mensagemEquipeNoGrupo(empresaNome: string, pessoas: PessoaEquipe[]): string {
  const linhas = pessoas.map((p) => {
    const extra = [p.papel ? PAPEL_LABEL[p.papel] ?? null : null, p.departamentos?.trim() || null].filter(Boolean).join(', ');
    return `• ${p.nome?.trim() || p.email || 'sem nome'}${extra ? ` (${extra})` : ''} — ${fmtTelefone(p.whatsapp ?? '')}`;
  });
  return [
    `👥 *Equipe da ${empresaNome} para entrar no grupo*`,
    '',
    `*Lucas*, o cliente concluiu o onboarding. Adicione no grupo *${groupSubject(empresaNome)}* as pessoas que ele marcou para entrar:`,
    '',
    ...linhas,
    '',
    'Se alguém não puder ser adicionado por causa da privacidade do WhatsApp, mande o link de convite do grupo para a pessoa.',
  ].join('\n');
}

export function mensagemPlanilhaEquipe(empresaNome: string, planilha: PlanilhaEquipe): string {
  const nome = planilha.nome_original?.trim() || 'planilha da equipe';
  return [
    `👥 *Equipe da ${empresaNome} — planilha enviada*`,
    '',
    `*Lucas*, o cliente concluiu o onboarding e mandou a equipe pela planilha modelo (*${nome}*).`,
    'Baixe o arquivo na seção Equipe e Acessos do /admin, crie os acessos (papel Administrador / Gerente / Atendente e departamentos de cada um)',
    `e adicione no grupo *${groupSubject(empresaNome)}* quem tiver WhatsApp na planilha.`,
    '',
    'Se alguém não puder ser adicionado por causa da privacidade do WhatsApp, mande o link de convite do grupo para a pessoa.',
  ].join('\n');
}
