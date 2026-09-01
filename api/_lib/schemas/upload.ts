import { z } from 'zod';
import { DEPARTAMENTOS } from './resposta';

export const UPLOAD_BUCKET = 'onboarding-uploads';

/** Contextos de upload: planilha de equipe (departamentos) e documentos do cadastro. */
export const UPLOAD_CONTEXTOS = {
  planilha: { extensoes: ['xlsx', 'xls', 'csv'] as const, maxBytes: 5 * 1024 * 1024 },
  cadastro: { extensoes: ['pdf', 'jpg', 'jpeg', 'png'] as const, maxBytes: 10 * 1024 * 1024 },
} as const;

// Compat: constantes antigas continuam apontando para o contexto planilha.
export const UPLOAD_EXTENSOES = UPLOAD_CONTEXTOS.planilha.extensoes;
export const UPLOAD_MAX_BYTES = UPLOAD_CONTEXTOS.planilha.maxBytes;

export const UPLOAD_DEPARTAMENTOS = [...DEPARTAMENTOS, 'cadastro'] as const;

export function resolveUploadContexto(departamento: string) {
  return departamento === 'cadastro' ? UPLOAD_CONTEXTOS.cadastro : UPLOAD_CONTEXTOS.planilha;
}

export const UploadArquivoSchema = z.object({
  slug: z.string().min(1),
  token: z.string().min(16),
  departamento: z.enum(UPLOAD_DEPARTAMENTOS),
  pergunta_id: z.string().min(1).max(80),
  nome: z.string().min(1).max(200),
  content_type: z.string().max(120).optional(),
  /** Conteúdo do arquivo em base64 (sem prefixo data:). */
  base64: z.string().min(1),
});
