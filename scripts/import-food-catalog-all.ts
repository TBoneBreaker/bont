import { access } from 'node:fs/promises'
import { basename } from 'node:path'
import {
  buildCanonicalRecord,
  type CanonicalImportRecord,
} from '../src/lib/food-catalog/import-record.ts'
import { groupDuplicateFoods, foodDedupeKey } from '../src/lib/food-catalog/dedupe.ts'
import {
  loadCatalogRecords,
  type CatalogImportResult,
} from '../src/lib/food-catalog/loader.ts'
import { buildSafeCrossSourceMappings } from '../src/lib/food-catalog/source-mapping.ts'
import { nutrientDefinitions } from '../src/lib/food-catalog/source-mappings.ts'
import type { CatalogSource, FoodCandidate } from '../src/lib/food-catalog/types.ts'
import {
  createSupabaseImportDatabase,
  parseBlsWorkbook,
  parseOpenFoodFacts,
  parseUsdaJson,
} from './import-food-catalog.ts'

interface Options {
  bls: string | null
  foundation: string | null
  srLegacy: string | null
  fndds: string | null
  off: string | null
  countries: string[]
  write: boolean
  confirmProduction: boolean
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const parsed: Array<{ source: CatalogSource; version: string; candidates: FoodCandidate[]; input: string }> = []

  if (options.bls) {
    await assertFile(options.bls)
    parsed.push({ source: 'bls', version: 'BLS 4.0', candidates: await parseBlsWorkbook(options.bls), input: options.bls })
  }
  for (const item of [
    { source: 'usda' as const, version: 'USDA Foundation Foods 2026-04-30', input: options.foundation },
    { source: 'usda' as const, version: 'USDA SR Legacy 2018-04', input: options.srLegacy },
    { source: 'usda' as const, version: 'USDA FNDDS 2021-2023 / 2024-10-31', input: options.fndds },
  ]) {
    if (!item.input) continue
    await assertFile(item.input)
    parsed.push({ source: item.source, version: item.version, candidates: await parseUsdaJson(item.input), input: item.input })
  }
  if (options.off) {
    await assertFile(options.off)
    parsed.push({
      source: 'open_food_facts',
      version: 'Open Food Facts official products export',
      candidates: await parseOpenFoodFacts(options.off, options.countries),
      input: options.off,
    })
  }
  if (parsed.length === 0) throw new Error('Mindestens eine echte Quelldatei ist erforderlich.')

  const allCandidates = parsed.flatMap((item) => item.candidates)
  const mappings = buildSafeCrossSourceMappings(allCandidates)
  const groups = groupDuplicateFoods(allCandidates, mappings)
  const coverageGroups = buildCoverageGroups(allCandidates)
  const records = groups.map((group) => {
    const bls = group.candidates.find((candidate) => candidate.source === 'bls')
    return buildCanonicalRecord(bls ? foodDedupeKey(bls) : group.key, group.candidates, mappings, coverageGroups)
  })

  const summary = summarize(parsed, records, mappings.length)
  if (!options.write) {
    console.log(JSON.stringify({ mode: 'dry-run', ...summary }, null, 2))
    return
  }
  if (!options.confirmProduction) {
    throw new Error('Production-Schreiben erfordert zusätzlich --confirm-production.')
  }

  const database = createSupabaseImportDatabase()
  const results: CatalogImportResult[] = []
  for (const source of ['bls', 'usda', 'open_food_facts'] as const) {
    const sourceRecords = records.filter((record) => record.sourceRecords.some((item) => item.source === source))
    if (sourceRecords.length === 0) continue
    const sourceCandidates = parsed
      .filter((item) => item.source === source)
      .reduce((total, item) => total + item.candidates.length, 0)
    const result = await loadCatalogRecords(database, {
      source,
      sourceVersion: source === 'bls' ? 'BLS 4.0' : source === 'usda' ? 'USDA bulk datasets' : 'Open Food Facts official products export',
      candidates: sourceCandidates,
      duplicateCandidates: Math.max(0, sourceCandidates - sourceRecords.length),
      records: sourceRecords,
      metadata: {
        ...sourceMetadataFor(source),
        inputFiles: parsed.filter((item) => item.source === source).map((item) => basename(item.input)),
        countries: options.countries,
        safeCrossSourceMappings: mappings.length,
      },
    })
    results.push(result)
    if (result.status !== 'loaded') throw new Error(`${source}-Import meldet Datensatzfehler; Production-Import wird beendet.`)
  }
  console.log(JSON.stringify({ mode: 'production-write', ...summary, results }, null, 2))
}

function parseArgs(values: string[]): Options {
  const options: Options = {
    bls: null,
    foundation: null,
    srLegacy: null,
    fndds: null,
    off: null,
    countries: ['DE'],
    write: false,
    confirmProduction: false,
  }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    const next = values[index + 1]
    if (value === '--bls' && next) options.bls = next
    else if (value === '--usda-foundation' && next) options.foundation = next
    else if (value === '--usda-sr-legacy' && next) options.srLegacy = next
    else if (value === '--usda-fndds' && next) options.fndds = next
    else if (value === '--off' && next) options.off = next
    else if (value === '--countries' && next) options.countries = next.split(',').map((item) => item.trim().toUpperCase()).filter(Boolean)
    else if (value === '--write') options.write = true
    else if (value === '--confirm-production') options.confirmProduction = true
    if (value.startsWith('--') && next && !next.startsWith('--')) index += 1
  }
  return options
}

async function assertFile(path: string) {
  try {
    await access(path)
  } catch {
    throw new Error(`Quelldatei nicht gefunden: ${path}`)
  }
}

function buildCoverageGroups(candidates: FoodCandidate[]) {
  const groups = new Map<string, string>(nutrientDefinitions.map((definition) => [definition.key, definition.group]))
  for (const candidate of candidates) {
    for (const nutrient of candidate.nutrients) {
      if (nutrient.definition) groups.set(nutrient.definition.canonicalKey, nutrient.definition.nutrientGroup)
    }
  }
  return Object.fromEntries(groups)
}

function summarize(
  parsed: Array<{ source: CatalogSource; version: string; candidates: FoodCandidate[]; input: string }>,
  records: CanonicalImportRecord[],
  mappingCount: number,
) {
  const bySource = Object.fromEntries(
    (['bls', 'usda', 'open_food_facts'] as const).map((source) => {
      const candidates = parsed.filter((item) => item.source === source).flatMap((item) => item.candidates)
      const sourceRecords = records.filter((record) => record.sourceRecords.some((item) => item.source === source))
      return [source, {
        files: parsed.filter((item) => item.source === source).map((item) => ({ file: basename(item.input), version: item.version })),
        candidates: candidates.length,
        canonicalFoods: sourceRecords.length,
        nutrientValues: candidates.reduce((total, candidate) => total + candidate.nutrients.length, 0),
        foodsWithMicronutrients: candidates.filter((candidate) => candidate.nutrients.some((nutrient) => nutrient.definition?.nutrientGroup === 'vitamin' || nutrient.definition?.nutrientGroup === 'mineral')).length,
        portions: candidates.reduce((total, candidate) => total + (candidate.portions?.length ?? 0), 0),
      }]
    }),
  )
  return {
    sources: bySource,
    totalCandidates: parsed.reduce((total, item) => total + item.candidates.length, 0),
    canonicalFoods: records.length,
    duplicateCandidates: parsed.reduce((total, item) => total + item.candidates.length, 0) - records.length,
    safeCrossSourceMappings: mappingCount,
    nutrientValues: records.reduce((total, record) => total + record.nutrients.length, 0),
    foodsWithMicronutrients: records.filter((record) => record.nutrientDefinitions.some((definition) => definition.nutrientGroup === 'vitamin' || definition.nutrientGroup === 'mineral')).length,
    portions: records.reduce((total, record) => total + record.portions.length, 0),
    qualityErrors: records.flatMap((record) => record.qualityFlags).filter((flag) => flag.severity === 'error').length,
    qualityWarnings: records.flatMap((record) => record.qualityFlags).filter((flag) => flag.severity === 'warning').length,
  }
}

function sourceMetadataFor(source: CatalogSource) {
  if (source === 'bls') return { publisher: 'Max Rubner-Institut', dataset: 'Bundeslebensmittelschlüssel BLS 4.0', license: 'CC BY 4.0', sourceUrl: 'https://blsdb.de/' }
  if (source === 'usda') return { publisher: 'USDA Agricultural Research Service', dataset: 'FoodData Central bulk download', license: 'CC0 / Public Domain', sourceUrl: 'https://fdc.nal.usda.gov/' }
  return { publisher: 'Open Food Facts', dataset: 'Official products CSV export', license: 'ODbL 1.0 / DbCL', sourceUrl: 'https://world.openfoodfacts.org/' }
}

if (process.argv[1] && process.argv[1].endsWith('import-food-catalog-all.ts')) await main()
