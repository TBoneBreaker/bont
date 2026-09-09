# Food-catalog import runbook

The importer has two modes:

- `catalog:dry-run` parses and validates source data without network or
  database writes.
- `catalog:import` uses the server-only Supabase loader. It requires the
  loader migration and an explicit `--confirm-production` flag.

The loader processes one canonical record per database transaction. Source
records, links, observations, selected nutrients, portions and quality flags
are upserted together. A failed record is rolled back and recorded in
`food_import_runs.errors`; other records continue. Existing user-owned tables,
including `food_entries`, are never written by the loader.

## Required environment

Set these variables in the shell that runs the CLI. The importer does not read
`.env` files automatically.

```powershell
$env:SUPABASE_URL = 'https://<project-ref>.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY = '<server-only-secret>'
```

`SUPABASE_SERVICE_ROLE_KEY` must remain server-side and must never be placed in
a `VITE_` variable or committed. `USDA_FDC_API_KEY` is optional when importing
a prepared USDA file. It is required only when the importer downloads USDA
Foundation/SR Legacy pages itself.

Before the first write, apply the repository migration
`20260909190000_add_food_catalog_import_loader.sql` through the normal
Supabase migration workflow. This task does not apply it automatically.

## Dry runs

```powershell
npm run catalog:dry-run -- --source bls --input C:\data\BLS_4_0_Daten_2025_DE.xlsx
npm run catalog:dry-run -- --source usda --input C:\data\FoundationFoods.json
npm run catalog:dry-run -- --source open_food_facts --input C:\data\products.jsonl --countries DE,AT
```

Use `--output .\tmp\<source>.jsonl` to keep a validated canonical artifact.
No missing nutrient is converted to zero. Unknown units and invalid portions
are rejected or reported as quality errors.

## Production import order

Run BLS first, then USDA, then the Germany-/market-filtered Open Food Facts
export. The loader uses stable source IDs and `foods.dedupe_key`; rerunning the
same input updates the existing catalog records instead of creating
duplicates. BLS canonical nutrients have priority over USDA reference values;
declared branded values keep their source and provenance.

```powershell
npm run catalog:import -- --source bls --input C:\data\BLS_4_0_Daten_2025_DE.xlsx --source-version BLS-4.0 --confirm-production
npm run catalog:import -- --source usda --input C:\data\FoundationFoods.json --source-version USDA-Foundation --confirm-production
npm run catalog:import -- --source open_food_facts --input C:\data\open-food-facts-de.jsonl --countries DE --source-version OFF-DE-2026-09 --confirm-production
```

If no `--input` is supplied for USDA and `USDA_FDC_API_KEY` is present, the
CLI downloads the paginated Foundation/SR Legacy API response to a temporary
file, imports it, and removes the temporary file. Use
`--usda-data-types "Foundation,SR Legacy,Branded"` to request additional USDA
data types. If the key is absent, USDA is skipped with an explicit summary
instead of failing silently.

Open Food Facts large exports must be JSONL and should be filtered to the
relevant countries before import. Worldwide dumps are not an acceptable
production input.

## Required verification

After each run, inspect the JSON summary and `food_import_runs`. Verify source
counts, failed-record errors, quality flags, nutrient coverage, portions,
canonical source priority and search ranking with representative foods before
promoting a new source export.
