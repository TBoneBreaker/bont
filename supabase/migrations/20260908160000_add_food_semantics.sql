alter table public.food_entries
  add column if not exists food_source text,
  add column if not exists source_id text,
  add column if not exists preparation_state text not null default 'unknown',
  add column if not exists portion_grams numeric(8,2),
  add column if not exists portion_label text;

alter table public.food_entries
  add constraint food_entries_source_check
    check (food_source is null or food_source in ('open_food_facts', 'usda')),
  add constraint food_entries_preparation_state_check
    check (preparation_state in ('raw', 'dry', 'cooked', 'prepared', 'unknown')),
  add constraint food_entries_portion_grams_check
    check (portion_grams is null or portion_grams > 0),
  add constraint food_entries_portion_label_length_check
    check (portion_label is null or char_length(portion_label) <= 120);
