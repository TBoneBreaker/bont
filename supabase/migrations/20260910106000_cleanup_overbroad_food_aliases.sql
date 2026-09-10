-- The initial catalog import attached short aliases to any compound name that
-- contained a food word. Keep aliases only when they describe the complete
-- normalized food identity; compound names already receive token/prefix ranks.
delete from public.food_names alias
using public.foods f
where alias.food_id = f.id
  and alias.name_type = 'alias'
  and alias.normalized_name in ('ei', 'apfel', 'kartoffel', 'banane', 'tomate')
  and alias.normalized_name <> f.normalized_name;
