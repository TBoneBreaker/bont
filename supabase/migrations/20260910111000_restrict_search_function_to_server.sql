-- search_foods reads private catalog tables for ranking. Keep the function
-- definer-safe, but expose it only to the server-side service role; the public
-- /api/foods proxy remains the sole client-facing search boundary.
revoke execute on function public.search_foods(text, integer) from public, anon, authenticated;
grant execute on function public.search_foods(text, integer) to service_role;
