-- Cadastro do cliente (formulário /cadastro/:slug) + grupo WhatsApp criado pela Evolution.
-- `cadastro` guarda o formulário inteiro (lido sempre por completo). `grupo_jid` em coluna
-- própria porque a notificação de conclusão consulta por ele.
ALTER TABLE public.onboarding_sessions
  ADD COLUMN IF NOT EXISTS cadastro jsonb,
  ADD COLUMN IF NOT EXISTS cadastro_enviado_at timestamptz,
  ADD COLUMN IF NOT EXISTS grupo_jid text,
  ADD COLUMN IF NOT EXISTS grupo_invite_url text,
  ADD COLUMN IF NOT EXISTS grupo_criado_at timestamptz,
  ADD COLUMN IF NOT EXISTS grupo_erro text,
  ADD COLUMN IF NOT EXISTS notificacao_boas_vindas_enviada_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_sessions_grupo_jid_uidx
  ON public.onboarding_sessions (grupo_jid)
  WHERE grupo_jid IS NOT NULL;
