-- 1ª mensalidade proporcional aos dias de operação (cláusula 8 do Anexo I).
--
-- A data da 1ª mensalidade deixa de ser digitada no fechamento: ela nasce do
-- go-live (início da operação), que só se conhece depois do cadastro. Enquanto
-- `go_live_em` for nulo, a cobrança no Conta Azul emite apenas a implantação.
alter table public.onboarding_sessions
  add column if not exists go_live_em date;

comment on column public.onboarding_sessions.go_live_em is
  'Início da operação. Base do cálculo da 1ª mensalidade proporcional (valor / 30 x dias até o fim do mês) e do início do contrato recorrente no Conta Azul.';

-- Sessões antigas que já tinham data de 1ª mensalidade combinada continuam
-- legíveis pela coluna antiga; nada é migrado automaticamente porque a data
-- digitada não é um go-live.
comment on column public.onboarding_sessions.primeira_mensalidade_em is
  'OBSOLETO desde 09/09/2026: a 1ª mensalidade passou a sair de go_live_em + 3 dias, com valor proporcional. Mantida só para histórico.';
