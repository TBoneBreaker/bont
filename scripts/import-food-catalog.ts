import { createReadStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { unzipSync, strFromU8 } from 'fflate'
import { groupDuplicateFoods } from '../src/lib/food-catalog/dedupe.ts'
import { selectCanonicalNutrients } from '../src/lib/food-catalog/merge.ts'
import { calculateCoverage, checkFoodCandidate } from '../src/lib/food-catalog/quality.ts'
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
  input: string
  output: string | null
  countries: string[]
  mapping: string | null
}

interface CanonicalImportRecord {
  dedupeKey: string
  identity: Omit<FoodCandidate, 'nutrients' | 'source' | 'sourceRecordId'>
  sourceRecords: Array<{ source: CatalogSource; sourceRecordId: string; rawPayload: JsonRecord }>
  nutrients: ReturnType<typeof selectCanonicalNutrients>['nutrients']
  qualityFlags: ReturnType<typeof checkFoodCandidate>
  nutrientCoverage: ReturnType<typeof calculateCoverage>
  rejectedReferenceNutrients: string[]
  conflictingNutrients: string[]
}

const args = parseArgs(process.argv.slice(2))
const candidates = await parseSource(args)
const mappings = args.mapping ? (JSON.parse(await readFile(args.mapping, 'utf8')) as FoodIdentityMapping[]) : []
const groups = groupDuplicateFoods(candidates, mappings)
const records = groups.map((group) => buildCanonicalRecord(group.key, group.candidates))
const summary = {
  source: args.source,
  input: args.input,
  countryFilter: args.countries,
  candidates: candidates.length,
  deduplicatedFoods: records.length,
  duplicateCandidates: candidates.length - records.length,
  explicitMappings: mappings.length,
  qualityErrors: records.flatMap((record) => record.qualityFlags.filter((flag) => flag.severity === 'error')).length,
  qualityWarnings: records.flatMap((record) => record.qualityFlags.filter((flag) => flag.severity === 'warning'))
    .length,
  unmappedReferenceValues: records.reduce((total, record) => total + record.rejectedReferenceNutrients.length, 0),
}

if (args.output) {
  await writeFile(
    args.output,
    records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''),
    'utf8',
  )
}

console.log(JSON.stringify({ ...summary, output: args.output }, null, 2))

function parseArgs(values: string[]): ImportOptions {
  const options: Partial<ImportOptions> = { output: null, countries: ['DE'], mapping: null }
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
    }
  }
  if (!options.source || !options.input) {
    throw new Error(
      'Aufruf: npm run catalog:dry-run -- --source bls|usda|open_food_facts --input <Datei> [--mapping <JSON>] [--output <JSONL>]',
    )
  }
  return options as ImportOptions
}

function isCatalogSource(value: unknown): value is CatalogSource {
  return value === 'bls' || value === 'usda' || value === 'open_food_facts'
}

async function parseSource(options: ImportOptions): Promise<FoodCandidate[]> {
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
        rawPayload: food,
      } satisfies FoodCandidate,
    ]
  })
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

function buildCanonicalRecord(dedupeKey: string, candidates: FoodCandidate[]): CanonicalImportRecord {
  const identity = candidates.slice().sort((left, right) => identityPriority(right) - identityPriority(left))[0]
  const identityData = Object.fromEntries(
    Object.entries(identity).filter(([key]) => !['nutrients', 'source', 'sourceRecordId'].includes(key)),
  ) as CanonicalImportRecord['identity']
  const observations = candidates.flatMap((candidate) => candidate.nutrients)
  const rules = candidates.flatMap((candidate) =>
    candidate.source === 'usda' && candidate.kind === 'generic'
      ? nutrientDefinitions.map((definition) => ({
          nutrientKey: definition.key,
          allowed: true,
          confidence: 0.95,
          stateMatches: candidates.every((other) => other.preparationState === candidate.preparationState),
          definitionMatches: true,
          reason: 'generic food with matching preparation state',
        }))
      : [],
  )
  const selected = selectCanonicalNutrients(identity.kind, observations, rules)
  return {
    dedupeKey,
    identity: identityData,
    sourceRecords: candidates.map((candidate) => ({
      source: candidate.source,
      sourceRecordId: candidate.sourceRecordId,
      rawPayload: candidate.rawPayload ?? { id: candidate.id, name: candidate.nameDe, brand: candidate.brand ?? null },
    })),
    nutrients: selected.nutrients,
    qualityFlags: candidates.flatMap(checkFoodCandidate),
    nutrientCoverage: calculateCoverage(
      selected.nutrients,
      Object.fromEntries(nutrientDefinitions.map((definition) => [definition.key, definition.group])),
    ),
    rejectedReferenceNutrients: selected.rejectedReferenceNutrients,
    conflictingNutrients: selected.conflictingNutrients,
  }
}

function identityPriority(candidate: FoodCandidate) {
  if (candidate.kind === 'branded' && candidate.source === 'open_food_facts') return 50
  if (candidate.source === 'bls') return 40
  if (candidate.source === 'usda') return 30
  return 10
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
