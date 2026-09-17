import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { fetchCnpj } from '../_lib/brasilapi';
import { assertSessionAccess, HttpError } from '../_lib/auth-session';
import { CnpjSchema } from '../_lib/schemas/identificacao';

const Schema = z.object({ slug: z.string().min(1), token: z.string().min(16), cnpj: CnpjSchema });

/**
 * POST /api/sessions/cnpj-lookup — usado pela página /cadastro para preencher razão
 * social e nome fantasia. Provedor fora do ar não é erro: devolve strings vazias e o
 * cliente digita à mão.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const body = Schema.parse(req.body);
    await assertSessionAccess(body.slug, body.token);

    let data: Record<string, unknown> = {};
    try {
      data = (await fetchCnpj(body.cnpj)) as Record<string, unknown>;
    } catch (e) {
      console.warn('[cnpj-lookup] provedor indisponível:', e instanceof Error ? e.message : e);
    }
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    // Endereço da sede: BrasilAPI (descricao_tipo_de_logradouro + logradouro, municipio, uf)
    // ou ReceitaWS (logradouro já com o tipo, municipio, uf). Vai pro /cadastro e de lá
    // pré-preenche "Confirme o endereço da sede" no SAC Geral.
    const tipoLog = str(data.descricao_tipo_de_logradouro);
    const logradouro = [tipoLog, str(data.logradouro)].filter(Boolean).join(' ');
    const cepDigits = str(data.cep).replace(/\D/g, '');
    const endereco_sede = {
      cep: cepDigits.length === 8 ? `${cepDigits.slice(0, 5)}-${cepDigits.slice(5)}` : str(data.cep),
      logradouro,
      numero: str(data.numero),
      complemento: str(data.complemento),
      bairro: str(data.bairro),
      cidade: str(data.municipio),
      uf: str(data.uf),
    };
    return res.status(200).json({
      razao_social: str(data.razao_social) || str(data.nome),
      nome_fantasia: str(data.nome_fantasia) || str(data.fantasia),
      endereco_sede: endereco_sede.logradouro || endereco_sede.cep ? endereco_sede : null,
    });
  } catch (e: unknown) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    const err = e as { name?: string; flatten?: () => unknown };
    if (err.name === 'ZodError') return res.status(400).json({ error: 'invalid_payload', details: err.flatten?.() });
    console.error('[sessions/cnpj-lookup]', e);
    return res.status(500).json({ error: 'internal' });
  }
}
