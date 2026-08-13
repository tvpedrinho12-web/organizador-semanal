-- ============================================================================
-- RITMO — Migration 0002 — user_state (sincronização do app na nuvem)
-- Guarda o estado do app (tarefas/metas/finanças/config) por usuário como
-- blob JSON, para o app sobreviver a reinstalar o PWA ou trocar de aparelho.
-- Cole no SQL Editor do Supabase e clique Run. Idempotente.
-- ============================================================================

create table if not exists public.user_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_state enable row level security;

drop policy if exists own_state on public.user_state;
create policy own_state on public.user_state
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

grant select, insert, update, delete on public.user_state to authenticated;

-- FIM 0002
