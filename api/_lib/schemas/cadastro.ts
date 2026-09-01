import { z } from 'zod';
import { CnpjSchema, EmailSchema } from './identificacao';

export const DIAS_VENCIMENTO = [5, 10, 15, 20, 25] as const;

/**
 * Telefone BR em dígitos: DDD(2) + 8 ou 9 dígitos. Aceita máscara, espaços,
 * +55 na frente. Saída: "43996661541".
 */
export const PhoneBrSchema = z
  .string()
  .transform((s) => {
    let d = s.replace(/\D/g, '');
    if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
    return d;
  })
  .refine((d) => d.length === 10 || d.length === 11, 'telefone_invalido');

export const UploadMetaSchema = z.object({
  path: z.string().min(1),
  nome_original: z.string().min(1).max(200),
  tamanho: z.number().int().positive(),
});
export type UploadMeta = z.infer<typeof UploadMetaSchema>;

export const ContatoExtraSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  whatsapp: PhoneBrSchema,
});

export const CadastroSchema = z.object({
  cnpj: CnpjSchema,
  razao_social: z.string().trim().min(3).max(200),
  nome_fantasia: z.string().trim().min(2).max(120),
  inscricao_estadual: z.string().trim().min(2).max(40),
  cobranca_email: EmailSchema,
  cobranca_telefone: PhoneBrSchema,
  dia_vencimento: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(25)]),
  contrato_email: EmailSchema,
  doc_contrato_social: z.array(UploadMetaSchema).min(1).max(10),
  doc_responsaveis: z.array(UploadMetaSchema).min(1).max(10),
  responsavel_nome: z.string().trim().min(3).max(120),
  responsavel_cargo: z.string().trim().min(2).max(80),
  responsavel_email: EmailSchema,
  responsavel_whatsapp: PhoneBrSchema,
  contatos_extras: z.array(ContatoExtraSchema).max(2).default([]),
  aceite_dados: z.literal(true),
});
export type Cadastro = z.infer<typeof CadastroSchema>;

export const CadastroSubmitSchema = z.object({
  slug: z.string().min(1),
  token: z.string().min(16),
  cadastro: CadastroSchema,
});
