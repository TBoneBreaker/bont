alter table public.food_entries
  add column if not exists brand text not null default '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'food_entries_brand_length_check'
      and conrelid = 'public.food_entries'::regclass
  ) then
    alter table public.food_entries
      add constraint food_entries_brand_length_check
      check (char_length(brand) <= 120);
  end if;
end;
$$;

-- Cloud timestamps must be authoritative so devices with different clocks
-- cannot make the incremental sync cursor skip newer records.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'user_settings', 'training_plans', 'training_days', 'exercises',
    'workout_sessions', 'workout_sets', 'body_entries', 'meal_slots', 'food_entries'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', table_name);
    execute format(
      'create trigger set_updated_at before insert or update on public.%I for each row execute function public.set_updated_at()',
      table_name
    );
  end loop;
end;
$$;
