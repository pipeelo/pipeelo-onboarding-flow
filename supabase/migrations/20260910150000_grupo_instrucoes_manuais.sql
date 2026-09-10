-- Criação de grupo passa a ser MANUAL (10/09/2026).
-- A instância `Grupos` levou bloqueio 403 do WhatsApp ao criar o grupo da GOLDFIBRA,
-- doze segundos depois do cadastro. Em vez de insistir na automação, o onboarding
-- manda o roteiro para o Lucas no grupo Staff e ele cria o grupo na mão.
alter table public.onboarding_sessions
  add column if not exists grupo_instrucoes_enviadas_at timestamptz;

comment on column public.onboarding_sessions.grupo_instrucoes_enviadas_at is
  'Quando o roteiro de criação manual do grupo foi mandado no Staff. Null = ainda não foi.';
