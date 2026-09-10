-- The catalog loader performs many provenance-preserving upserts per record.
-- Give the server-side batch wrapper enough time while retaining a bounded limit.
-- No table data is modified by this migration.

alter function public.import_food_catalog_record(uuid, text, jsonb)
  set statement_timeout = '60s';
alter function public.import_food_catalog_records(uuid, jsonb)
  set statement_timeout = '60s';
