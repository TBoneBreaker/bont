import { createReadStream } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import { unzipSync, strFromU8 } from 'fflate'
import { createClient } from '@supabase/supabase-js'
import { groupDuplicateFoods } from '../src/lib/food-catalog/dedupe.ts'
import { buildCanonicalRecord } from '../src/lib/food-catalog/import-record.ts'
import {
  loadCatalogRecords,
  summarizeCatalogRecords,
  type CatalogImportDatabase,
  type CatalogRecordLoadResult,
} from '../src/lib/food-catalog/loader.ts'
import {
  convertNutrientUnit,
  normalizeBarcode,
  normalizeSearchText,
  parseNullableNumber,
} from '../src/lib/food-catalog/normalize.ts'
import { findNutrientDefinition, nutrientDefinitions } from '../src/lib/food-catalog/source-mappings.ts'
import type {
  CatalogSource,
  FoodCandidate,
  FoodIdentityMapping,
  FoodPortionCandidate,
  NutrientObservation,
} from '../src/lib/food-catalog/types.ts'

type JsonRecord = Record<string, unknown>

interface ImportOptions {
  source: CatalogSource
  input: string | null
  output: string | null
  countries: string[]
  mapping: string | null
  sourceVersion: string | null
  usdaDataTypes: string
  write: boolean
  confirmProduction: boolean
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let temporaryInputDirectory: string | null = null
  try {
    const resolvedInput = await resolveInput(args)
    if (!resolvedInput.input) {
      console.log(JSON.stringify({ source: args.source, skipped: true, reason: resolvedInput.reason }, null, 2))
      return
    }
    temporaryInputDirectory = resolvedInput.temporaryInputDirectory
    const candidates = await parseSource({ ...args, input: resolvedInput.input })
    const mappings = args.mapping ? (JSON.parse(await readFile(args.mapping, 'utf8')) as FoodIdentityMapping[]) : []
    const groups = groupDuplicateFoods(candidates, mappings)
    const records = groups.map((group) => buildCanonicalRecord(group.key, group.candidates, mappings))
    const sourceVersion = args.sourceVersion ?? resolvedInput.sourceVersion ?? basename(resolvedInput.input)
    const summary = summarizeCatalogRecords({
      source: args.source,
      sourceVersion,
      candidates: candidates.length,
      duplicateCandidates: candidates.length - records.length,
      records,
    })

    if (args.output) {
      await writeFile(
        args.output,
        records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''),
        'utf8',
      )
    }

    if (!args.write) {
      console.log(JSON.stringify({ ...summary, mode: 'dry-run', output: args.output }, null, 2))
      return
    }
    if (!args.confirmProduction) {
      throw new Error('Production-Schreiben erfordert zusätzlich --confirm-production.')
    }

    const result = await loadCatalogRecords(createSupabaseImportDatabase(), {
      source: args.source,
      sourceVersion,
      candidates: candidates.length,
      duplicateCandidates: candidates.length - records.length,
      records,
      metadata: {
        countries: args.countries,
        explicitMappings: mappings.length,
        usdaDataTypes: args.source === 'usda' ? args.usdaDataTypes : null,
      },
    })
    console.log(JSON.stringify({ ...summary, mode: 'production-write', output: args.output, ...result }, null, 2))
  } finally {
    if (temporaryInputDirectory) await rm(temporaryInputDirectory, { recursive: true, force: true })
  }
}

await main()

function parseArgs(values: string[]): ImportOptions {
  const options: Partial<ImportOptions> = {
    input: null,
    output: null,
    countries: ['DE'],
    mapping: null,
    sourceVersion: null,
    usdaDataTypes: 'Foundation,SR Legacy',
    write: false,
    confirmProduction: false,
  }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    const next = values[index + 1]
    if (value === '--source' && isCatalogSource(next)) {
      options.source = next
      index += 1
    } else if (value === '--input' && next) {
      options.input = next
      index += 1
    } else if (value === '--output' && next) {
      options.output = next
      index += 1
    } else if (value === '--countries' && next) {
      options.countries = next
        .split(',')
        .map((country) => country.trim().toUpperCase())
        .filter(Boolean)
      index += 1
    } else if (value === '--mapping' && next) {
      options.mapping = next
      index += 1
    } else if (value === '--source-version' && next) {
      options.sourceVersion = next
      index += 1
    } else if (value === '--usda-data-types' && next) {
      options.usdaDataTypes = next
      index += 1
    } else if (value === '--write') {
      options.write = true
    } else if (value === '--confirm-production') {
      options.confirmProduction = true
    }
  }
  if (!options.source) {
    throw new Error(
      'Aufruf: npm run catalog:dry-run -- --source bls|usda|open_food_facts --input <Datei> [--mapping <JSON>] [--output <JSONL>] oder npm run catalog:import -- --source <Quelle> --input <Datei> --confirm-production',
    )
  }
  return options as ImportOptions
}

async function resolveInput(options: ImportOptions) {
  if (options.input) return { input: options.input, temporaryInputDirectory: null, sourceVersion: null, reason: null }
  if (options.source !== 'usda') {
    throw new Error(`Für ${options.source} ist eine lokale Exportdatei mit --input erforderlich.`)
  }
  const apiKey = process.env.USDA_FDC_API_KEY
  if (!apiKey) {
    return {
      input: null,
      temporaryInputDirectory: null,
      sourceVersion: null,
      reason: 'USDA_FDC_API_KEY fehlt; USDA wird übersprungen.',
    }
  }
  const temporaryInputDirectory = await mkdtemp(join(tmpdir(), 'bont-usda-'))
  const input = join(temporaryInputDirectory, 'usda-foods.json')
  const foods: JsonRecord[] = []
  const pageSize = 200
  for (let pageNumber = 1; ; pageNumber += 1) {
    const url = new URL('https://api.nal.usda.gov/fdc/v1/foods/list')
    url.searchParams.set('api_key', apiKey)
    url.searchParams.set('pageSize', String(pageSize))
    url.searchParams.set('pageNumber', String(pageNumber))
    url.searchParams.set('dataType', options.usdaDataTypes)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`USDA API antwortete mit HTTP ${response.status}.`)
    const page = (await response.json()) as unknown
    if (!Array.isArray(page)) throw new Error('USDA API lieferte kein Array.')
    foods.push(...page.filter(isRecord))
    if (page.length < pageSize) break
  }
  await writeFile(input, JSON.stringify(foods), 'utf8')
  return { input, temporaryInputDirectory, sourceVersion: 'USDA-API-Foundation-SR-Legacy', reason: null }
}

function isCatalogSource(value: unknown): value is CatalogSource {
  return value === 'bls' || value === 'usda' || value === 'open_food_facts'
}

async function parseSource(options: ImportOptions): Promise<FoodCandidate[]> {
  if (!options.input) throw new Error('Eine Quelldatei ist erforderlich.')
  if (options.source === 'bls') return parseBlsWorkbook(options.input)
  if (options.source === 'usda') return parseUsdaJson(options.input)
  return parseOpenFoodFacts(options.input, options.countries)
}

async function parseBlsWorkbook(input: string): Promise<FoodCandidate[]> {
  const files = unzipSync(new Uint8Array(await readFile(input)))
  const sheetName = Object.keys(files).find((name) => /^xl\/worksheets\/sheet1\.xml$/i.test(name))
  if (!sheetName) throw new Error('BLS-XLSX enthält kein erstes Arbeitsblatt.')
  const sharedStrings = parseSharedStrings(files['xl/sharedStrings.xml'])
  const rows = parseWorksheetRows(files[sheetName], sharedStrings)
  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => /lebensmittel|food description|bezeichnung/i.test(cell)),
  )
  if (headerIndex < 0) throw new Error('BLS-XLSX: Kopfzeile mit Lebensmittelbezeichnung nicht gefunden.')
  const header = rows[headerIndex]
  const columns = detectBlsColumns(header)
  const candidates: FoodCandidate[] = []
  for (const row of rows.slice(headerIndex + 1)) {
    const sourceRecordId = row[columns.codeIndex]?.trim()
    const nameDe = row[columns.nameDeIndex]?.trim()
    if (!sourceRecordId || !nameDe) continue
    const nutrients = columns.nutrients.flatMap((column) => {
      const value = parseNullableNumber(row[column.valueIndex])
      if (value === null) return []
      const origin = column.originIndex === null ? '' : (row[column.originIndex] ?? '')
      const reference = column.referenceIndex === null ? '' : (row[column.referenceIndex] ?? '')
      return [
        observation({
          nutrientKey: column.definition.key,
          value,
          unit: column.definition.unit,
          source: 'bls',
          sourceRecordId,
          role: 'primary',
          valueStatus: /logical|kein wert|zero|trace|spuren/i.test(origin) && value === 0 ? 'logical_zero' : 'measured',
          provenance: [origin, reference].filter(Boolean).join(' · ') || null,
        }),
      ]
    })
    candidates.push({
      id: `bls-${sourceRecordId}`,
      nameDe,
      nameEn: null,
      normalizedName: normalizeSearchText(nameDe),
      kind: 'generic',
      preparationState: inferPreparationState(nameDe),
      countryCode: 'DE',
      source: 'bls',
      sourceRecordId,
      nutrients,
      rawPayload: { cells: row },
    })
  }
  return candidates
}

function detectBlsColumns(header: string[]) {
  const codeIndex = findColumn(header, /lebensmittel.?code|food.?code|schlüssel|kennziffer/i, 0)
  const nameDeIndex = findColumn(
    header,
    /lebensmittel.?bezeichnung|bezeichnung|deutsche.?bezeichnung|food.?description/i,
    1,
  )
  const nutrients = nutrientDefinitions.flatMap((definition) => {
    const valueIndex = header.findIndex((value) => {
      const match = findNutrientDefinition(value)
      return match?.key === definition.key && !/herkunft|origin|referenz|reference/i.test(value)
    })
    if (valueIndex < 0) return []
    return [
      {
        definition,
        valueIndex,
        originIndex: findRelatedColumn(header, valueIndex, definition.key, /herkunft|origin/i),
        referenceIndex: findRelatedColumn(header, valueIndex, definition.key, /referenz|reference/i),
      },
    ]
  })
  return { codeIndex, nameDeIndex, nutrients }
}

function findColumn(header: string[], pattern: RegExp, fallback: number) {
  const index = header.findIndex((value) => pattern.test(value))
  return index >= 0 ? index : fallback
}

function findRelatedColumn(header: string[], valueIndex: number, key: string, suffix: RegExp) {
  const index = header.findIndex(
    (value, candidateIndex) =>
      candidateIndex !== valueIndex && suffix.test(value) && findNutrientDefinition(value)?.key === key,
  )
  return index >= 0 ? index : null
}

async function parseUsdaJson(input: string): Promise<FoodCandidate[]> {
  const payload = JSON.parse(await readFile(input, 'utf8')) as JsonRecord | JsonRecord[]
  const foods = Array.isArray(payload)
    ? payload
    : ['FoundationFoods', 'SRLegacyFoods', 'SurveyFoods', 'BrandedFoods', 'foods'].flatMap((key) =>
        Array.isArray(payload[key]) ? (payload[key] as JsonRecord[]) : [],
      )
  return foods.flatMap((food) => {
    const sourceRecordId = String(food.fdcId ?? food.fdc_id ?? '')
    const name = cleanString(food.description) ?? cleanString(food.lowercaseDescription) ?? ''
    if (!sourceRecordId || !name) return []
    const branded = Boolean(cleanString(food.brandOwner) || cleanString(food.brandName))
    const nutrients = Array.isArray(food.foodNutrients)
      ? food.foodNutrients.flatMap((nutrient) => {
          const nutrientObject = isRecord(nutrient.nutrient) ? nutrient.nutrient : nutrient
          const definition = findNutrientDefinition(String(nutrientObject.name ?? ''))
          const value = parseNullableNumber(nutrient.amount ?? nutrient.value)
          const sourceUnit = cleanString(nutrientObject.unitName) ?? ''
          if (!definition || value === null || !sourceUnit) return []
          try {
            return [
              observation({
                nutrientKey: definition.key,
                value: convertNutrientUnit(value, sourceUnit, definition.unit),
                unit: definition.unit,
                source: 'usda',
                sourceRecordId,
                role: branded ? 'declared' : 'reference',
                valueStatus: branded ? 'declared' : 'measured',
                provenance: cleanString(nutrientObject.name),
              }),
            ]
          } catch {
            return []
          }
        })
      : []
    return [
      {
        id: `usda-${sourceRecordId}`,
        nameDe: name,
        nameEn: null,
        normalizedName: normalizeSearchText(name),
        brand: cleanString(food.brandName) ?? cleanString(food.brandOwner),
        manufacturer: cleanString(food.brandOwner),
        kind: branded ? 'branded' : 'generic',
        preparationState: inferPreparationState(name),
        countryCode: branded ? null : 'DE',
        source: 'usda',
        sourceRecordId,
        nutrients,
        portions: usdaPortions(food),
        sourceUpdatedAt: cleanString(food.publicationDate),
        rawPayload: food,
      } satisfies FoodCandidate,
    ]
  })
}

function usdaPortions(food: JsonRecord): FoodPortionCandidate[] {
  const amount = parseNullableNumber(food.servingSize)
  const unit = cleanString(food.servingSizeUnit)?.toLowerCase() as 'g' | 'ml' | undefined
  if (amount === null || amount <= 0 || (unit !== 'g' && unit !== 'ml')) return []
  return [
    {
      labelDe: `Portion (${amount} ${unit})`,
      amount,
      unit,
      grams: unit === 'g' ? amount : null,
      confidence: 0.95,
    },
  ]
}

async function parseOpenFoodFacts(input: string, countries: string[]): Promise<FoodCandidate[]> {
  const candidates: FoodCandidate[] = []
  const stream = createReadStream(input, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  let firstNonEmpty = ''
  for await (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (!firstNonEmpty) firstNonEmpty = trimmed[0]
    if (trimmed[0] === '[' || (trimmed[0] === '{' && trimmed.endsWith(']'))) {
      // Large OFF exports should be JSONL. This branch keeps small API dumps usable.
      const parsed = JSON.parse(trimmed) as JsonRecord[] | JsonRecord
      const products = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.products)
          ? (parsed.products as JsonRecord[])
          : [parsed]
      candidates.push(...products.flatMap((product) => parseOffProduct(product, countries)))
      continue
    }
    try {
      const product = JSON.parse(trimmed) as JsonRecord
      candidates.push(...parseOffProduct(product, countries))
    } catch {
      // Ignore a malformed line and let the run summary expose the reduced count.
    }
  }
  if (!firstNonEmpty) return []
  return candidates
}

function parseOffProduct(product: JsonRecord, countries: string[]): FoodCandidate[] {
  if (!offProductMatchesCountry(product, countries)) return []
  const sourceRecordId = cleanString(product.code) ?? ''
  const name = cleanString(product.product_name_de) ?? cleanString(product.product_name) ?? ''
  if (!sourceRecordId || !name) return []
  const nutriments = isRecord(product.nutriments) ? product.nutriments : {}
  const basisUnit = typeof nutriments['energy-kcal_100ml'] === 'number' ? 'ml' : 'g'
  const nutrients = nutrientDefinitions.flatMap((definition) => {
    const key = offNutrientKey(definition.key)
    const value = parseNullableNumber(nutriments[`${key}_100${basisUnit}`])
    if (value === null) return []
    const sourceUnit = cleanString(nutriments[`${key}_unit`]) ?? definition.unit
    try {
      return [
        observation({
          nutrientKey: definition.key,
          value: convertNutrientUnit(value, sourceUnit, definition.unit),
          unit: definition.unit,
          basisUnit,
          source: 'open_food_facts',
          sourceRecordId,
          role: 'declared',
          valueStatus: 'declared',
          provenance: 'label / Open Food Facts',
        }),
      ]
    } catch {
      return []
    }
  })
  const brand = cleanString(product.brands)
  return [
    {
      id: `off-${sourceRecordId}`,
      nameDe: name,
      nameEn: cleanString(product.product_name),
      normalizedName: normalizeSearchText(name),
      brand,
      manufacturer: brand,
      gtin: normalizeBarcode(sourceRecordId),
      kind: 'branded',
      preparationState: inferPreparationState(name),
      countryCode: 'DE',
      source: 'open_food_facts',
      sourceRecordId,
      nutrients,
      portions: offPortion(product, basisUnit),
      rawPayload: product,
    },
  ]
}

function offProductMatchesCountry(product: JsonRecord, countries: string[]) {
  const tags = Array.isArray(product.countries_tags) ? product.countries_tags.map(String) : []
  const text = `${cleanString(product.countries) ?? ''} ${tags.join(' ')}`.toLocaleLowerCase('en-US')
  const aliases: Record<string, string[]> = {
    DE: ['germany', 'deutschland', 'en:de'],
    AT: ['austria', 'österreich', 'en:at'],
    CH: ['switzerland', 'schweiz', 'en:ch'],
    FR: ['france', 'frankreich', 'en:fr'],
  }
  return countries.some((country) =>
    (aliases[country] ?? [`en:${country.toLowerCase()}`]).some((alias) => text.includes(alias)),
  )
}

function offNutrientKey(key: string) {
  const aliases: Record<string, string> = {
    energy_kcal: 'energy-kcal',
    protein: 'proteins',
    carbohydrate: 'carbohydrates',
    fat: 'fat',
    fiber: 'fiber',
    vitamin_a: 'vitamin-a',
    vitamin_d: 'vitamin-d',
    vitamin_e: 'vitamin-e',
    vitamin_k: 'vitamin-k',
    vitamin_c: 'vitamin-c',
    thiamin: 'vitamin-b1',
    riboflavin: 'vitamin-b2',
    niacin: 'niacin',
    vitamin_b6: 'vitamin-b6',
    pantothenic_acid: 'pantothenic-acid',
    biotin: 'biotin',
    folate: 'folates',
    vitamin_b12: 'vitamin-b12',
  }
  return aliases[key] ?? key
}

function offPortion(product: JsonRecord, basisUnit: 'g' | 'ml'): FoodPortionCandidate[] {
  const amount = parseNullableNumber(product.serving_quantity)
  if (amount === null || amount <= 0) return []
  return [
    {
      labelDe: `Portion (${amount} ${basisUnit})`,
      amount,
      unit: basisUnit,
      grams: basisUnit === 'g' ? amount : null,
      confidence: 0.95,
    },
  ]
}

function createSupabaseImportDatabase(): CatalogImportDatabase {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Für Production-Importe werden SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY benötigt.')
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })

  return {
    async startRun(input) {
      const { data, error } = await supabase
        .from('food_import_runs')
        .insert({
          source_code: input.source,
          source_version: input.sourceVersion,
          status: 'running',
          counts: { plannedRecords: input.plannedRecords },
          metadata: input.metadata,
        })
        .select('id')
        .single()
      if (error || !data?.id) throw formatSupabaseError(error, 'Importlauf konnte nicht gestartet werden.')
      return String(data.id)
    },

    async loadRecord(runId, record) {
      const { data, error } = await supabase.rpc('import_food_catalog_record', {
        p_run_id: runId,
        p_dedupe_key: record.dedupeKey,
        p_record: record,
      })
      if (error) throw formatSupabaseError(error, `Datensatz ${record.dedupeKey} konnte nicht geladen werden.`)
      return parseLoadResult(data)
    },

    async finishRun(input) {
      const { error } = await supabase
        .from('food_import_runs')
        .update({
          status: input.status,
          completed_at: new Date().toISOString(),
          counts: input.counts,
          errors: input.errors,
        })
        .eq('id', input.runId)
      if (error) throw formatSupabaseError(error, 'Importlauf konnte nicht abgeschlossen werden.')
    },
  }
}

function parseLoadResult(value: unknown): CatalogRecordLoadResult {
  if (!isRecord(value) || typeof value.foodId !== 'string' || typeof value.foodCreated !== 'boolean') {
    throw new Error('Loader lieferte kein gültiges Ergebnis.')
  }
  return {
    foodId: value.foodId,
    foodCreated: value.foodCreated,
    sourceRecordsUpserted: readNonNegativeInteger(value.sourceRecordsUpserted),
    identityMappingsUpserted: readNonNegativeInteger(value.identityMappingsUpserted),
    nutrientObservationsUpserted: readNonNegativeInteger(value.nutrientObservationsUpserted),
    canonicalNutrientsUpserted: readNonNegativeInteger(value.canonicalNutrientsUpserted),
    portionsUpserted: readNonNegativeInteger(value.portionsUpserted),
    qualityFlagsUpserted: readNonNegativeInteger(value.qualityFlagsUpserted),
  }
}

function readNonNegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

function formatSupabaseError(error: { code?: string; message?: string } | null, fallback: string) {
  if (!error) return new Error(fallback)
  return new Error(`${fallback} ${error.code ? `[${error.code}] ` : ''}${error.message ?? ''}`.trim())
}

function observation(
  overrides: Partial<NutrientObservation> &
    Pick<
      NutrientObservation,
      'nutrientKey' | 'value' | 'unit' | 'source' | 'sourceRecordId' | 'role' | 'valueStatus' | 'provenance'
    >,
): NutrientObservation {
  return {
    basisAmount: 100,
    basisUnit: 'g',
    confidence: 0.95,
    ...overrides,
  }
}

function inferPreparationState(name: string) {
  if (/\b(roh|raw|ungekocht|uncooked|frisch|fresh)\b/i.test(name)) return 'raw' as const
  if (/\b(getrocknet|trocken|dry|dehydrated)\b/i.test(name)) return 'dried' as const
  if (/\b(gekocht|cooked|boiled|gedämpft|steamed)\b/i.test(name)) return 'cooked' as const
  if (/\b(gebraten|fried)\b/i.test(name)) return 'fried' as const
  if (/\b(gebacken|baked)\b/i.test(name)) return 'baked' as const
  return 'unknown' as const
}

function parseSharedStrings(value: Uint8Array | undefined) {
  if (!value) return []
  return [...strFromU8(value).matchAll(/<si\b[\s\S]*?<\/si>/g)].map((match) => xmlText(match[0]))
}

function parseWorksheetRows(value: Uint8Array | undefined, sharedStrings: string[]) {
  if (!value) return []
  return [...strFromU8(value).matchAll(/<row\b[\s\S]*?<\/row>/g)].map((rowMatch) => {
    const cells: string[] = []
    for (const cellMatch of rowMatch[0].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1]
      const cell = cellMatch[2]
      const ref = attributes.match(/\br="([A-Z]+)\d+"/)?.[1] ?? ''
      const index = columnIndex(ref)
      const type = attributes.match(/\bt="([^"]+)"/)?.[1] ?? ''
      const raw =
        cell.match(/<v>([\s\S]*?)<\/v>/)?.[1] ??
        (type === 'inlineStr' ? (cell.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? '') : '')
      const value = type === 's' ? (sharedStrings[Number(raw)] ?? '') : decodeXml(raw)
      cells[index] = value
    }
    return cells.map((cell) => cell ?? '')
  })
}

function columnIndex(value: string) {
  let result = 0
  for (const character of value) result = result * 26 + character.charCodeAt(0) - 64
  return Math.max(0, result - 1)
}

function xmlText(value: string) {
  return decodeXml(value.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function cleanString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
