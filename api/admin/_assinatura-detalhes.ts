import type { VercelRequest, VercelResponse } from '@vercel/node';
import { assertAdminUser, AdminAuthError } from '../_lib/admin-auth';
import { getServiceSupabase } from '../_lib/supabase';
import { consultarAssinatura, detalhesAssinatura, type SessaoAssinatura } from '../_lib/assinatura';
import { getAssinaPdfConfig, urlArquivo } from '../_lib/assinapdf';
import { SELECT_ASSINATURA } from './_assinatura-enviar';

/**
 * GET /api/admin/assinatura-detalhes?session_id=…
 * Consulta o estado atual na AssinaPDF (atualiza a sessão se mudou) e devolve os
 * documentos enviados pelo assinante (selfie, documento, assinatura) para revisão.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    await assertAdminUser(req);
    const sessionId = Array.isArray(req.query.session_id) ? req.query.session_id[0] : req.query.session_id;
    if (!sessionId) return res.status(400).json({ error: 'session_id_obrigatorio' });

    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from('onboarding_sessions')
      .select(SELECT_ASSINATURA)
      .eq('id', sessionId)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'session_not_found' });
    if (!data.assinapdf_solicitacao_id) return res.status(409).json({ error: 'assinatura_nao_enviada' });

    const sessao = data as SessaoAssinatura & { empresa_nome?: string | null };
    const mudanca = await consultarAssinatura(supabase, sessao, { nomeEmpresa: sessao.empresa_nome ?? undefined });
    const docs = await detalhesAssinatura(sessao);
    const cfg = getAssinaPdfConfig();
    // `documentos` vem como lista ({doc,file,campo}) ou como mapa {campo: arquivo}; normaliza com URL.
    const signers = docs.signers.map((sg) => {
      const lista = Array.isArray(sg.documentos)
        ? sg.documentos
        : Object.entries(sg.documentos ?? {}).map(([campo, file]) => ({ doc: campo, file: String(file), campo }));
      const documentos = lista.map((d) => ({
        ...d,
        url: !d.file ? null : /^https?:\/\//.test(d.file) ? d.file : urlArquivo(cfg, d.file),
      }));
      return { ...sg, documentos };
    });
    return res.status(200).json({
      ok: true,
      estado: mudanca.estado,
      status: mudanca.mudou ? mudanca.status : sessao.assinatura_status,
      link: sessao.assinapdf_link,
      signers,
    });
  } catch (e: unknown) {
    if (e instanceof AdminAuthError) return res.status(e.status).json({ error: e.message });
    console.error('[admin/assinatura-detalhes]', e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'internal' });
  }
}
