-- Preserve the strongest source identity when multiple source imports reuse a food.
-- The existing per-record loader remains the transaction boundary.

create or replace function public.import_food_catalog_record_safe(
  p_run_id uuid,
  p_dedupe_key text,
  p_record jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before public.foods%rowtype;
  v_result jsonb;
  v_food_id uuid;
  v_had_bls_primary boolean := false;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Food catalog loader requires the service_role role.' using errcode = '42501';
  end if;

  select f.* into v_before
  from public.foods f
  where f.dedupe_key = p_dedupe_key
  for update;

  if found then
    select exists (
      select 1
      from public.food_source_links l
      join public.food_source_records sr on sr.id = l.source_record_id
      where l.food_id = v_before.id
        and l.is_primary
        and sr.source_code = 'bls'
    ) into v_had_bls_primary;
  end if;

  v_result := public.import_food_catalog_record(p_run_id, p_dedupe_key, p_record);
  v_food_id := (v_result ->> 'foodId')::uuid;

  if v_had_bls_primary then
    update public.foods
    set
      kind = v_before.kind,
      name_de = v_before.name_de,
      name_en = v_before.name_en,
      normalized_name = v_before.normalized_name,
      brand = v_before.brand,
      manufacturer = v_before.manufacturer,
      category_id = v_before.category_id,
      subcategory = v_before.subcategory,
      preparation_state = v_before.preparation_state,
      country_code = v_before.country_code,
      updated_at = timezone('utc', now())
    where id = v_food_id;
  end if;

  update public.food_source_links
  set is_primary = false
  where food_id = v_food_id;

  with ranked as (
    select l.food_id,
           l.source_record_id,
           row_number() over (
             partition by l.food_id
             order by
               case
                 when f.kind = 'branded' and sr.source_code = 'open_food_facts' then 110
                 when f.kind = 'branded' and sr.source_code = 'usda' then 105
                 when sr.source_code = 'bls' then 100
                 when sr.source_code = 'usda' then 80
                 when sr.source_code = 'open_food_facts' then 50
                 else 10
               end desc,
               l.created_at asc,
               l.source_record_id
           ) as position
    from public.food_source_links l
    join public.food_source_records sr on sr.id = l.source_record_id
    join public.foods f on f.id = l.food_id
    where l.food_id = v_food_id
  )
  update public.food_source_links l
  set is_primary = true
  from ranked r
  where l.food_id = r.food_id
    and l.source_record_id = r.source_record_id
    and r.position = 1;

  return v_result;
end;
$$;

create or replace function public.import_food_catalog_records(
  p_run_id uuid,
  p_records jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_record jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Food catalog loader requires the service_role role.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'A JSON array of canonical records is required.' using errcode = '22023';
  end if;

  for v_record in select value from jsonb_array_elements(p_records)
  loop
    begin
      v_result := public.import_food_catalog_record_safe(
        p_run_id,
        v_record ->> 'dedupeKey',
        v_record
      );
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'ok', true,
        'dedupeKey', v_record ->> 'dedupeKey',
        'result', v_result
      ));
    exception when others then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'ok', false,
        'dedupeKey', v_record ->> 'dedupeKey',
        'error', sqlerrm
      ));
    end;
  end loop;
  return v_results;
end;
$$;

revoke all on function public.import_food_catalog_record_safe(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.import_food_catalog_record_safe(uuid, text, jsonb) to service_role;
revoke all on function public.import_food_catalog_records(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_food_catalog_records(uuid, jsonb) to service_role;
