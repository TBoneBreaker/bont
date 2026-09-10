-- Keep short German queries token-aware. In particular, "ei" must not match
-- the middle of unrelated words such as "Fleisch".
-- This only removes catalog aliases created by the previous overly broad rule.

delete from public.food_names alias
using public.foods f
where alias.food_id = f.id
  and alias.name_type = 'alias'
  and alias.normalized_name = 'ei'
  and f.normalized_name !~ '(^| )(ei|eier|huhnerei|huhnereier)( |$)';

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
security definer
set search_path = public, extensions, pg_temp
as $$
  with input as (
    select lower(unaccent(trim(search_query))) as query,
           greatest(1, least(coalesce(result_limit, 25), 80)) as max_results
  ),
  variants as (
    select query, max_results,
      case query
        when 'ei' then array['ei', 'eier', 'huhnerei', 'huhnereier']::text[]
        when 'eier' then array['eier', 'huhnerei', 'huhnereier']::text[]
        when 'apfel' then array['apfel', 'aepfel']::text[]
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
          when char_length(v.query) >= 3
            and f.normalized_name like any (select '%' || term || '%' from unnest(v.terms) term) then 420
          when lower(unaccent(coalesce(f.brand, ''))) = any (v.terms) then 470
          when lower(unaccent(coalesce(f.brand, ''))) like any (select term || '%' from unnest(v.terms) term) then 350
          when char_length(v.query) >= 3
            and lower(unaccent(coalesce(f.brand, ''))) like any (select '%' || term || '%' from unnest(v.terms) term) then 250
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
        f.normalized_name = any (v.terms)
        or f.normalized_name ~ any (select ('(^| )' || term || '( |$)') from unnest(v.terms) term)
        or f.normalized_name like any (select term || '%' from unnest(v.terms) term)
        or lower(unaccent(coalesce(f.name_en, ''))) like '%' || v.query || '%'
        or lower(unaccent(coalesce(f.brand, ''))) like '%' || v.query || '%'
        or exists (
          select 1 from public.food_names alias
          where alias.food_id = f.id
            and (
              alias.normalized_name = any (v.terms)
              or alias.normalized_name ~ any (select ('(^| )' || term || '( |$)') from unnest(v.terms) term)
              or alias.normalized_name like any (select term || '%' from unnest(v.terms) term)
              or (char_length(v.query) >= 3 and alias.normalized_name like any (select '%' || term || '%' from unnest(v.terms) term))
            )
        )
        or (char_length(v.query) >= 3 and f.normalized_name like any (select '%' || term || '%' from unnest(v.terms) term))
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
