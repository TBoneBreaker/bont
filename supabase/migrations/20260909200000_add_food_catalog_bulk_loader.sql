-- Batch wrapper for the existing per-record loader.
-- Each record is isolated in a PL/pgSQL exception block, so one bad source
-- record does not roll back the rest of the batch or touch user-owned data.

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

  for v_record in
    select value from jsonb_array_elements(p_records)
  loop
    begin
      v_result := public.import_food_catalog_record(
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

revoke all on function public.import_food_catalog_records(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_food_catalog_records(uuid, jsonb) to service_role;
