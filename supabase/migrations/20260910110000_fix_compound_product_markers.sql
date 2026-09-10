-- Match compound product markers inside normalized tokens as well, e.g.
-- "gemüsecremesuppe".
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
    $marker$'(^| )(suppe|creme|schupfnudel|kloß|kloess|püree|puree|stärke|staerke|sticks|salat|auflauf|saft|essig|wein|mus|kuchen|nektar|chips|pizza|sauce)( |$)'$marker$,
    $replacement$'(suppe|creme|schupfnudel|kloß|kloess|püree|puree|stärke|staerke|sticks|salat|auflauf|saft|essig|wein|mus|kuchen|nektar|chips|pizza|sauce)'$replacement$
  );

  if updated_definition = definition then
    raise exception 'compound product marker was not found';
  end if;

  execute updated_definition;
end;
$$;

revoke execute on function public.search_foods(text, integer) from public;
grant execute on function public.search_foods(text, integer) to anon, authenticated;
