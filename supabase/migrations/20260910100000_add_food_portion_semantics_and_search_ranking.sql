-- Additive catalog metadata and search ranking improvements.
-- This migration does not delete or update user-owned rows.

alter table public.food_portions
  add column if not exists portion_type text not null default 'serving',
  add column if not exists exactness text not null default 'estimated',
  add column if not exists source_code text references public.food_sources(code) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'food_portions_portion_type_check'
      and conrelid = 'public.food_portions'::regclass
  ) then
    alter table public.food_portions add constraint food_portions_portion_type_check check (
      portion_type in (
        'whole_fruit', 'whole_vegetable', 'egg', 'bread_slice', 'toast_slice',
        'crispbread', 'cheese_slice', 'deli_slice', 'bar', 'cup', 'package',
        'can', 'bottle', 'spoonable', 'tortilla', 'roll', 'piece', 'serving'
      )
    );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'food_portions_exactness_check'
      and conrelid = 'public.food_portions'::regclass
  ) then
    alter table public.food_portions add constraint food_portions_exactness_check check (
      exactness in ('exact', 'estimated')
    );
  end if;
end;
$$;

create or replace function public.sync_food_catalog_metadata(
  p_food_id uuid,
  p_identity jsonb,
  p_portions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_alias jsonb;
  v_portion jsonb;
  v_alias_text text;
  v_normalized_alias text;
  v_source_code text;
  v_source_record_id text;
  v_source_record_uuid uuid;
  v_primary_source_record_uuid uuid;
  v_alias_count integer := 0;
  v_portion_count integer := 0;
begin
  if coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '') <> 'service_role'
     and coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'role' <> 'service_role'
     and coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Food catalog metadata sync requires the service_role role.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.foods where id = p_food_id) then
    raise exception 'Food % does not exist.', p_food_id using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_identity, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_portions, '[]'::jsonb)) <> 'array' then
    raise exception 'Food metadata payload has an invalid shape.' using errcode = '22023';
  end if;

  for v_alias in select value from jsonb_array_elements(coalesce(p_identity -> 'aliases', '[]'::jsonb)) loop
    v_alias_text := nullif(trim(v_alias #>> '{}'), '');
    v_normalized_alias := nullif(lower(unaccent(v_alias_text)), '');
    if v_alias_text is not null and v_normalized_alias is not null then
      insert into public.food_names (food_id, name, normalized_name, language_code, name_type)
      values (p_food_id, v_alias_text, v_normalized_alias, 'de', 'alias')
      on conflict (food_id, normalized_name, language_code) do update set
        name = excluded.name,
        name_type = case when food_names.name_type = 'primary' then food_names.name_type else 'alias' end;
      v_alias_count := v_alias_count + 1;
    end if;
  end loop;

  select fsl.source_record_id
    into v_primary_source_record_uuid
  from public.food_source_links fsl
  where fsl.food_id = p_food_id and fsl.is_primary
  limit 1;

  for v_portion in select value from jsonb_array_elements(coalesce(p_portions, '[]'::jsonb)) loop
    if nullif(trim(v_portion ->> 'labelDe'), '') is null
       or coalesce((v_portion ->> 'amount')::numeric, 0) <= 0
       or v_portion ->> 'unit' not in ('g', 'ml', 'piece')
       or coalesce((v_portion ->> 'confidence')::numeric, -1) not between 0 and 1 then
      raise exception 'Invalid portion in metadata payload.' using errcode = '22023';
    end if;
    v_source_code := nullif(trim(v_portion ->> 'source'), '');
    v_source_record_id := nullif(trim(v_portion ->> 'sourceRecordId'), '');
    v_source_record_uuid := null;
    if v_source_code is not null and v_source_record_id is not null then
      select id into v_source_record_uuid
      from public.food_source_records
      where source_code = v_source_code and source_record_id = v_source_record_id;
    end if;
    if coalesce((v_portion ->> 'isDefault')::boolean, false) then
      update public.food_portions set is_default = false where food_id = p_food_id;
    end if;
    insert into public.food_portions (
      food_id, label_de, amount, unit, grams, source_record_id, confidence,
      is_default, portion_type, exactness, source_code
    )
    values (
      p_food_id,
      v_portion ->> 'labelDe',
      (v_portion ->> 'amount')::numeric,
      v_portion ->> 'unit',
      nullif(v_portion ->> 'grams', '')::numeric,
      coalesce(v_source_record_uuid, v_primary_source_record_uuid),
      (v_portion ->> 'confidence')::numeric,
      coalesce((v_portion ->> 'isDefault')::boolean, false),
      coalesce(nullif(v_portion ->> 'portionType', ''), 'serving'),
      coalesce(nullif(v_portion ->> 'exactness', ''), 'estimated'),
      v_source_code
    )
    on conflict (food_id, label_de) do update set
      amount = excluded.amount,
      unit = excluded.unit,
      grams = excluded.grams,
      source_record_id = excluded.source_record_id,
      confidence = excluded.confidence,
      is_default = excluded.is_default,
      portion_type = excluded.portion_type,
      exactness = excluded.exactness,
      source_code = excluded.source_code;
    v_portion_count := v_portion_count + 1;
  end loop;

  return jsonb_build_object('foodId', p_food_id, 'aliasesUpserted', v_alias_count, 'portionsUpserted', v_portion_count);
end;
$$;

revoke all on function public.sync_food_catalog_metadata(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.sync_food_catalog_metadata(uuid, jsonb, jsonb) to service_role;

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
  variants as (
    select query, max_results,
      case query
        when 'ei' then array['ei', 'eier', 'huhnerei', 'huhnereier']::text[]
        when 'eier' then array['ei', 'eier', 'huhnerei', 'huhnereier']::text[]
        when 'apfel' then array['apfel', 'apfel']::text[]
        when 'aepfel' then array['apfel', 'aepfel']::text[]
        when 'kartoffel' then array['kartoffel', 'kartoffeln']::text[]
        when 'kartoffeln' then array['kartoffel', 'kartoffeln']::text[]
        when 'nudel' then array['nudel', 'nudeln', 'pasta']::text[]
        when 'nudeln' then array['nudel', 'nudeln', 'pasta']::text[]
        when 'tomate' then array['tomate', 'tomaten']::text[]
        when 'tomaten' then array['tomate', 'tomaten']::text[]
        else array[query]::text[]
      end as terms
    from input
  ),
  ranked as (
    select f.*,
      max(
        case
          when f.normalized_name = any (v.terms) then 1600
          when exists (
            select 1 from public.food_names alias
            where alias.food_id = f.id and alias.name_type in ('alias', 'synonym')
              and alias.normalized_name = any (v.terms)
          ) then 1500
          when split_part(f.normalized_name, ' ', 1) = any (v.terms) then 1260
          when f.normalized_name ~ any (select ('(^| )' || term || '( |$)') from unnest(v.terms) term) then 980
          when f.normalized_name like any (select term || '%' from unnest(v.terms) term) then 760
          when f.normalized_name like any (select '%' || term || '%' from unnest(v.terms) term) then 420
          when lower(unaccent(coalesce(f.brand, ''))) = any (v.terms) then 470
          when lower(unaccent(coalesce(f.brand, ''))) like any (select term || '%' from unnest(v.terms) term) then 350
          when lower(unaccent(coalesce(f.brand, ''))) like any (select '%' || term || '%' from unnest(v.terms) term) then 250
          else 100 * similarity(f.normalized_name, v.query)
        end
        - case
            when f.normalized_name like any (select term || ' %' from unnest(v.terms) term)
             and substring(f.normalized_name from position(' ' in f.normalized_name) + 1)
               !~ '^(roh|raw|frisch|fresh|gekocht|cooked|gebraten|fried|gebacken|baked|geduenstet|gedampft|getrocknet|dried)( |$)'
              then 220
            else 0
          end
        + case when f.country_code = 'DE' then 60 else 0 end
        + case when f.kind = 'branded' then 15 else 0 end
        - case when f.kind = 'recipe' then 350 else 0 end
        + case when exists (
            select 1 from public.food_source_links fsl
            join public.food_source_records fsr on fsr.id = fsl.source_record_id
            where fsl.food_id = f.id and fsr.source_code = 'bls'
          ) then 45 else 0 end
        + least(100, greatest(0, coalesce((f.nutrient_coverage ->> 'percentage')::numeric, 0)))
      ) as rank_score
    from public.foods f cross join variants v
    where f.is_active
      and char_length(v.query) between 2 and 80
      and (
        f.normalized_name like any (select '%' || term || '%' from unnest(v.terms) term)
        or lower(unaccent(coalesce(f.name_en, ''))) like '%' || v.query || '%'
        or lower(unaccent(coalesce(f.brand, ''))) like '%' || v.query || '%'
        or exists (
          select 1 from public.food_names alias
          where alias.food_id = f.id
            and alias.normalized_name like any (select '%' || term || '%' from unnest(v.terms) term)
        )
        or f.normalized_name % v.query
      )
    group by f.id
    order by rank_score desc, f.name_de asc, f.id asc
    limit (select max_results from variants)
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
    order by case when fn.source_code = 'bls' then 1 when fn.source_code = 'usda' then 2 else 3 end, fn.updated_at desc
    limit 1
  ) primary_source on true
  left join lateral (
    select jsonb_object_agg(n.canonical_key, jsonb_build_object(
      'value', fn.value, 'unit', fn.unit, 'basisAmount', fn.basis_amount, 'basisUnit', fn.basis_unit,
      'source', fn.source_code, 'sourceRecordId', fn.source_external_id, 'derivation', fn.derivation,
      'valueStatus', fn.value_status, 'confidence', fn.confidence, 'provenance', fn.provenance
    )) as values
    from public.food_nutrients fn
    join public.nutrients n on n.id = fn.nutrient_id
    where fn.food_id = ranked.id and fn.basis_amount = 100
  ) micro on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'label', fp.label_de, 'amount', fp.amount, 'unit', fp.unit, 'grams', fp.grams,
      'portionType', fp.portion_type, 'exactness', fp.exactness, 'source', fp.source_code,
      'isDefault', fp.is_default
    ) order by fp.is_default desc, fp.label_de asc) as values
    from public.food_portions fp
    where fp.food_id = ranked.id
  ) portion on true;
$$;

revoke execute on function public.search_foods(text, integer) from public;
grant execute on function public.search_foods(text, integer) to anon, authenticated;
