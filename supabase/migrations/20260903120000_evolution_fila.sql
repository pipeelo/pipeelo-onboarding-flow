-- Fila cadenciada de ações na Evolution (grupos de WhatsApp).
--
-- Por que existe: criar um grupo disparava ~20 chamadas na Evolution em menos de
-- um minuto (createGroup + um add por membro da equipe + mensagens), tudo dentro
-- do request de /api/sessions/cadastro-submit. O WhatsApp responde a essa rajada
-- derrubando a conexão do número. O pacing que havia (`esperar(1500)` em
-- cadastro-grupo.ts) era local a cada execução: dois cadastros no mesmo dia
-- geravam duas rajadas independentes, sem teto entre elas.
--
-- Contrato:
--   1. criarGrupoParaSessao faz inline só o barato e visível: createGroup do
--      grupo com os contatos do cliente, promote do admin e link de convite.
--   2. Todo add de participante e toda mensagem viram row 'pendente' aqui.
--   3. O worker (server/index.ts -> drenarFilaEvolution) processa NO MÁXIMO 1
--      item por rodada, e só quando ganha o slot em evolution_fila_estado.
--   4. Após cada ação o slot avança para now() + intervalo aleatório. O teto é
--      GLOBAL: vale para todas as sessões somadas, não por sessão.
--   5. pausado_ate é o disjuntor: instância fora do ar pausa a fila inteira em
--      vez de martelar um número que acabou de cair.

create table if not exists public.evolution_fila (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.onboarding_sessions(id) on delete cascade,
  -- 'add'    = updateParticipants add de 1 JID
  -- 'texto'  = sendText no grupo
  -- 'resumo' = aviso final ao Staff quando a fila da sessão esvazia
  tipo text not null check (tipo in ('add','texto','resumo')),
  grupo_jid text not null,
  -- Qual número executa. 'grupos' = número dedicado à criação; 'padrao' = número
  -- histórico, que segue dono dos grupos criados antes desta mudança.
  instancia text not null default 'grupos' check (instancia in ('padrao','grupos')),
  payload jsonb not null default '{}'::jsonb,
  -- Idempotência: reprocessar uma sessão não duplica add nem mensagem.
  chave text not null unique,
  status text not null default 'pendente'
    check (status in ('pendente','processando','feito','falhou')),
  tentativas int not null default 0,
  max_tentativas int not null default 5,
  proxima_tentativa_at timestamptz not null default now(),
  executado_at timestamptz,
  ultimo_erro text,
  created_at timestamptz not null default now()
);

-- Query do worker: WHERE status='pendente' AND proxima_tentativa_at <= now()
create index if not exists idx_evolution_fila_pendente
  on public.evolution_fila(proxima_tentativa_at)
  where status = 'pendente';

create index if not exists idx_evolution_fila_session
  on public.evolution_fila(session_id);

-- Estado global do ritmo. Linha única (id=1).
create table if not exists public.evolution_fila_estado (
  id int primary key default 1 check (id = 1),
  proxima_liberacao_at timestamptz not null default now(),
  pausado_ate timestamptz,
  pausa_motivo text
);
insert into public.evolution_fila_estado (id) values (1) on conflict (id) do nothing;

-- Qual número é dono do grupo da sessão. NULL = grupos antigos, criados pelo
-- número histórico, que continuam sendo administrados por ele.
alter table public.onboarding_sessions
  add column if not exists grupo_instancia text
  check (grupo_instancia in ('padrao','grupos'));

-- RLS estrita: zero acesso anon/authenticated. Só service_role (que bypassa RLS).
alter table public.evolution_fila enable row level security;
alter table public.evolution_fila_estado enable row level security;

drop policy if exists "service_role_only_select" on public.evolution_fila;
create policy "service_role_only_select" on public.evolution_fila
  as restrictive for select to public using (false);
drop policy if exists "service_role_only_insert" on public.evolution_fila;
create policy "service_role_only_insert" on public.evolution_fila
  as restrictive for insert to public with check (false);
drop policy if exists "service_role_only_update" on public.evolution_fila;
create policy "service_role_only_update" on public.evolution_fila
  as restrictive for update to public using (false) with check (false);
drop policy if exists "service_role_only_delete" on public.evolution_fila;
create policy "service_role_only_delete" on public.evolution_fila
  as restrictive for delete to public using (false);

drop policy if exists "service_role_only_select" on public.evolution_fila_estado;
create policy "service_role_only_select" on public.evolution_fila_estado
  as restrictive for select to public using (false);
drop policy if exists "service_role_only_insert" on public.evolution_fila_estado;
create policy "service_role_only_insert" on public.evolution_fila_estado
  as restrictive for insert to public with check (false);
drop policy if exists "service_role_only_update" on public.evolution_fila_estado;
create policy "service_role_only_update" on public.evolution_fila_estado
  as restrictive for update to public using (false) with check (false);
drop policy if exists "service_role_only_delete" on public.evolution_fila_estado;
create policy "service_role_only_delete" on public.evolution_fila_estado
  as restrictive for delete to public using (false);
