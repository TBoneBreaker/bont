-- Keep catalog metadata normalization available inside the security-definer functions.
-- This is a function-definition fix only; no rows are deleted or rewritten.

create or replace function public.sync_food_catalog_metadata(
  p_food_id uuid,
  p_identity jsonb,
  p_portions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
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

  select fsl.source_record_id into v_primary_source_record_uuid
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
      select id into v_source_record_uuid from public.food_source_records
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
      p_food_id, v_portion ->> 'labelDe', (v_portion ->> 'amount')::numeric, v_portion ->> 'unit',
      nullif(v_portion ->> 'grams', '')::numeric, coalesce(v_source_record_uuid, v_primary_source_record_uuid),
      (v_portion ->> 'confidence')::numeric, coalesce((v_portion ->> 'isDefault')::boolean, false),
      coalesce(nullif(v_portion ->> 'portionType', ''), 'serving'),
      coalesce(nullif(v_portion ->> 'exactness', ''), 'estimated'), v_source_code
    )
    on conflict (food_id, label_de) do update set
      amount = excluded.amount, unit = excluded.unit, grams = excluded.grams,
      source_record_id = excluded.source_record_id, confidence = excluded.confidence,
      is_default = excluded.is_default, portion_type = excluded.portion_type,
      exactness = excluded.exactness, source_code = excluded.source_code;
    v_portion_count := v_portion_count + 1;
  end loop;
  return jsonb_build_object('foodId', p_food_id, 'aliasesUpserted', v_alias_count, 'portionsUpserted', v_portion_count);
end;
$$;

create or replace function public.sync_food_catalog_metadata_batch(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_item jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_index integer := 0;
begin
  if coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '') <> 'service_role'
     and coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'role' <> 'service_role'
     and coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Food catalog metadata batch requires the service_role role.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Food metadata batch must be a JSON array.' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      v_result := public.sync_food_catalog_metadata((v_item ->> 'foodId')::uuid, coalesce(v_item -> 'identity', '{}'::jsonb), coalesce(v_item -> 'portions', '[]'::jsonb));
      v_results := v_results || jsonb_build_array(jsonb_build_object('index', v_index, 'ok', true, 'result', v_result));
    exception when others then
      v_results := v_results || jsonb_build_array(jsonb_build_object('index', v_index, 'ok', false, 'error', sqlerrm));
    end;
    v_index := v_index + 1;
  end loop;
  return v_results;
end;
$$;

revoke all on function public.sync_food_catalog_metadata(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.sync_food_catalog_metadata_batch(jsonb) from public, anon, authenticated;
grant execute on function public.sync_food_catalog_metadata(uuid, jsonb, jsonb) to service_role;
grant execute on function public.sync_food_catalog_metadata_batch(jsonb) to service_role;
