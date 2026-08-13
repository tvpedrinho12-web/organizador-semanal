-- ============================================================================
-- RITMO — Fase 3 — Migration 0001 (schema + RLS + auth + admin)
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em "Run".
-- Idempotente: pode rodar mais de uma vez sem quebrar.
-- Moeda: BRL, armazenada em numeric(12,2). Timezone padrao: America/Sao_Paulo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Config do app (guarda o e-mail do admin de forma segura, fora do codigo)
-- ---------------------------------------------------------------------------
create table if not exists public.app_config (
  key   text primary key,
  value text
);

-- >>> E-MAIL DO ADMIN PRINCIPAL <<<
-- A conta que se cadastrar com este e-mail nasce role=admin, status=approved.
insert into public.app_config (key, value)
values ('admin_email', 'tvpedrinho12@gmail.com')
on conflict (key) do update set value = excluded.value;

-- ---------------------------------------------------------------------------
-- 1. profiles (1:1 com auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  name         text,
  email        text,
  role         text not null default 'user'    check (role   in ('user','admin')),
  status       text not null default 'pending' check (status in ('pending','approved','blocked')),
  timezone     text not null default 'America/Sao_Paulo',
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz
);

-- ---------------------------------------------------------------------------
-- 2. task_recurrences (regras de repeticao)
-- ---------------------------------------------------------------------------
create table if not exists public.task_recurrences (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  task_template jsonb not null default '{}'::jsonb,   -- {title,description,period,time,priority}
  frequency     text  not null check (frequency in ('daily','weekly','interval','monthly')),
  weekdays      int[] ,                               -- 0=Dom .. 6=Sab (para 'weekly')
  interval_days int   not null default 1,             -- para 'interval' (a cada N dias)
  day_of_month  int   ,                               -- para 'monthly' (1..31)
  start_date    date  not null,
  end_date      date  ,                               -- nulo = fixa (sem fim)
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. tasks
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  title          text not null,
  description    text,
  scheduled_date date,                                 -- nulo + inbox=true => "Para organizar"
  scheduled_time time,
  period         text check (period in ('morning','afternoon','night')),
  completed      boolean not null default false,
  completed_at   timestamptz,
  priority       text not null default 'normal' check (priority in ('urgent','important','normal')),
  inbox          boolean not null default false,       -- caixa "Para organizar"
  recurrence_id  uuid references public.task_recurrences(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. goals (metas comuns)
-- ---------------------------------------------------------------------------
create table if not exists public.goals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  title        text not null,
  kind         text not null default 'boolean' check (kind in ('boolean','counter')),
  target_count int  not null default 1,
  current_count int not null default 0,
  completed    boolean not null default false,
  archived     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. transactions (REALIZADO: entradas/gastos que aconteceram)
-- ---------------------------------------------------------------------------
create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  type        text not null check (type in ('expense','income')),
  description text,
  amount      numeric(12,2) not null check (amount >= 0),
  category    text,
  date        date not null,
  bill_id     uuid,                                    -- origem: qual conta/entrada prevista gerou este realizado
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. bills (PREVISTO: contas a pagar e entradas a receber)
--    type=expense => gasto previsto | type=income => entrada prevista
-- ---------------------------------------------------------------------------
create table if not exists public.bills (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  type               text not null default 'expense' check (type in ('expense','income')),
  description        text,
  amount             numeric(12,2) not null check (amount >= 0),
  due_date           date not null,                    -- vencimento (expense) / previsao (income)
  status             text not null default 'pending' check (status in ('pending','done')),
  settled_at         timestamptz,                      -- quando foi paga/recebida
  remind_before_days int not null default 1,
  created_at         timestamptz not null default now()
);
-- liga o transactions.bill_id -> bills.id (declarado aqui pois bills nasce depois)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_bill_id_fkey') then
    alter table public.transactions
      add constraint transactions_bill_id_fkey
      foreign key (bill_id) references public.bills(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. finance_goals (metas financeiras / guardar dinheiro)
-- ---------------------------------------------------------------------------
create table if not exists public.finance_goals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  description    text not null,
  target_amount  numeric(12,2) not null check (target_amount >= 0),
  current_amount numeric(12,2) not null default 0,
  completed      boolean not null default false,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 8. user_settings (preferencias)
-- ---------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  theme        text not null default 'roxo' check (theme in ('roxo','azul','verde')),
  voice        boolean not null default true,
  suggestions  boolean not null default true,
  short_answers boolean not null default false,
  ai_enabled   boolean not null default true,
  notif        jsonb not null default '{"tasks":true,"daily":true,"bills":true,"streak":true}'::jsonb,
  finance      jsonb not null default '{"billReminders":true,"showOnHoje":true}'::jsonb,
  extra        jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 9. assistant_actions (historico do agente + suporte a Desfazer)
-- ---------------------------------------------------------------------------
create table if not exists public.assistant_actions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  action      text not null,                           -- ex.: create_task, move_task, create_expense
  entity_type text,                                    -- task | bill | transaction | goal | setting ...
  entity_id   uuid,
  summary     text,                                    -- "criou Academia amanha 19h"
  source      text check (source in ('text','voice')),
  payload     jsonb,                                   -- args usados
  undo        jsonb,                                   -- info para desfazer
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 10. ai_usage (contagem de chamadas por usuario)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_usage (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text,                                     -- assistant | report | organize | plan ...
  tokens_in  int,
  tokens_out int,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 11. finance_reports (relatorios semanais do conselheiro)
-- ---------------------------------------------------------------------------
create table if not exists public.finance_reports (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  content      text not null,
  data         jsonb,                                  -- numeros usados (saldo, entradas, etc.)
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 12. push_subscriptions (Web Push por usuario + dispositivo)
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  device       text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Indices
-- ---------------------------------------------------------------------------
create index if not exists idx_tasks_user_date     on public.tasks (user_id, scheduled_date);
create index if not exists idx_tasks_user_done      on public.tasks (user_id, completed);
create index if not exists idx_tasks_user_inbox     on public.tasks (user_id, inbox);
create index if not exists idx_recur_user_active    on public.task_recurrences (user_id, active);
create index if not exists idx_tx_user_date         on public.transactions (user_id, date);
create index if not exists idx_tx_user_type         on public.transactions (user_id, type);
create index if not exists idx_bills_user_due       on public.bills (user_id, due_date, status);
create index if not exists idx_actions_user_time    on public.assistant_actions (user_id, created_at desc);
create index if not exists idx_aiusage_user_time    on public.ai_usage (user_id, created_at);
create index if not exists idx_reports_user_time    on public.finance_reports (user_id, created_at desc);
create index if not exists idx_push_user            on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- Trigger: updated_at automatico
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_tasks_updated on public.tasks;
create trigger trg_tasks_updated before update on public.tasks
for each row execute function public.set_updated_at();

drop trigger if exists trg_settings_updated on public.user_settings;
create trigger trg_settings_updated before update on public.user_settings
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- is_admin(): usado nas policies. SECURITY DEFINER evita recursao de RLS.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.status = 'approved'
  );
$$;

-- ---------------------------------------------------------------------------
-- Novo usuario: cria profile (+ user_settings). Admin conforme app_config.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_admin  text;
  v_role   text := 'user';
  v_status text := 'pending';
begin
  select value into v_admin from public.app_config where key = 'admin_email';
  if v_admin is not null and lower(new.email) = lower(v_admin) then
    v_role := 'admin'; v_status := 'approved';
  end if;

  insert into public.profiles (id, name, email, role, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    new.email, v_role, v_status
  ) on conflict (id) do nothing;

  insert into public.user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Impede que usuario comum altere o proprio role/status (escalonamento)
-- ---------------------------------------------------------------------------
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if public.is_admin() then return new; end if;   -- admin pode alterar role/status
  new.role   := old.role;
  new.status := old.status;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile on public.profiles;
create trigger trg_protect_profile before update on public.profiles
for each row execute function public.protect_profile_fields();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.profiles          enable row level security;
alter table public.app_config         enable row level security;
alter table public.task_recurrences   enable row level security;
alter table public.tasks              enable row level security;
alter table public.goals              enable row level security;
alter table public.transactions       enable row level security;
alter table public.bills              enable row level security;
alter table public.finance_goals      enable row level security;
alter table public.user_settings      enable row level security;
alter table public.assistant_actions  enable row level security;
alter table public.ai_usage           enable row level security;
alter table public.finance_reports    enable row level security;
alter table public.push_subscriptions enable row level security;

-- profiles: ve/edita o proprio; admin ve/edita todos (mas nao deleta ninguem)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using ( id = auth.uid() or public.is_admin() );
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using ( id = auth.uid() or public.is_admin() )
  with check   ( id = auth.uid() or public.is_admin() );

-- app_config: somente admin
drop policy if exists app_config_admin on public.app_config;
create policy app_config_admin on public.app_config
  for all using ( public.is_admin() ) with check ( public.is_admin() );

-- Tabelas pessoais: cada usuario so acessa os proprios registros.
-- (Admin NAO tem bypass aqui — painel usa funcoes agregadas; sem vigilancia.)
drop policy if exists own_recurrences on public.task_recurrences;
create policy own_recurrences on public.task_recurrences
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

drop policy if exists own_tasks on public.tasks;
create policy own_tasks on public.tasks
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

drop policy if exists own_goals on public.goals;
create policy own_goals on public.goals
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

drop policy if exists own_transactions on public.transactions;
create policy own_transactions on public.transactions
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

drop policy if exists own_bills on public.bills;
create policy own_bills on public.bills
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

drop policy if exists own_finance_goals on public.finance_goals;
create policy own_finance_goals on public.finance_goals
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

drop policy if exists own_settings on public.user_settings;
create policy own_settings on public.user_settings
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

drop policy if exists own_actions on public.assistant_actions;
create policy own_actions on public.assistant_actions
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

drop policy if exists own_aiusage on public.ai_usage;
create policy own_aiusage on public.ai_usage
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

drop policy if exists own_reports on public.finance_reports;
create policy own_reports on public.finance_reports
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

drop policy if exists own_push on public.push_subscriptions;
create policy own_push on public.push_subscriptions
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

-- ============================================================================
-- FUNCOES DO ADMIN (agregados — nunca expoem dados privados de terceiros)
-- ============================================================================
create or replace function public.admin_overview()
returns json
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return json_build_object(
    'total_users', (select count(*) from public.profiles),
    'approved',    (select count(*) from public.profiles where status='approved'),
    'pending',     (select count(*) from public.profiles where status='pending'),
    'blocked',     (select count(*) from public.profiles where status='blocked'),
    'ai_calls_total', (select count(*) from public.ai_usage)
  );
end;
$$;

create or replace function public.admin_user_summaries()
returns json
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return (
    select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
      select
        p.id, p.name, p.email, p.status, p.role, p.created_at, p.last_seen_at,
        (select count(*) from public.tasks        tk where tk.user_id = p.id) as task_count,
        (select count(*) from public.transactions tx where tx.user_id = p.id) as tx_count,
        (select count(*) from public.ai_usage     au where au.user_id = p.id) as ai_calls
      from public.profiles p
      order by
        case p.status when 'pending' then 0 when 'approved' then 1 else 2 end,
        p.created_at desc
    ) t
  );
end;
$$;

create or replace function public.admin_set_status(target uuid, new_status text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if new_status not in ('pending','approved','blocked') then raise exception 'invalid status'; end if;
  update public.profiles set status = new_status where id = target;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilegios (RLS continua sendo o gate real por linha)
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.is_admin()              to authenticated;
grant execute on function public.admin_overview()        to authenticated;
grant execute on function public.admin_user_summaries()  to authenticated;
grant execute on function public.admin_set_status(uuid, text) to authenticated;

-- FIM 0001
