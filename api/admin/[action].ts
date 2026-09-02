import type { VercelRequest, VercelResponse } from '@vercel/node';
import sessionsCreate from './_sessions-create';
import sessionsDelete from './_sessions-delete';
import sessionsList from './_sessions-list';
import sessionsUpdate from './_sessions-update';
import shortLinksCreate from './_short-links-create';
import whatsappSendWelcome from './_whatsapp-send-welcome';
import cadastroRecriarGrupo from './_cadastro-recriar-grupo';
import cadastroGerarContrato from './_cadastro-gerar-contrato';
import cadastroCobrarContaAzul from './_cadastro-cobrar-conta-azul';
import contratoDownload from './_contrato-download';
import assinaturaEnviar from './_assinatura-enviar';
import assinaturaDetalhes from './_assinatura-detalhes';
import assinaturaAprovar from './_assinatura-aprovar';

/**
 * Router /api/admin/[action] — consolida os endpoints admin em 1 serverless
 * function (limite de 12 do plano Hobby). As URLs públicas não mudam:
 * /api/admin/sessions-create continua respondendo igual.
 */
const HANDLERS: Record<string, (req: VercelRequest, res: VercelResponse) => unknown> = {
  'sessions-create': sessionsCreate,
  'sessions-delete': sessionsDelete,
  'sessions-list': sessionsList,
  'sessions-update': sessionsUpdate,
  'short-links-create': shortLinksCreate,
  'whatsapp-send-welcome': whatsappSendWelcome,
  'cadastro-recriar-grupo': cadastroRecriarGrupo,
  'cadastro-gerar-contrato': cadastroGerarContrato,
  'cadastro-cobrar-conta-azul': cadastroCobrarContaAzul,
  'contrato-download': contratoDownload,
  'assinatura-enviar': assinaturaEnviar,
  'assinatura-detalhes': assinaturaDetalhes,
  'assinatura-aprovar': assinaturaAprovar,
};

export default function handler(req: VercelRequest, res: VercelResponse) {
  const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
  const h = HANDLERS[action ?? ''];
  if (!h) return res.status(404).json({ error: 'not_found' });
  return h(req, res);
}
