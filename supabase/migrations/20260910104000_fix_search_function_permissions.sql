-- The public read-only search function may inspect private catalog link tables
-- for ranking, but it returns only the existing bounded result shape.
-- No table data is changed.

alter function public.search_foods(text, integer) security definer;
alter function public.search_foods(text, integer) set search_path = public, extensions, pg_temp;
revoke execute on function public.search_foods(text, integer) from public;
grant execute on function public.search_foods(text, integer) to anon, authenticated;
