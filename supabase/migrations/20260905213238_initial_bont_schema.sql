create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  birth_date date not null,
  sex text not null check (sex in ('male', 'female')),
  height_cm numeric(5,1) not null check (height_cm between 100 and 250),
  initial_weight_kg numeric(6,2) not null check (initial_weight_kg between 25 and 400),
  activity_level text not null check (activity_level in ('low', 'light', 'moderate', 'high', 'athlete')),
  body_fat_category text not null check (body_fat_category in ('very_low', 'athletic', 'fit', 'average', 'high')),
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  unique (id, user_id)
);

create table public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  goal_mode text not null default 'maintain' check (goal_mode in ('maintain', 'cut', 'bulk')),
  calorie_adjustment integer not null default 0 check (calorie_adjustment between 0 and 1500),
  preliminary_maintenance integer check (preliminary_maintenance between 900 and 6000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  unique (id, user_id)
);

create table public.training_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  split_size smallint not null check (split_size between 1 and 7),
  notes text not null default '' check (char_length(notes) <= 3000),
  is_active boolean not null default false,
  is_template boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  unique (id, user_id)
);

create table public.training_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null,
  name text not null check (char_length(name) between 1 and 60),
  order_index smallint not null check (order_index between 0 and 6),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (plan_id, user_id) references public.training_plans(id, user_id) on delete cascade
);

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  training_day_id uuid not null,
  name text not null check (char_length(name) between 1 and 100),
  target_sets smallint not null check (target_sets between 1 and 10),
  order_index smallint not null check (order_index between 0 and 99),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (training_day_id, user_id) references public.training_days(id, user_id) on delete cascade
);

create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  training_plan_id uuid not null,
  training_day_id uuid not null,
  started_at timestamptz not null,
  completed_at timestamptz,
  status text not null check (status in ('active', 'completed')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (training_plan_id, user_id) references public.training_plans(id, user_id) on delete cascade,
  foreign key (training_day_id, user_id) references public.training_days(id, user_id) on delete cascade,
  check ((status = 'active' and completed_at is null) or (status = 'completed' and completed_at is not null))
);

create table public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  exercise_id uuid not null,
  set_number smallint not null check (set_number between 1 and 20),
  weight_kg numeric(7,2) check (weight_kg between 0 and 2000),
  reps smallint check (reps between 1 and 1000),
  is_completed boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (session_id, user_id) references public.workout_sessions(id, user_id) on delete cascade,
  foreign key (exercise_id, user_id) references public.exercises(id, user_id) on delete cascade
);

create table public.body_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  weight_kg numeric(6,2) not null check (weight_kg between 25 and 400),
  calories integer not null default 0 check (calories between 0 and 15000),
  steps integer not null default 0 check (steps between 0 and 200000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  unique (id, user_id),
  unique (user_id, entry_date)
);

create table public.meal_slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  order_index smallint not null check (order_index between 0 and 9),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  unique (id, user_id)
);

create table public.food_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meal_slot_id uuid not null,
  entry_date date not null,
  name text not null check (char_length(name) between 1 and 120),
  amount numeric(8,2) not null check (amount > 0),
  unit text not null check (unit in ('g', 'ml', 'piece')),
  calories numeric(8,2) not null check (calories >= 0),
  protein_g numeric(8,2) not null default 0 check (protein_g >= 0),
  carbs_g numeric(8,2) not null default 0 check (carbs_g >= 0),
  fat_g numeric(8,2) not null default 0 check (fat_g >= 0),
  micronutrients jsonb not null default '{}'::jsonb check (jsonb_typeof(micronutrients) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (meal_slot_id, user_id) references public.meal_slots(id, user_id) on delete cascade
);

create unique index one_active_training_plan_per_user
  on public.training_plans (user_id)
  where is_active and not is_template and deleted_at is null;
create index training_days_plan_order_idx on public.training_days (plan_id, order_index) where deleted_at is null;
create index exercises_day_order_idx on public.exercises (training_day_id, order_index) where deleted_at is null;
create index workout_sessions_user_started_idx on public.workout_sessions (user_id, started_at desc) where deleted_at is null;
create index workout_sets_session_idx on public.workout_sets (session_id, set_number) where deleted_at is null;
create index workout_sets_exercise_idx on public.workout_sets (exercise_id, updated_at desc) where deleted_at is null;
create index body_entries_user_date_idx on public.body_entries (user_id, entry_date desc) where deleted_at is null;
create index meal_slots_user_order_idx on public.meal_slots (user_id, order_index) where deleted_at is null;
create index food_entries_user_date_idx on public.food_entries (user_id, entry_date, meal_slot_id) where deleted_at is null;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'user_settings', 'training_plans', 'training_days', 'exercises',
    'workout_sessions', 'workout_sets', 'body_entries', 'meal_slots', 'food_entries'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy "users_manage_own_rows" on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      table_name
    );
    execute format('revoke all on table public.%I from anon', table_name);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name
    );
  end loop;
end;
$$;

revoke all on function public.set_updated_at() from public;
