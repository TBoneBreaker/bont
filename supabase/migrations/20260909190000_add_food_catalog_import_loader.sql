-- Server-only, idempotent loader support for the canonical food catalog.
-- This migration does not touch user-owned tables or food_entries.

alter table public.foods
  add column if not exists dedupe_key text;

create unique index if not exists foods_dedupe_key_unique
  on public.foods (dedupe_key)
  where dedupe_key is not null;

create or replace function public.import_food_catalog_record(
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
  v_identity jsonb := coalesce(p_record -> 'identity', '{}'::jsonb);
  v_source_record jsonb;
  v_mapping jsonb;
  v_nutrient jsonb;
  v_portion jsonb;
  v_quality_flag jsonb;
  v_source_record_uuid uuid;
  v_primary_source_record_uuid uuid;
  v_food_id uuid;
  v_existing_food_id uuid;
  v_nutrient_id uuid;
  v_left_source_record_uuid uuid;
  v_right_source_record_uuid uuid;
  v_food_created boolean := false;
  v_source_record_count integer := 0;
  v_identity_mapping_count integer := 0;
  v_observation_count integer := 0;
  v_canonical_nutrient_count integer := 0;
  v_portion_count integer := 0;
  v_quality_flag_count integer := 0;
  v_rows integer;
  v_source_code text;
  v_source_record_id text;
  v_primary_source_code text;
  v_primary_source_external_id text;
  v_nutrient_key text;
  v_gtin text;
  v_name_de text := nullif(trim(v_identity ->> 'nameDe'), '');
  v_normalized_name text := nullif(trim(v_identity ->> 'normalizedName'), '');
  v_kind text := nullif(trim(v_identity ->> 'kind'), '');
  v_food_source_record_uuid uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Food catalog loader requires the service_role role.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.food_import_runs
    where id = p_run_id
      and status in ('planned', 'running')
  ) then
    raise exception 'Import run % does not exist or is not running.', p_run_id using errcode = '22023';
  end if;

  if nullif(trim(p_dedupe_key), '') is null then
    raise exception 'A non-empty dedupe key is required.' using errcode = '22023';
  end if;
  if v_name_de is null or v_kind is null then
    raise exception 'Canonical record identity is incomplete.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_record -> 'sourceRecords', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_record -> 'sourceRecords', '[]'::jsonb)) = 0 then
    raise exception 'At least one source record is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_dedupe_key, 0));

  select f.id
    into v_food_id
  from public.foods f
  where f.dedupe_key = p_dedupe_key
  order by f.is_active desc, f.id
  limit 1
  for update;

  if v_food_id is null then
    insert into public.foods (
      dedupe_key,
      kind,
      name_de,
      name_en,
      normalized_name,
      brand,
      manufacturer,
      category_id,
      subcategory,
      preparation_state,
      country_code,
      nutrient_coverage,
      data_quality,
      is_active
    )
    values (
      p_dedupe_key,
      v_kind,
      v_name_de,
      nullif(v_identity ->> 'nameEn', ''),
      coalesce(v_normalized_name, lower(v_name_de)),
      nullif(v_identity ->> 'brand', ''),
      nullif(v_identity ->> 'manufacturer', ''),
      null,
      nullif(v_identity ->> 'category', ''),
      coalesce(nullif(v_identity ->> 'preparationState', ''), 'unknown'),
      nullif(upper(v_identity ->> 'countryCode'), ''),
      coalesce(p_record -> 'nutrientCoverage', '{}'::jsonb),
      jsonb_build_object(
        'qualityFlags', coalesce(p_record -> 'qualityFlags', '[]'::jsonb),
        'rejectedReferenceNutrients', coalesce(p_record -> 'rejectedReferenceNutrients', '[]'::jsonb),
        'conflictingNutrients', coalesce(p_record -> 'conflictingNutrients', '[]'::jsonb)
      ),
      true
    )
    returning id into v_food_id;
    v_food_created := true;
  else
    update public.foods
    set
      kind = v_kind,
      name_de = v_name_de,
      name_en = coalesce(nullif(v_identity ->> 'nameEn', ''), foods.name_en),
      normalized_name = coalesce(v_normalized_name, lower(v_name_de)),
      brand = coalesce(nullif(v_identity ->> 'brand', ''), foods.brand),
      manufacturer = coalesce(nullif(v_identity ->> 'manufacturer', ''), foods.manufacturer),
      category_id = foods.category_id,
      subcategory = coalesce(nullif(v_identity ->> 'category', ''), foods.subcategory),
      preparation_state = coalesce(nullif(v_identity ->> 'preparationState', ''), 'unknown'),
      country_code = coalesce(nullif(upper(v_identity ->> 'countryCode'), ''), foods.country_code),
      nutrient_coverage = coalesce(p_record -> 'nutrientCoverage', '{}'::jsonb),
      data_quality = jsonb_build_object(
        'qualityFlags', coalesce(p_record -> 'qualityFlags', '[]'::jsonb),
        'rejectedReferenceNutrients', coalesce(p_record -> 'rejectedReferenceNutrients', '[]'::jsonb),
        'conflictingNutrients', coalesce(p_record -> 'conflictingNutrients', '[]'::jsonb)
      ),
      is_active = true,
      updated_at = timezone('utc', now())
    where id = v_food_id;
  end if;

  for v_source_record in
    select value from jsonb_array_elements(p_record -> 'sourceRecords')
  loop
    v_source_code := nullif(trim(v_source_record ->> 'source'), '');
    v_source_record_id := nullif(trim(v_source_record ->> 'sourceRecordId'), '');
    if v_source_code is null or v_source_code not in ('bls', 'usda', 'open_food_facts', 'manual') then
      raise exception 'Unsupported source code in canonical record.' using errcode = '22023';
    end if;
    if v_source_record_id is null then
      raise exception 'Source record ID is required.' using errcode = '22023';
    end if;
    if jsonb_typeof(coalesce(v_source_record -> 'rawPayload', '{}'::jsonb)) <> 'object' then
      raise exception 'Raw source payload must be a JSON object.' using errcode = '22023';
    end if;

    insert into public.food_source_records (
      source_code,
      source_record_id,
      source_updated_at,
      raw_payload,
      payload_fingerprint,
      imported_at
    )
    values (
      v_source_code,
      v_source_record_id,
      nullif(v_source_record ->> 'sourceUpdatedAt', '')::timestamptz,
      coalesce(v_source_record -> 'rawPayload', '{}'::jsonb),
      md5(coalesce(v_source_record -> 'rawPayload', '{}'::jsonb)::text),
      timezone('utc', now())
    )
    on conflict (source_code, source_record_id) do update set
      source_updated_at = excluded.source_updated_at,
      raw_payload = excluded.raw_payload,
      payload_fingerprint = excluded.payload_fingerprint,
      imported_at = excluded.imported_at
    returning id into v_source_record_uuid;
    v_source_record_count := v_source_record_count + 1;

    insert into public.food_source_links (
      food_id,
      source_record_id,
      mapping_method,
      mapping_confidence,
      is_primary
    )
    values (
      v_food_id,
      v_source_record_uuid,
      'source_id',
      1.0,
      v_primary_source_record_uuid is null
    )
    on conflict (source_record_id) do update set
      food_id = excluded.food_id,
      mapping_method = excluded.mapping_method,
      mapping_confidence = excluded.mapping_confidence,
      is_primary = excluded.is_primary;

    if v_primary_source_record_uuid is null then
      v_primary_source_record_uuid := v_source_record_uuid;
      v_primary_source_code := v_source_code;
      v_primary_source_external_id := v_source_record_id;
    end if;
  end loop;

  update public.food_source_links
  set is_primary = (source_record_id = v_primary_source_record_uuid)
  where food_id = v_food_id;

  insert into public.food_names (food_id, name, normalized_name, language_code, name_type)
  values (
    v_food_id,
    v_name_de,
    coalesce(v_normalized_name, lower(v_name_de)),
    'de',
    'primary'
  )
  on conflict (food_id, normalized_name, language_code) do update set
    name = excluded.name,
    name_type = 'primary';

  v_gtin := nullif(trim(v_identity ->> 'gtin'), '');
  if v_gtin is not null then
    select food_id into v_existing_food_id
    from public.food_barcodes
    where gtin14 = v_gtin;
    if v_existing_food_id is not null and v_existing_food_id <> v_food_id then
      raise exception 'Barcode % is already assigned to another food.', v_gtin using errcode = '23505';
    end if;
    insert into public.food_barcodes (
      food_id,
      gtin14,
      is_validated,
      source_record_id
    )
    values (v_food_id, v_gtin, true, v_primary_source_record_uuid)
    on conflict (gtin14) do update set
      food_id = excluded.food_id,
      is_validated = excluded.is_validated,
      source_record_id = excluded.source_record_id;
  end if;

  for v_mapping in
    select value from jsonb_array_elements(coalesce(p_record -> 'identityMappings', '[]'::jsonb))
  loop
    select id into v_left_source_record_uuid
    from public.food_source_records
    where source_code = v_mapping -> 'left' ->> 'source'
      and source_record_id = v_mapping -> 'left' ->> 'sourceRecordId';
    select id into v_right_source_record_uuid
    from public.food_source_records
    where source_code = v_mapping -> 'right' ->> 'source'
      and source_record_id = v_mapping -> 'right' ->> 'sourceRecordId';
    if v_left_source_record_uuid is null or v_right_source_record_uuid is null then
      raise exception 'Identity mapping references an unknown source record.' using errcode = '22023';
    end if;
    insert into public.food_identity_mappings (
      left_source_record_id,
      right_source_record_id,
      mapping_method,
      confidence,
      state_matches,
      definition_matches,
      manually_verified,
      reason
    )
    values (
      v_left_source_record_uuid,
      v_right_source_record_uuid,
      v_mapping ->> 'method',
      (v_mapping ->> 'confidence')::numeric,
      coalesce((v_mapping ->> 'stateMatches')::boolean, false),
      coalesce((v_mapping ->> 'definitionMatches')::boolean, false),
      coalesce((v_mapping ->> 'manuallyVerified')::boolean, false),
      coalesce(nullif(v_mapping ->> 'reason', ''), 'Imported identity mapping.')
    )
    on conflict (left_source_record_id, right_source_record_id) do update set
      mapping_method = excluded.mapping_method,
      confidence = excluded.confidence,
      state_matches = excluded.state_matches,
      definition_matches = excluded.definition_matches,
      manually_verified = excluded.manually_verified,
      reason = excluded.reason;
    v_identity_mapping_count := v_identity_mapping_count + 1;
  end loop;

  for v_nutrient in
    select value from jsonb_array_elements(coalesce(p_record -> 'nutrients', '[]'::jsonb))
  loop
    v_nutrient_key := nullif(trim(v_nutrient ->> 'nutrientKey'), '');
    v_source_code := nullif(trim(v_nutrient ->> 'source'), '');
    v_source_record_id := nullif(trim(v_nutrient ->> 'sourceRecordId'), '');
    select id into v_nutrient_id
    from public.nutrients
    where canonical_key = v_nutrient_key and is_active;
    select id into v_food_source_record_uuid
    from public.food_source_records
    where source_code = v_source_code and source_record_id = v_source_record_id;
    if v_nutrient_id is null or v_food_source_record_uuid is null then
      raise exception 'Nutrient % references an unknown nutrient or source record.', v_nutrient_key using errcode = '22023';
    end if;

    insert into public.food_nutrient_observations (
      food_id,
      source_record_id,
      nutrient_id,
      value,
      unit,
      basis_amount,
      basis_unit,
      value_status,
      observation_role,
      confidence,
      provenance
    )
    values (
      v_food_id,
      v_food_source_record_uuid,
      v_nutrient_id,
      nullif(v_nutrient ->> 'value', '')::numeric,
      v_nutrient ->> 'unit',
      (v_nutrient ->> 'basisAmount')::numeric,
      v_nutrient ->> 'basisUnit',
      v_nutrient ->> 'valueStatus',
      case when v_nutrient ->> 'derivation' = 'inherited_reference' then 'reference' else 'primary' end,
      (v_nutrient ->> 'confidence')::numeric,
      nullif(v_nutrient ->> 'provenance', '')
    )
    on conflict (food_id, source_record_id, nutrient_id, basis_amount, basis_unit) do update set
      value = excluded.value,
      unit = excluded.unit,
      value_status = excluded.value_status,
      observation_role = excluded.observation_role,
      confidence = excluded.confidence,
      provenance = excluded.provenance;
    v_observation_count := v_observation_count + 1;

    insert into public.food_nutrients (
      food_id,
      nutrient_id,
      value,
      unit,
      basis_amount,
      basis_unit,
      source_code,
      source_external_id,
      source_record_id,
      derivation,
      value_status,
      confidence,
      provenance,
      updated_at
    )
    values (
      v_food_id,
      v_nutrient_id,
      nullif(v_nutrient ->> 'value', '')::numeric,
      v_nutrient ->> 'unit',
      (v_nutrient ->> 'basisAmount')::numeric,
      v_nutrient ->> 'basisUnit',
      v_source_code,
      v_source_record_id,
      v_food_source_record_uuid,
      v_nutrient ->> 'derivation',
      v_nutrient ->> 'valueStatus',
      (v_nutrient ->> 'confidence')::numeric,
      nullif(v_nutrient ->> 'provenance', ''),
      timezone('utc', now())
    )
    on conflict (food_id, nutrient_id, basis_amount, basis_unit) do update set
      value = excluded.value,
      unit = excluded.unit,
      source_code = excluded.source_code,
      source_external_id = excluded.source_external_id,
      source_record_id = excluded.source_record_id,
      derivation = excluded.derivation,
      value_status = excluded.value_status,
      confidence = excluded.confidence,
      provenance = excluded.provenance,
      updated_at = excluded.updated_at
    where excluded.value is not null
      and (
        food_nutrients.value is null
        or
        case
          when v_kind = 'branded' and excluded.source_code = 'open_food_facts' and excluded.value_status = 'declared' then 110
          when v_kind = 'branded' and excluded.value_status = 'declared' then 105
          when excluded.source_code = 'manual' then 120
          when excluded.source_code = 'bls' then 100
          when excluded.source_code = 'usda' and excluded.derivation = 'inherited_reference' then 60
          when excluded.source_code = 'usda' then 80
          else 50
        end >=
        case
          when v_kind = 'branded' and food_nutrients.source_code = 'open_food_facts' and food_nutrients.value_status = 'declared' then 110
          when v_kind = 'branded' and food_nutrients.value_status = 'declared' then 105
          when food_nutrients.source_code = 'manual' then 120
          when food_nutrients.source_code = 'bls' then 100
          when food_nutrients.source_code = 'usda' and food_nutrients.derivation = 'inherited_reference' then 60
          when food_nutrients.source_code = 'usda' then 80
          else 50
        end
      );
    get diagnostics v_rows = row_count;
    v_canonical_nutrient_count := v_canonical_nutrient_count + v_rows;
  end loop;

  for v_portion in
    select value from jsonb_array_elements(coalesce(v_identity -> 'portions', p_record -> 'portions', '[]'::jsonb))
  loop
    if nullif(trim(v_portion ->> 'labelDe'), '') is null
       or (v_portion ->> 'amount')::numeric <= 0
       or (v_portion ->> 'unit') not in ('g', 'ml', 'piece') then
      raise exception 'Invalid portion in canonical record.' using errcode = '22023';
    end if;
    insert into public.food_portions (
      food_id,
      label_de,
      amount,
      unit,
      grams,
      source_record_id,
      confidence
    )
    values (
      v_food_id,
      v_portion ->> 'labelDe',
      (v_portion ->> 'amount')::numeric,
      v_portion ->> 'unit',
      nullif(v_portion ->> 'grams', '')::numeric,
      v_primary_source_record_uuid,
      (v_portion ->> 'confidence')::numeric
    )
    on conflict (food_id, label_de) do update set
      amount = excluded.amount,
      unit = excluded.unit,
      grams = excluded.grams,
      source_record_id = excluded.source_record_id,
      confidence = excluded.confidence;
    v_portion_count := v_portion_count + 1;
  end loop;

  delete from public.food_quality_flags
  where food_id = v_food_id
    and source_record_id in (
      select id
      from public.food_source_records
      where (source_code, source_record_id) in (
        select value ->> 'source', value ->> 'sourceRecordId'
        from jsonb_array_elements(p_record -> 'sourceRecords')
      )
    );

  for v_quality_flag in
    select value from jsonb_array_elements(coalesce(p_record -> 'qualityFlags', '[]'::jsonb))
  loop
    insert into public.food_quality_flags (
      food_id,
      source_record_id,
      flag_code,
      severity,
      message,
      details
    )
    values (
      v_food_id,
      v_primary_source_record_uuid,
      v_quality_flag ->> 'code',
      v_quality_flag ->> 'severity',
      coalesce(nullif(v_quality_flag ->> 'message', ''), 'Import quality flag.'),
      v_quality_flag
    );
    v_quality_flag_count := v_quality_flag_count + 1;
  end loop;

  return jsonb_build_object(
    'foodId', v_food_id,
    'foodCreated', v_food_created,
    'sourceRecordsUpserted', v_source_record_count,
    'identityMappingsUpserted', v_identity_mapping_count,
    'nutrientObservationsUpserted', v_observation_count,
    'canonicalNutrientsUpserted', v_canonical_nutrient_count,
    'portionsUpserted', v_portion_count,
    'qualityFlagsUpserted', v_quality_flag_count
  );
end;
$$;

revoke all on function public.import_food_catalog_record(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.import_food_catalog_record(uuid, text, jsonb) to service_role;
