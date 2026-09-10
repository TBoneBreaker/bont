import { access } from 'node:fs/promises'
import { basename } from 'node:path'
import { buildCanonicalRecord, type CanonicalImportRecord } from '../src/lib/food-catalog/import-record.ts'
import { groupDuplicateFoods, foodDedupeKey } from '../src/lib/food-catalog/dedupe.ts'
import { buildSafeCrossSourceMappings } from '../src/lib/food-catalog/source-mapping.ts'
import { nutrientDefinitions } from '../src/lib/food-catalog/source-mappings.ts'
import type { CatalogSource, FoodCandidate } from '../src/lib/food-catalog/types.ts'
import { parseBlsWorkbook, parseOpenFoodFacts, parseUsdaJson } from './import-food-catalog.ts'

interface Options {
  bls: string | null
  foundation: string | null
  srLegacy: string | null
  fndds: string | null
  off: string | null
  endpoint: string
  countries: string[]
  onlyNewSources: boolean
  usdaOffset: number
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const trigger = process.env.BONT_IMPORT_TRIGGER
  if (!trigger) throw new Error('BONT_IMPORT_TRIGGER ist im lokalen Prozess nicht gesetzt.')
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
    parsed.push({ source: 'open_food_facts', version: 'Open Food Facts official products export', candidates: await parseOpenFoodFacts(options.off, options.countries), input: options.off })
  }
  if (parsed.length === 0) throw new Error('Keine Quelldatei angegeben.')
  let remainingUsdaOffset = options.usdaOffset
  const allCandidates = parsed.flatMap((item) => {
    if (item.source !== 'usda' || remainingUsdaOffset <= 0) return item.candidates
    if (remainingUsdaOffset >= item.candidates.length) {
      remainingUsdaOffset -= item.candidates.length
      return []
    }
    const selected = item.candidates.slice(remainingUsdaOffset)
    remainingUsdaOffset = 0
    return selected
  })
  const mappings = buildSafeCrossSourceMappings(allCandidates)
  const groups = groupDuplicateFoods(allCandidates, mappings)
  const coverageGroups = buildCoverageGroups(allCandidates)
  const selectedGroups = options.onlyNewSources
    ? groups.filter((group) => group.candidates.some((candidate) => candidate.source !== 'bls'))
    : groups
  const records = selectedGroups.map((group) => {
    const bls = group.candidates.find((candidate) => candidate.source === 'bls')
    return buildCanonicalRecord(bls ? foodDedupeKey(bls) : group.key, group.candidates, mappings, coverageGroups)
  })
  const summary = { candidates: allCandidates.length, records: records.length, mappings: mappings.length, qualityErrors: records.flatMap((record) => record.qualityFlags).filter((flag) => flag.severity === 'error').length }
  if (summary.qualityErrors > 0) throw new Error(`Dry-Run enthält ${summary.qualityErrors} kritische Qualitätsfehler.`)

  const results: Array<{ source: CatalogSource; runId: string; status: string; counts: Record<string, number>; errors: unknown[] }> = []
  for (const source of ['bls', 'usda', 'open_food_facts'] as const) {
    const sourceRecords = records.filter((record) => {
      const hasBls = record.sourceRecords.some((item) => item.source === 'bls')
      const hasSource = record.sourceRecords.some((item) => item.source === source)
      return hasSource && (source === 'bls' || !hasBls)
    })
    if (sourceRecords.length === 0) continue
    const sourceCandidates = allCandidates.filter((candidate) => candidate.source === source).length
    const started = await call(options.endpoint, trigger, {
      action: 'start',
      source,
      sourceVersion: source === 'bls' ? 'BLS 4.0' : source === 'usda' ? 'USDA bulk datasets' : 'Open Food Facts official products export',
      plannedRecords: sourceRecords.length,
      nutrientDefinitions: uniqueDefinitions(sourceRecords),
      metadata: {
        inputFiles: parsed.filter((item) => item.source === source).map((item) => basename(item.input)),
        sourceOffset: source === 'usda' ? options.usdaOffset : 0,
        countries: options.countries,
        safeCrossSourceMappings: mappings.length,
      },
    })
    const runId = stringValue(started.runId)
    if (!runId) throw new Error(`${source}-Import lieferte keine runId.`)
    const counts: Record<string, number> = {
      candidateRecords: sourceCandidates,
      deduplicatedFoods: sourceRecords.length,
      duplicateCandidates: Math.max(0, sourceCandidates - sourceRecords.length),
      loadedRecords: 0,
      failedRecords: 0,
      foodsCreated: 0,
      foodsReused: 0,
      sourceRecordsUpserted: 0,
      identityMappingsUpserted: 0,
      nutrientObservationsUpserted: 0,
      canonicalNutrientsUpserted: 0,
      portionsUpserted: 0,
      qualityFlagsUpserted: 0,
    }
    const errors: unknown[] = []
    for (let index = 0; index < sourceRecords.length; index += 25) {
      const batch = sourceRecords.slice(index, index + 25)
      const response = await call(options.endpoint, trigger, { action: 'batch', runId, records: batch })
      const batchResults = Array.isArray(response.results) ? response.results : []
      if (batchResults.length !== batch.length) throw new Error(`${source}-Batch lieferte eine unerwartete Ergebnisanzahl.`)
      for (const [batchIndex, item] of batchResults.entries()) {
        const record = batch[batchIndex]
        if (!record) continue
        if (!isRecord(item) || item.ok !== true || !isRecord(item.result)) {
          errors.push({ dedupeKey: record.dedupeKey, sourceRecords: record.sourceRecords.map((sourceRecord) => `${sourceRecord.source}:${sourceRecord.sourceRecordId}`), message: isRecord(item) && typeof item.error === 'string' ? item.error : 'Datensatz konnte nicht geladen werden.' })
          continue
        }
        counts.loadedRecords += 1
        const result = item.result
        counts.foodsCreated += result.foodCreated === true ? 1 : 0
        counts.foodsReused += result.foodCreated === true ? 0 : 1
        for (const key of ['sourceRecordsUpserted', 'identityMappingsUpserted', 'nutrientObservationsUpserted', 'canonicalNutrientsUpserted', 'portionsUpserted', 'qualityFlagsUpserted']) counts[key] = (counts[key] ?? 0) + numberValue(result[key])
      }
    }
    counts.failedRecords = errors.length
    const status = errors.length === 0 ? 'loaded' : 'failed'
    await call(options.endpoint, trigger, { action: 'finish', runId, status, counts, errors })
    results.push({ source, runId, status, counts, errors })
    if (status !== 'loaded') throw new Error(`${source}-Import meldet Datensatzfehler; weiterer Import wird beendet.`)
  }
  console.log(JSON.stringify({ mode: 'vercel-runtime', summary, results }, null, 2))
}

async function call(endpoint: string, trigger: string, body: Record<string, unknown>) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bont-import-trigger': trigger },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({})) as unknown
  if (!response.ok) throw new Error(`Vercel-Import-Trigger HTTP ${response.status}: ${isRecord(data) && typeof data.error === 'string' ? data.error : 'unbekannter Fehler'}`)
  return isRecord(data) ? data : {}
}

function uniqueDefinitions(records: CanonicalImportRecord[]) {
  const definitions = new Map<string, unknown>()
  for (const record of records) for (const definition of record.nutrientDefinitions) definitions.set(definition.canonicalKey, definition)
  return [...definitions.values()]
}

function buildCoverageGroups(candidates: FoodCandidate[]) {
  const groups = new Map<string, string>(nutrientDefinitions.map((definition) => [definition.key, definition.group]))
  for (const candidate of candidates) for (const nutrient of candidate.nutrients) if (nutrient.definition) groups.set(nutrient.definition.canonicalKey, nutrient.definition.nutrientGroup)
  return Object.fromEntries(groups)
}

function parseArgs(values: string[]): Options {
  const options: Options = { bls: null, foundation: null, srLegacy: null, fndds: null, off: null, endpoint: '', countries: ['DE'], onlyNewSources: false, usdaOffset: 0 }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    const next = values[index + 1]
    if (value === '--bls' && next) options.bls = next
    else if (value === '--usda-foundation' && next) options.foundation = next
    else if (value === '--usda-sr-legacy' && next) options.srLegacy = next
    else if (value === '--usda-fndds' && next) options.fndds = next
    else if (value === '--off' && next) options.off = next
    else if (value === '--endpoint' && next) options.endpoint = next
    else if (value === '--countries' && next) options.countries = next.split(',').map((item) => item.trim().toUpperCase()).filter(Boolean)
    else if (value === '--only-new-sources') options.onlyNewSources = true
    else if (value === '--usda-offset' && next) options.usdaOffset = Math.max(0, Number.parseInt(next, 10) || 0)
    if (value.startsWith('--') && next && !next.startsWith('--')) index += 1
  }
  if (!options.endpoint) throw new Error('--endpoint ist erforderlich.')
  return options
}

async function assertFile(path: string) {
  try { await access(path) } catch { throw new Error(`Quelldatei nicht gefunden: ${path}`) }
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function stringValue(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim() : null }
function numberValue(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : 0 }

if (process.argv[1] && process.argv[1].endsWith('import-food-catalog-via-vercel.ts')) await main()
