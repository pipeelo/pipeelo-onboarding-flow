-- Assinatura do contrato pela AssinaPDF.
-- Ver docs/superpowers/specs/2026-09-02-assinatura-assinapdf-design.md
ALTER TABLE public.onboarding_sessions
  ADD COLUMN IF NOT EXISTS contrato_pdf_path text,
  ADD COLUMN IF NOT EXISTS assinapdf_solicitacao_id integer,
  ADD COLUMN IF NOT EXISTS assinapdf_link text,
  ADD COLUMN IF NOT EXISTS assinapdf_estado text,
  ADD COLUMN IF NOT EXISTS assinatura_enviada_at timestamptz,
  ADD COLUMN IF NOT EXISTS assinatura_assinada_at timestamptz,
  ADD COLUMN IF NOT EXISTS assinatura_finalizada_at timestamptz,
  ADD COLUMN IF NOT EXISTS assinatura_erro text,
  ADD COLUMN IF NOT EXISTS assinatura_consultada_at timestamptz,
  ADD COLUMN IF NOT EXISTS contrato_assinado_path text;

-- O polling procura só o que está em andamento.
CREATE INDEX IF NOT EXISTS onboarding_sessions_assinatura_status_idx
  ON public.onboarding_sessions (assinatura_status)
  WHERE assinatura_status IN ('enviado', 'correcao', 'aguardando_validacao');
