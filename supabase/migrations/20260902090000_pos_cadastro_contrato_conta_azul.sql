-- Pós-cadastro: contrato automático + cobrança no Conta Azul.
-- Todos os campos opcionais; ver docs/superpowers/specs/2026-09-02-pos-cadastro-contrato-conta-azul-design.md
ALTER TABLE public.onboarding_sessions
  ADD COLUMN IF NOT EXISTS valor_implantacao numeric(12,2),
  ADD COLUMN IF NOT EXISTS implantacao_vencimento date,
  ADD COLUMN IF NOT EXISTS primeira_mensalidade_em date,
  ADD COLUMN IF NOT EXISTS contrato_path text,
  ADD COLUMN IF NOT EXISTS contrato_gerado_at timestamptz,
  ADD COLUMN IF NOT EXISTS contrato_erro text,
  ADD COLUMN IF NOT EXISTS contrato_extracao jsonb,
  ADD COLUMN IF NOT EXISTS ca_cliente_id text,
  ADD COLUMN IF NOT EXISTS ca_implantacao_url text,
  ADD COLUMN IF NOT EXISTS ca_mensalidade_url text,
  ADD COLUMN IF NOT EXISTS ca_cobrado_at timestamptz,
  ADD COLUMN IF NOT EXISTS ca_erro text,
  ADD COLUMN IF NOT EXISTS assinatura_status text;
