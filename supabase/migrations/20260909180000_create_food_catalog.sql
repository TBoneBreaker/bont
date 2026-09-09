-- Canonical food catalog. This migration is additive and keeps existing food
-- entry snapshots intact while introducing stable catalog/provenance IDs.
create extension if not exists pgcrypto;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

create table if not exists public.food_sources (
  code text primary key,
  name text not null,
  license text not null,
  license_url text,
  source_url text,
  default_country_code text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.nutrients (
  id uuid primary key default gen_random_uuid(),
  canonical_key text not null unique,
  name_de text not null,
  name_en text,
  unit text not null,
  nutrient_group text not null,
  source_mappings jsonb not null default '{}'::jsonb check (jsonb_typeof(source_mappings) = 'object'),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.food_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.food_categories(id) on delete set null,
  slug text not null unique,
  name_de text not null,
  name_en text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.foods (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('generic', 'branded', 'recipe')),
  name_de text not null check (char_length(name_de) between 1 and 240),
  name_en text,
  normalized_name text not null,
  brand text,
  manufacturer text,
  category_id uuid references public.food_categories(id) on delete set null,
  subcategory text,
  preparation_state text not null default 'unknown' check (
    preparation_state in ('raw', 'cooked', 'fried', 'steamed', 'baked', 'dried', 'frozen', 'drained', 'prepared', 'uncooked', 'unknown')
  ),
  country_code text,
  nutrient_coverage jsonb not null default '{}'::jsonb check (jsonb_typeof(nutrient_coverage) = 'object'),
  data_quality jsonb not null default '{}'::jsonb check (jsonb_typeof(data_quality) = 'object'),
  confidence numeric(5,4) check (confidence between 0 and 1),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.food_source_records (
  id uuid primary key default gen_random_uuid(),
  source_code text not null references public.food_sources(code) on delete restrict,
  source_record_id text not null,
  source_updated_at timestamptz,
  raw_payload jsonb not null check (jsonb_typeof(raw_payload) = 'object'),
  payload_fingerprint text not null,
  imported_at timestamptz not null default timezone('utc', now()),
  unique (source_code, source_record_id)
);

create table if not exists public.food_source_links (
  food_id uuid not null references public.foods(id) on delete cascade,
  source_record_id uuid not null unique references public.food_source_records(id) on delete cascade,
  mapping_method text not null check (mapping_method in ('barcode', 'source_id', 'normalized_identity', 'manual', 'reference')),
  mapping_confidence numeric(5,4) not null check (mapping_confidence between 0 and 1),
  is_primary boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (food_id, source_record_id)
);

create table if not exists public.food_names (
  id uuid primary key default gen_random_uuid(),
  food_id uuid not null references public.foods(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  language_code text not null default 'de',
  name_type text not null check (name_type in ('primary', 'synonym', 'alias', 'original')),
  unique (food_id, normalized_name, language_code)
);

create table if not exists public.food_barcodes (
  food_id uuid not null references public.foods(id) on delete cascade,
  gtin14 text primary key check (gtin14 ~ '^[0-9]{14}$'),
  barcode_type text not null default 'gtin',
  is_validated boolean not null default false,
  source_record_id uuid references public.food_source_records(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.food_nutrient_observations (
  id uuid primary key default gen_random_uuid(),
  food_id uuid not null references public.foods(id) on delete cascade,
  source_record_id uuid not null references public.food_source_records(id) on delete cascade,
  nutrient_id uuid not null references public.nutrients(id) on delete restrict,
  value numeric,
  unit text not null,
  basis_amount numeric(10,4) not null check (basis_amount > 0),
  basis_unit text not null check (basis_unit in ('g', 'ml')),
  value_status text not null check (value_status in ('measured', 'declared', 'calculated', 'estimated', 'trace', 'below_limit', 'logical_zero', 'unknown')),
  observation_role text not null check (observation_role in ('primary', 'declared', 'reference')),
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  provenance text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (food_id, source_record_id, nutrient_id, basis_amount, basis_unit)
);

create table if not exists public.food_nutrients (
  food_id uuid not null references public.foods(id) on delete cascade,
  nutrient_id uuid not null references public.nutrients(id) on delete restrict,
  value numeric,
  unit text not null,
  basis_amount numeric(10,4) not null check (basis_amount > 0),
  basis_unit text not null check (basis_unit in ('g', 'ml')),
  source_code text not null references public.food_sources(code) on delete restrict,
  source_external_id text not null,
  source_record_id uuid not null references public.food_source_records(id) on delete restrict,
  derivation text not null check (derivation in ('direct', 'inherited_reference')),
  value_status text not null check (value_status in ('measured', 'declared', 'calculated', 'estimated', 'trace', 'below_limit', 'logical_zero', 'unknown')),
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  provenance text,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (food_id, nutrient_id, basis_amount, basis_unit)
);

create table if not exists public.food_portions (
  id uuid primary key default gen_random_uuid(),
  food_id uuid not null references public.foods(id) on delete cascade,
  label_de text not null,
  label_en text,
  amount numeric(10,3) not null check (amount > 0),
  unit text not null check (unit in ('g', 'ml', 'piece')),
  grams numeric(10,3) check (grams is null or grams > 0),
  source_record_id uuid references public.food_source_records(id) on delete set null,
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  is_default boolean not null default false,
  unique (food_id, label_de)
);

create table if not exists public.food_relationships (
  parent_food_id uuid not null references public.foods(id) on delete cascade,
  child_food_id uuid not null references public.foods(id) on delete cascade,
  relationship_type text not null check (relationship_type in ('variant_of', 'prepared_from', 'reference_for', 'alias_of')),
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (parent_food_id, child_food_id, relationship_type),
  check (parent_food_id <> child_food_id)
);

create table if not exists public.food_reference_mappings (
  id uuid primary key default gen_random_uuid(),
  branded_food_id uuid not null references public.foods(id) on delete cascade,
  reference_food_id uuid not null references public.foods(id) on delete cascade,
  mapping_method text not null check (mapping_method in ('barcode', 'manufacturer', 'normalized_identity', 'manual', 'model_assisted')),
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  state_matches boolean not null default false,
  definition_matches boolean not null default false,
  manually_verified boolean not null default false,
  reason text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (branded_food_id, reference_food_id)
);

create table if not exists public.food_reference_nutrient_rules (
  mapping_id uuid not null references public.food_reference_mappings(id) on delete cascade,
  nutrient_id uuid not null references public.nutrients(id) on delete cascade,
  allow_inheritance boolean not null default false,
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  reason text not null,
  primary key (mapping_id, nutrient_id)
);

create table if not exists public.food_identity_mappings (
  id uuid primary key default gen_random_uuid(),
  left_source_record_id uuid not null references public.food_source_records(id) on delete cascade,
  right_source_record_id uuid not null references public.food_source_records(id) on delete cascade,
  mapping_method text not null check (mapping_method in ('normalized_identity', 'manual', 'model_assisted')),
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  state_matches boolean not null default false,
  definition_matches boolean not null default false,
  manually_verified boolean not null default false,
  reason text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (left_source_record_id, right_source_record_id),
  check (left_source_record_id <> right_source_record_id)
);

create table if not exists public.food_import_runs (
  id uuid primary key default gen_random_uuid(),
  source_code text not null references public.food_sources(code) on delete restrict,
  source_version text not null,
  status text not null check (status in ('planned', 'running', 'validated', 'loaded', 'failed', 'rolled_back')),
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.food_quality_flags (
  id uuid primary key default gen_random_uuid(),
  food_id uuid references public.foods(id) on delete cascade,
  source_record_id uuid references public.food_source_records(id) on delete cascade,
  flag_code text not null,
  severity text not null check (severity in ('info', 'warning', 'error')),
  message text not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  resolved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  check (food_id is not null or source_record_id is not null)
);

alter table public.food_entries
  add column if not exists brand text,
  add column if not exists food_id uuid references public.foods(id) on delete set null,
  add column if not exists food_source text,
  add column if not exists source_id text,
  add column if not exists preparation_state text not null default 'unknown',
  add column if not exists portion_grams numeric(8,2),
  add column if not exists portion_label text,
  add column if not exists micronutrient_provenance jsonb not null default '{}'::jsonb;

alter table public.food_entries drop constraint if exists food_entries_source_check;
alter table public.food_entries drop constraint if exists food_entries_preparation_state_check;
alter table public.food_entries add constraint food_entries_source_check check (
  food_source is null or food_source in ('bls', 'open_food_facts', 'usda', 'manual')
);
alter table public.food_entries add constraint food_entries_preparation_state_check check (
  preparation_state in ('raw', 'cooked', 'fried', 'steamed', 'baked', 'dried', 'frozen', 'drained', 'prepared', 'uncooked', 'unknown')
);
alter table public.food_entries add constraint food_entries_portion_grams_check check (
  portion_grams is null or portion_grams > 0
);
alter table public.food_entries add constraint food_entries_portion_label_length_check check (
  portion_label is null or char_length(portion_label) <= 120
);
alter table public.food_entries add constraint food_entries_micronutrient_provenance_object_check check (
  jsonb_typeof(micronutrient_provenance) = 'object'
);

insert into public.food_sources (code, name, license, license_url, source_url, default_country_code)
values
  ('bls', 'Bundeslebensmittelschlüssel 4.0', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/', 'https://www.openagrar.de/', 'DE'),
  ('usda', 'USDA FoodData Central', 'CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/', 'https://fdc.nal.usda.gov/', 'US'),
  ('open_food_facts', 'Open Food Facts', 'ODbL 1.0 / DbCL', 'https://opendatacommons.org/licenses/odbl/1-0/', 'https://world.openfoodfacts.org/', 'DE'),
  ('manual', 'Manueller Eintrag', 'Bont user data', null, null, 'DE')
on conflict (code) do update set
  name = excluded.name,
  license = excluded.license,
  license_url = excluded.license_url,
  source_url = excluded.source_url,
  default_country_code = excluded.default_country_code;

insert into public.nutrients (canonical_key, name_de, name_en, unit, nutrient_group)
values
  ('energy_kcal', 'Energie', 'Energy', 'kcal', 'macro'),
  ('protein', 'Eiweiß', 'Protein', 'g', 'macro'),
  ('carbohydrate', 'Kohlenhydrate', 'Carbohydrate', 'g', 'macro'),
  ('fat', 'Fett', 'Total fat', 'g', 'macro'),
  ('vitamin_a', 'Vitamin A', 'Vitamin A', 'µg', 'vitamin'),
  ('vitamin_d', 'Vitamin D', 'Vitamin D', 'µg', 'vitamin'),
  ('vitamin_e', 'Vitamin E', 'Vitamin E', 'mg', 'vitamin'),
  ('vitamin_k', 'Vitamin K', 'Vitamin K', 'µg', 'vitamin'),
  ('vitamin_c', 'Vitamin C', 'Vitamin C', 'mg', 'vitamin'),
  ('thiamin', 'Thiamin', 'Thiamin', 'mg', 'vitamin'),
  ('riboflavin', 'Riboflavin', 'Riboflavin', 'mg', 'vitamin'),
  ('niacin', 'Niacin', 'Niacin', 'mg', 'vitamin'),
  ('vitamin_b6', 'Vitamin B6', 'Vitamin B6', 'mg', 'vitamin'),
  ('pantothenic_acid', 'Pantothensäure', 'Pantothenic acid', 'mg', 'vitamin'),
  ('biotin', 'Biotin', 'Biotin', 'µg', 'vitamin'),
  ('folate', 'Folat', 'Folate', 'µg', 'vitamin'),
  ('vitamin_b12', 'Vitamin B12', 'Vitamin B12', 'µg', 'vitamin'),
  ('calcium', 'Calcium', 'Calcium', 'mg', 'mineral'),
  ('magnesium', 'Magnesium', 'Magnesium', 'mg', 'mineral'),
  ('phosphorus', 'Phosphor', 'Phosphorus', 'mg', 'mineral'),
  ('iron', 'Eisen', 'Iron', 'mg', 'mineral'),
  ('zinc', 'Zink', 'Zinc', 'mg', 'mineral'),
  ('copper', 'Kupfer', 'Copper', 'mg', 'mineral'),
  ('manganese', 'Mangan', 'Manganese', 'mg', 'mineral'),
  ('sodium', 'Natrium', 'Sodium', 'mg', 'mineral'),
  ('iodine', 'Jod', 'Iodine', 'µg', 'mineral'),
  ('selenium', 'Selen', 'Selenium', 'µg', 'mineral'),
  ('potassium', 'Kalium', 'Potassium', 'mg', 'mineral')
on conflict (canonical_key) do update set
  name_de = excluded.name_de,
  name_en = excluded.name_en,
  unit = excluded.unit,
  nutrient_group = excluded.nutrient_group;

create index if not exists foods_search_name_trgm_idx on public.foods using gin (normalized_name gin_trgm_ops) where is_active;
create index if not exists foods_brand_trgm_idx on public.foods using gin (lower(coalesce(brand, '')) gin_trgm_ops) where is_active;
create index if not exists foods_country_kind_idx on public.foods (country_code, kind, is_active);
create index if not exists food_names_search_name_trgm_idx on public.food_names using gin (normalized_name gin_trgm_ops);
create index if not exists food_barcodes_food_idx on public.food_barcodes (food_id);
create index if not exists food_nutrients_food_idx on public.food_nutrients (food_id, nutrient_id, basis_amount, basis_unit);
create index if not exists food_source_records_source_idx on public.food_source_records (source_code, source_record_id);
create index if not exists food_entries_food_idx on public.food_entries (food_id) where deleted_at is null;

create or replace function public.search_foods(search_query text, result_limit integer default 25)
returns table (
  id uuid,
  name_de text,
  name_en text,
  brand text,
  kind text,
  preparation_state text,
  basis_unit text,
  calories_per_100 numeric,
  protein_per_100 numeric,
  carbs_per_100 numeric,
  fat_per_100 numeric,
  source text,
  source_record_id text,
  nutrient_coverage numeric,
  micronutrients jsonb,
  portions jsonb
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with input as (
    select lower(unaccent(trim(search_query))) as query,
           greatest(1, least(coalesce(result_limit, 25), 80)) as max_results
  ),
  ranked as (
    select f.*,
      case
        when lower(unaccent(f.name_de)) = input.query then 1000
        when lower(unaccent(f.name_de)) like input.query || '%' then 800
        when exists (
          select 1 from public.food_names alias
          where alias.food_id = f.id and alias.normalized_name = input.query
        ) then 760
        when lower(unaccent(coalesce(f.brand, ''))) = input.query then 450
        when lower(unaccent(f.name_de)) like '%' || input.query || '%' then 500
        when lower(unaccent(coalesce(f.brand, ''))) like input.query || '%' then 350
        when lower(unaccent(coalesce(f.brand, ''))) like '%' || input.query || '%' then 250
        else 100 * similarity(f.normalized_name, input.query)
      end
      + case when f.country_code = 'DE' then 60 else 0 end
      + case when f.kind = 'recipe' then -350 else 0 end as rank_score
    from public.foods f cross join input
    where f.is_active
      and char_length(input.query) between 2 and 80
      and (
        lower(unaccent(f.name_de)) like '%' || input.query || '%'
        or lower(unaccent(coalesce(f.name_en, ''))) like '%' || input.query || '%'
        or lower(unaccent(coalesce(f.brand, ''))) like '%' || input.query || '%'
        or exists (
          select 1 from public.food_names alias
          where alias.food_id = f.id
            and alias.normalized_name like '%' || input.query || '%'
        )
        or f.normalized_name % input.query
      )
    order by rank_score desc, f.name_de asc, f.id asc
    limit (select max_results from input)
  )
  select ranked.id,
    ranked.name_de,
    ranked.name_en,
    ranked.brand,
    ranked.kind,
    ranked.preparation_state,
    coalesce(energy.basis_unit, macros.basis_unit, 'g') as basis_unit,
    energy.value as calories_per_100,
    macros.protein_value as protein_per_100,
    macros.carbs_value as carbs_per_100,
    macros.fat_value as fat_per_100,
    primary_source.source_code as source,
    primary_source.source_record_id,
    coalesce((ranked.nutrient_coverage ->> 'percentage')::numeric, 0) as nutrient_coverage,
    coalesce(micro.values, '{}'::jsonb) as micronutrients,
    coalesce(portion.values, '[]'::jsonb) as portions
  from ranked
  left join lateral (
    select fn.value, fn.basis_unit
    from public.food_nutrients fn
    join public.nutrients n on n.id = fn.nutrient_id and n.canonical_key = 'energy_kcal'
    where fn.food_id = ranked.id and fn.basis_amount = 100
    order by fn.updated_at desc
    limit 1
  ) energy on true
  left join lateral (
    select
      max(fn.basis_unit) filter (where n.canonical_key = 'protein') as basis_unit,
      max(fn.value) filter (where n.canonical_key = 'protein') as protein_value,
      max(fn.value) filter (where n.canonical_key = 'carbohydrate') as carbs_value,
      max(fn.value) filter (where n.canonical_key = 'fat') as fat_value
    from public.food_nutrients fn
    join public.nutrients n on n.id = fn.nutrient_id
    where fn.food_id = ranked.id and fn.basis_amount = 100
  ) macros on true
  left join lateral (
    select fn.source_code, fn.source_external_id as source_record_id
    from public.food_nutrients fn
    where fn.food_id = ranked.id
    order by fn.updated_at desc
    limit 1
  ) primary_source on true
  left join lateral (
    select jsonb_object_agg(n.canonical_key, jsonb_build_object(
      'value', fn.value,
      'unit', fn.unit,
      'basisAmount', fn.basis_amount,
      'basisUnit', fn.basis_unit,
      'source', fn.source_code,
      'sourceRecordId', fn.source_external_id,
      'derivation', fn.derivation,
      'valueStatus', fn.value_status,
      'confidence', fn.confidence,
      'provenance', fn.provenance
    )) as values
    from public.food_nutrients fn
    join public.nutrients n on n.id = fn.nutrient_id
    where fn.food_id = ranked.id and fn.basis_amount = 100
  ) micro on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'label', fp.label_de,
      'amount', fp.amount,
      'unit', fp.unit,
      'grams', fp.grams
    ) order by fp.is_default desc, fp.label_de asc) as values
    from public.food_portions fp
    where fp.food_id = ranked.id
  ) portion on true;
$$;

revoke execute on function public.search_foods(text, integer) from public;
grant usage on schema public to anon, authenticated;
grant select on public.food_sources, public.foods, public.food_categories, public.nutrients,
  public.food_names, public.food_barcodes, public.food_nutrients, public.food_portions,
  public.food_relationships to anon, authenticated;
grant execute on function public.search_foods(text, integer) to anon, authenticated;

do $$
declare
  catalog_table text;
begin
  foreach catalog_table in array array[
    'food_sources', 'nutrients', 'food_categories', 'foods', 'food_source_records',
    'food_source_links', 'food_names', 'food_barcodes', 'food_nutrient_observations',
    'food_nutrients', 'food_portions', 'food_relationships', 'food_reference_mappings',
    'food_reference_nutrient_rules', 'food_identity_mappings', 'food_import_runs', 'food_quality_flags'
  ]
  loop
    execute format('alter table public.%I enable row level security', catalog_table);
  end loop;
end;
$$;

create policy "public_active_food_sources_read" on public.food_sources for select to anon, authenticated using (is_active);
create policy "public_active_foods_read" on public.foods for select to anon, authenticated using (is_active);
create policy "public_food_categories_read" on public.food_categories for select to anon, authenticated using (true);
create policy "public_active_nutrients_read" on public.nutrients for select to anon, authenticated using (is_active);
create policy "public_food_names_read" on public.food_names for select to anon, authenticated using (
  exists (select 1 from public.foods f where f.id = food_names.food_id and f.is_active)
);
create policy "public_food_barcodes_read" on public.food_barcodes for select to anon, authenticated using (
  exists (select 1 from public.foods f where f.id = food_barcodes.food_id and f.is_active)
);
create policy "public_food_nutrients_read" on public.food_nutrients for select to anon, authenticated using (
  exists (select 1 from public.foods f where f.id = food_nutrients.food_id and f.is_active)
);
create policy "public_food_portions_read" on public.food_portions for select to anon, authenticated using (
  exists (select 1 from public.foods f where f.id = food_portions.food_id and f.is_active)
);
create policy "public_food_relationships_read" on public.food_relationships for select to anon, authenticated using (
  exists (select 1 from public.foods f where f.id = food_relationships.parent_food_id and f.is_active)
  and exists (select 1 from public.foods f where f.id = food_relationships.child_food_id and f.is_active)
);

create policy "catalog_private_records_denied" on public.food_source_records for all to anon, authenticated using (false) with check (false);
create policy "catalog_private_links_denied" on public.food_source_links for all to anon, authenticated using (false) with check (false);
create policy "catalog_private_observations_denied" on public.food_nutrient_observations for all to anon, authenticated using (false) with check (false);
create policy "catalog_private_mappings_denied" on public.food_reference_mappings for all to anon, authenticated using (false) with check (false);
create policy "catalog_private_rules_denied" on public.food_reference_nutrient_rules for all to anon, authenticated using (false) with check (false);
create policy "catalog_private_identity_mappings_denied" on public.food_identity_mappings for all to anon, authenticated using (false) with check (false);
create policy "catalog_private_import_runs_denied" on public.food_import_runs for all to anon, authenticated using (false) with check (false);
create policy "catalog_private_quality_flags_denied" on public.food_quality_flags for all to anon, authenticated using (false) with check (false);

revoke all on table public.food_source_records, public.food_source_links, public.food_nutrient_observations,
  public.food_reference_mappings, public.food_reference_nutrient_rules, public.food_import_runs,
  public.food_identity_mappings, public.food_quality_flags from anon, authenticated;
