-- Batch metadata synchronization for scalable catalog imports.
-- It only writes catalog metadata and never touches user-owned tables.

create or replace function public.sync_food_catalog_metadata_batch(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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
      v_result := public.sync_food_catalog_metadata(
        (v_item ->> 'foodId')::uuid,
        coalesce(v_item -> 'identity', '{}'::jsonb),
        coalesce(v_item -> 'portions', '[]'::jsonb)
      );
      v_results := v_results || jsonb_build_array(jsonb_build_object('index', v_index, 'ok', true, 'result', v_result));
    exception when others then
      v_results := v_results || jsonb_build_array(jsonb_build_object('index', v_index, 'ok', false, 'error', sqlerrm));
    end;
    v_index := v_index + 1;
  end loop;
  return v_results;
end;
$$;

revoke all on function public.sync_food_catalog_metadata_batch(jsonb) from public, anon, authenticated;
grant execute on function public.sync_food_catalog_metadata_batch(jsonb) to service_role;
