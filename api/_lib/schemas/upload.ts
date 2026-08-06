import { z } from 'zod';
import { DEPARTAMENTOS } from './resposta';

export const UPLOAD_BUCKET = 'onboarding-uploads';
export const UPLOAD_EXTENSOES = ['xlsx', 'xls', 'csv'] as const;
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024; // 5MB

export const UploadArquivoSchema = z.object({
  slug: z.string().min(1),
  token: z.string().min(16),
  departamento: z.enum(DEPARTAMENTOS),
  pergunta_id: z.string().min(1).max(80),
  nome: z.string().min(1).max(200),
  content_type: z.string().max(120).optional(),
  /** Conteúdo do arquivo em base64 (sem prefixo data:). */
  base64: z.string().min(1),
});
