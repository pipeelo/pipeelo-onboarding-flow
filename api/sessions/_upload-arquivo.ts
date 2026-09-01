import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  UploadArquivoSchema,
  UPLOAD_BUCKET,
  resolveUploadContexto,
} from '../_lib/schemas/upload';
import { assertSessionAccess, HttpError } from '../_lib/auth-session';
import { getServiceSupabase } from '../_lib/supabase';

/**
 * POST /api/sessions/upload-arquivo — recebe arquivo em base64 (planilha de
 * equipe/departamentos ou documentos do cadastro), grava no bucket privado
 * `onboarding-uploads` via service role e retorna o metadata que o front salva
 * como resposta.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const body = UploadArquivoSchema.parse(req.body);
    const session = await assertSessionAccess(body.slug, body.token);

    const ctx = resolveUploadContexto(body.departamento);
    const ext = body.nome.split('.').pop()?.toLowerCase() ?? '';
    if (!(ctx.extensoes as readonly string[]).includes(ext))
      throw new HttpError(400, 'extensao_nao_permitida');

    const buffer = Buffer.from(body.base64, 'base64');
    if (buffer.length === 0) throw new HttpError(400, 'arquivo_vazio');
    if (buffer.length > ctx.maxBytes) throw new HttpError(413, 'arquivo_muito_grande');

    const nomeSanitizado = body.nome
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .slice(-120);
    const prefixo = body.departamento === 'cadastro' ? 'cadastro/' : '';
    const path = `${(session as { id: string }).id}/${prefixo}${body.pergunta_id}/${Date.now()}-${nomeSanitizado}`;

    const supabase = getServiceSupabase();
    const { error } = await supabase.storage
      .from(UPLOAD_BUCKET)
      .upload(path, buffer, {
        contentType: body.content_type || 'application/octet-stream',
        upsert: false,
      });
    if (error) throw new HttpError(500, error.message);

    return res.status(200).json({
      path,
      nome_original: body.nome,
      tamanho: buffer.length,
    });
  } catch (e: unknown) {
    if (e instanceof HttpError)
      return res.status(e.status).json({ error: e.message });
    const err = e as { name?: string; flatten?: () => unknown };
    if (err.name === 'ZodError')
      return res
        .status(400)
        .json({ error: 'invalid_payload', details: err.flatten?.() });
    console.error('[sessions/upload-arquivo]', e);
    return res.status(500).json({ error: 'internal' });
  }
}
