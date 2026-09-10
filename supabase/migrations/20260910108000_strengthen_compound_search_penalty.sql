-- Three-token names are already compound/prepared descriptions for the
-- generic search use case (for example, "Kartoffel Schupfnudeln roh").
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
    $marker$array_length(regexp_split_to_array(f.normalized_name, 's+'), 1) >= 4$marker$,
    $replacement$array_length(string_to_array(f.normalized_name, ' '), 1) >= 3$replacement$
  );

  if updated_definition = definition then
    raise exception 'compound search penalty marker was not found';
  end if;

  execute updated_definition;
end;
$$;

revoke execute on function public.search_foods(text, integer) from public;
grant execute on function public.search_foods(text, integer) to anon, authenticated;
