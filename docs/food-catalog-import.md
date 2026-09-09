# Food-catalog import runbook

The importer is intentionally a dry-run tool. It creates validated JSONL
artifacts but does not have a production write path.

```powershell
npm run catalog:dry-run -- --source bls --input C:\data\BLS_4_0_Daten_2025_DE.xlsx --output .\tmp\bls.jsonl
npm run catalog:dry-run -- --source usda --input C:\data\FoundationFoods.json
npm run catalog:dry-run -- --source open_food_facts --input C:\data\products.jsonl --countries DE,AT
```

The OFF command must use a JSONL export for large datasets. Country filtering
happens before canonicalization, so a worldwide dump is not copied into the
production catalog. Small JSON/API dumps are accepted as well.

Each output row contains the deduplication key, the source payloads, selected
nutrients, provenance, rejected reference nutrients, conflicts, coverage and
quality flags. A quality flag is reported, not silently corrected.

## Required staging gates

Before a loader is enabled, run a small representative sample in staging and
verify:

- BLS wins over conflicting USDA values for generic German foods.
- USDA fills only missing nutrients with a matching state/definition.
- Brand declarations win over reference values.
- Raw, cooked and other preparation states remain separate.
- NULL/unknown is not serialized as nutrient zero.
- GTIN matching is stable and invalid checksums are rejected.
- Search exact/prefix/brand/recipe ranking is deterministic.
- Import counts, rejected mappings, quality flags, query latency and response
  size are recorded.

Only after these checks should the migration and a bounded production import be
approved. The importer does not read `USDA_FDC_API_KEY`, service-role keys or
any `.env` file.
