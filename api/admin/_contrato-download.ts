import type { VercelRequest, VercelResponse } from '@vercel/node';
import { assertAdminUser, AdminAuthError } from '../_lib/admin-auth';
import { getServiceSupabase } from '../_lib/supabase';
import { CONTRATO_BUCKET } from '../_lib/contrato';

/** Uma hora é o bastante para abrir e baixar o `.docx` sem deixar link vazando. */
const EXPIRA_EM_SEGUNDOS = 60 * 60;

/**
 * GET /api/admin/contrato-download?session_id=…&tipo=docx|pdf|assinado
 *   200 { url } — link assinado (60 min) do bucket privado `onboarding-contratos`.
 *   Com `redirect=1`, responde 302 direto para o arquivo.
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
      .select('id, contrato_path, contrato_pdf_path, contrato_assinado_path')
      .eq('id', sessionId)
      .maybeSingle<{ id: string; contrato_path: string | null; contrato_pdf_path: string | null; contrato_assinado_path: string | null }>();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'session_not_found' });

    const tipo = (Array.isArray(req.query.tipo) ? req.query.tipo[0] : req.query.tipo) || 'docx';
    const caminho = tipo === 'assinado' ? data.contrato_assinado_path : tipo === 'pdf' ? data.contrato_pdf_path : data.contrato_path;
    if (!caminho) return res.status(409).json({ error: tipo === 'assinado' ? 'contrato_assinado_indisponivel' : 'contrato_nao_gerado' });

    const { data: assinado, error: erroUrl } = await supabase.storage
      .from(CONTRATO_BUCKET)
      .createSignedUrl(caminho, EXPIRA_EM_SEGUNDOS);
    if (erroUrl || !assinado?.signedUrl) {
      return res.status(500).json({ error: erroUrl?.message ?? 'signed_url_falhou' });
    }

    const redirect = Array.isArray(req.query.redirect) ? req.query.redirect[0] : req.query.redirect;
    if (redirect === '1') {
      res.setHeader('Location', assinado.signedUrl);
      return res.status(302).end();
    }
    return res.status(200).json({ url: assinado.signedUrl });
  } catch (e: unknown) {
    if (e instanceof AdminAuthError) return res.status(e.status).json({ error: e.message });
    console.error('[admin/contrato-download]', e);
    return res.status(500).json({ error: 'internal' });
  }
}
