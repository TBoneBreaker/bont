alter table public.body_entries
  alter column weight_kg drop not null,
  alter column calories drop not null,
  alter column calories drop default,
  alter column steps drop not null,
  alter column steps drop default;

alter table public.body_entries
  add constraint body_entries_has_value_check
  check (weight_kg is not null or calories is not null or steps is not null);
