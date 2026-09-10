-- Generic ingredient queries should still return soups, juices and similar
-- prepared products, but after the simple ingredient variants.
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
    $replacement$        - case
            when f.normalized_name ~ '(^| )(suppe|creme|schupfnudel|kloß|kloess|püree|puree|stärke|staerke|sticks|salat|auflauf|saft|essig|wein|mus|kuchen|nektar|chips|pizza|sauce)( |$)'
              then 260
            else 0
          end
        + least(100, greatest(0, coalesce((f.nutrient_coverage ->> 'percentage')::numeric, 0)))$replacement$
  );

  if updated_definition = definition then
    raise exception 'compound product search marker was not found';
  end if;

  execute updated_definition;
end;
$$;

revoke execute on function public.search_foods(text, integer) from public;
grant execute on function public.search_foods(text, integer) to anon, authenticated;
