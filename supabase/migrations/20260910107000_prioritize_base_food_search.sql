-- Prefer simple base foods for generic queries while retaining preparation
-- variants and compound foods in the result set.
do $$
declare
  definition text;
  updated_definition text;
begin
  select pg_get_functiondef(p.oid)
  into definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'search_foods'
    and p.proargtypes = '25 23'::oidvector;

  if definition is null then
    raise exception 'search_foods(text, integer) does not exist';
  end if;

  updated_definition := replace(
    definition,
    $marker$        + least(100, greatest(0, coalesce((f.nutrient_coverage ->> 'percentage')::numeric, 0)))$marker$,
    $replacement$        + case when f.preparation_state = 'raw' then 80 when f.preparation_state = 'unknown' then 20 else 0 end
        - case
            when array_length(regexp_split_to_array(f.normalized_name, '\s+'), 1) >= 4
              or f.normalized_name ~ '(^| )(mit|und|sauce|salat|kuchen|auflauf|mus|püree|puree)( |$)'
              then 300
            else 0
          end
        + least(100, greatest(0, coalesce((f.nutrient_coverage ->> 'percentage')::numeric, 0)))$replacement$
  );

  if updated_definition = definition then
    raise exception 'search_foods ranking marker was not found';
  end if;

  execute updated_definition;
end;
$$;

revoke execute on function public.search_foods(text, integer) from public;
grant execute on function public.search_foods(text, integer) to anon, authenticated;
