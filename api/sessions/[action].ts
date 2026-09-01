import type { VercelRequest, VercelResponse } from '@vercel/node';
import completeDepartment from './_complete-department';
import create from './_create';
import get from './_get';
import saveResposta from './_save-resposta';
import sendMagicLink from './_send-magic-link';
import uploadArquivo from './_upload-arquivo';
import validateCnpj from './_validate-cnpj';
import cnpjLookup from './_cnpj-lookup';
import cadastroSubmit from './_cadastro-submit';

/**
 * Router /api/sessions/[action] — consolida os endpoints de sessão em 1
 * serverless function (limite de 12 do plano Hobby). As URLs públicas não
 * mudam: /api/sessions/create continua respondendo igual.
 */
const HANDLERS: Record<string, (req: VercelRequest, res: VercelResponse) => unknown> = {
  'complete-department': completeDepartment,
  'cnpj-lookup': cnpjLookup,
  'cadastro-submit': cadastroSubmit,
  create,
  get,
  'save-resposta': saveResposta,
  'send-magic-link': sendMagicLink,
  'upload-arquivo': uploadArquivo,
  'validate-cnpj': validateCnpj,
};

export default function handler(req: VercelRequest, res: VercelResponse) {
  const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
  const h = HANDLERS[action ?? ''];
  if (!h) return res.status(404).json({ error: 'not_found' });
  return h(req, res);
}
