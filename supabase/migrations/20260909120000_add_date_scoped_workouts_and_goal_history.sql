-- Keep the workout log keyed by the user's calendar date instead of deriving
-- the date from a timestamp at read time. Existing sessions are preserved and
-- backfilled from the noon timestamp used by the original client.
alter table public.workout_sessions
  add column if not exists entry_date date;

update public.workout_sessions
set entry_date = started_at::date
where entry_date is null;

alter table public.workout_sessions
  alter column entry_date set not null;

create index if not exists workout_sessions_user_day_date_idx
  on public.workout_sessions (user_id, training_day_id, entry_date)
  where deleted_at is null;

-- Goal changes are effective from a calendar date. There is deliberately no
-- retroactive row for existing users: dates before their first known snapshot
-- must not be presented with an invented historical target.
create table if not exists public.goal_settings_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  effective_from date not null,
  goal_mode text not null check (goal_mode in ('maintain', 'cut', 'bulk')),
  calorie_adjustment integer not null default 0 check (calorie_adjustment between 0 and 1500),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  unique (id, user_id),
  unique (user_id, effective_from)
);

create index if not exists goal_settings_history_user_date_idx
  on public.goal_settings_history (user_id, effective_from desc)
  where deleted_at is null;

alter table public.goal_settings_history enable row level security;

drop policy if exists users_manage_own_rows on public.goal_settings_history;
create policy users_manage_own_rows on public.goal_settings_history
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.goal_settings_history from anon;
grant select, insert, update, delete on table public.goal_settings_history to authenticated;

drop trigger if exists set_updated_at on public.goal_settings_history;
create trigger set_updated_at
  before insert or update on public.goal_settings_history
  for each row execute function public.set_updated_at();
