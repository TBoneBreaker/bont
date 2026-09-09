import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import { unzipSync, strFromU8 } from 'fflate'
import { createClient } from '@supabase/supabase-js'
import { groupDuplicateFoods } from '../src/lib/food-catalog/dedupe.ts'
import { buildCanonicalRecord, type CanonicalImportRecord } from '../src/lib/food-catalog/import-record.ts'
import {
  loadCatalogRecords,
  summarizeCatalogRecords,
  type CatalogImportDatabase,
  type CatalogBatchLoadResult,
  type CatalogRecordLoadResult,
} from '../src/lib/food-catalog/loader.ts'
import {
  convertNutrientUnit,
  normalizeBarcode,
  normalizeSearchText,
  parseNullableNumber,
} from '../src/lib/food-catalog/normalize.ts'
import {
  findNutrientDefinition,
  nutrientDefinitionMetadata,
  nutrientDefinitions,
} from '../src/lib/food-catalog/source-mappings.ts'
import type {
  CatalogSource,
  FoodCandidate,
  FoodIdentityMapping,
  FoodPortionCandidate,
  NutrientDefinitionMetadata,
  NutrientObservation,
} from '../src/lib/food-catalog/types.ts'

type JsonRecord = Record<string, unknown>

const sourceMetadata: Record<CatalogSource, Record<string, unknown>> = {
  bls: {
    publisher: 'Max Rubner-Institut',
    dataset: 'Bundeslebensmittelschlüssel BLS 4.0',
    license: 'CC BY 4.0',
    sourceUrl: 'https://blsdb.de/',
  },
  usda: {
    publisher: 'USDA Agricultural Research Service',
    dataset: 'FoodData Central bulk download',
    license: 'CC0 / Public Domain',
    sourceUrl: 'https://fdc.nal.usda.gov/',
  },
  open_food_facts: {
    publisher: 'Open Food Facts',
    dataset: 'Official products CSV export',
    license: 'ODbL 1.0 / DbCL',
    sourceUrl: 'https://world.openfoodfacts.org/',
    filter: 'countries_tags/countries contains Germany; valid GTIN; at least one declared nutrient',
  },
  manual: {
    publisher: 'Bont',
    dataset: 'Manual food data',
    license: 'Bont user data',
  },
}

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
    const coverageGroups = await resolveCoverageGroups(args, resolvedInput.input, candidates)
    const records = groups.map((group) => buildCanonicalRecord(group.key, group.candidates, mappings, coverageGroups))
    const sourceVersion = args.sourceVersion ?? resolvedInput.sourceVersion ?? basename(resolvedInput.input)
    const summary = summarizeCatalogRecords({
      source: args.source,
      sourceVersion,
      candidates: candidates.length,
      duplicateCandidates: candidates.length - records.length,
      records,
    })

    if (args.output) {
      await writeCanonicalRecords(args.output, records)
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
        ...sourceMetadata[args.source],
        inputFile: basename(resolvedInput.input),
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

async function writeCanonicalRecords(output: string, records: ReturnType<typeof buildCanonicalRecord>[]) {
  const stream = createWriteStream(output, { encoding: 'utf8' })
  try {
    for (const record of records) {
      if (!stream.write(`${JSON.stringify(record)}\n`)) await once(stream, 'drain')
    }
    stream.end()
    await once(stream, 'close')
  } finally {
    stream.destroy()
  }
}

async function resolveCoverageGroups(options: ImportOptions, input: string, candidates: FoodCandidate[]) {
  if (options.source === 'bls') {
    const components = await readBlsComponents(join(dirname(input), 'BLS_4_0_Components_DE_EN.xlsx'))
    if (components.size > 0) {
      return Object.fromEntries(
        [...components.values()].map((component) => [
          blsCanonicalKey(component.code),
          blsNutrientGroup(component.group, component.code),
        ]),
      )
    }
  }
  const groups = new Map<string, string>(nutrientDefinitions.map((definition) => [definition.key, definition.group]))
  for (const candidate of candidates) {
    for (const nutrient of candidate.nutrients) {
      if (nutrient.definition) groups.set(nutrient.definition.canonicalKey, nutrient.definition.nutrientGroup)
    }
  }
  return Object.fromEntries(groups)
}

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
  const rows = await readXlsxRows(input)
  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => /lebensmittel|food description|bezeichnung/i.test(cell)),
  )
  if (headerIndex < 0) throw new Error('BLS-XLSX: Kopfzeile mit Lebensmittelbezeichnung nicht gefunden.')
  const header = rows[headerIndex]
  const components = await readBlsComponents(join(dirname(input), 'BLS_4_0_Components_DE_EN.xlsx'))
  const columns = detectBlsColumns(header, components)
  const candidates: FoodCandidate[] = []
  for (const row of rows.slice(headerIndex + 1)) {
    const sourceRecordId = row[columns.codeIndex]?.trim()
    const nameDe = row[columns.nameDeIndex]?.trim()
    if (!sourceRecordId || !nameDe) continue
    const erratum = blsErratumFor(sourceRecordId)
    const nutrients = columns.nutrients.flatMap((column) => {
      const parsed = parseBlsValue(row[column.valueIndex], row[column.originIndex ?? -1] ?? '')
      if (!parsed) return []
      const origin = column.originIndex === null ? '' : (row[column.originIndex] ?? '')
      const reference = column.referenceIndex === null ? '' : (row[column.referenceIndex] ?? '')
      const originalValue =
        parsed.value === null ? null : convertNutrientUnit(parsed.value, column.sourceUnit, column.definition.unit)
      const correction = erratum?.corrections[column.definition.metadata.sourceMappings.blsCode as string]
      const value = correction?.value ?? originalValue
      return [
        observation({
          nutrientKey: column.definition.key,
          value,
          unit: column.definition.unit,
          source: 'bls',
          sourceRecordId,
          role: 'primary',
          valueStatus: parsed.valueStatus,
          provenance: [origin, reference, correction?.provenance].filter(Boolean).join(' · ') || null,
          definition: column.definition.metadata,
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
      qualityFlags: erratum?.qualityFlags,
      rawPayload: { cells: row, source: 'Max Rubner-Institut, BLS 4.0' },
    })
  }
  return candidates
}

interface BlsErratum {
  corrections: Record<string, { value: number; provenance: string }>
  qualityFlags: Array<{
    code: 'source_erratum'
    severity: 'warning'
    message: string
  }>
}

function blsErratumFor(sourceRecordId: string): BlsErratum | null {
  const erratumSource = 'BLS Erratum, Stand Februar 2026'
  if (sourceRecordId === 'M111100') {
    return {
      corrections: {
        RETOL: { value: 2.4, provenance: `${erratumSource}: RETOL korrigiert auf 2,4 µg/100 g` },
        VITA: { value: 3.1, provenance: `${erratumSource}: VITA korrigiert auf 3,1 µg/100 g` },
        VITAA: { value: 2.7, provenance: `${erratumSource}: VITAA korrigiert auf 2,7 µg/100 g` },
      },
      qualityFlags: [
        {
          code: 'source_erratum',
          severity: 'warning',
          message: `${erratumSource}: korrigierte Vitamin-A-/Retinol-Werte wurden angewendet.`,
        },
      ],
    }
  }

  if (['M200100', 'M2A0100', 'M2A1100', 'M206100', 'M2A6100', 'M2A2100'].includes(sourceRecordId)) {
    return {
      corrections: {},
      qualityFlags: [
        {
          code: 'source_erratum',
          severity: 'warning',
          message: `${erratumSource}: abgeleitete Vitamin-A-/Retinol-Werte dieses Eintrags sind laut Erratum bis zum nächsten BLS-Update potenziell zu hoch.`,
        },
      ],
    }
  }
  return null
}

interface BlsComponent {
  code: string
  nameDe: string
  nameEn: string
  unit: string
  group: string
}

interface BlsColumn {
  definition: {
    key: string
    unit: string
    metadata: NutrientDefinitionMetadata
  }
  valueIndex: number
  sourceUnit: string
  originIndex: number | null
  referenceIndex: number | null
}

async function readXlsxRows(input: string) {
  const files = unzipSync(new Uint8Array(await readFile(input)))
  const sheetName = Object.keys(files).find((name) => /^xl\/worksheets\/sheet1\.xml$/i.test(name))
  if (!sheetName) throw new Error(`${basename(input)} enthält kein erstes Arbeitsblatt.`)
  return parseWorksheetRows(files[sheetName], parseSharedStrings(files['xl/sharedStrings.xml']))
}

async function readBlsComponents(input: string) {
  try {
    const rows = await readXlsxRows(input)
    const components = new Map<string, BlsComponent>()
    for (const row of rows.slice(1)) {
      const code = row[1]?.trim()
      if (!code) continue
      components.set(code, {
        code,
        nameDe: row[2]?.trim() || code,
        nameEn: row[3]?.trim() || code,
        unit: row[4]?.trim() || 'unknown',
        group: row[5]?.trim() || 'Sonstige Nährstoffe',
      })
    }
    return components
  } catch {
    return new Map<string, BlsComponent>()
  }
}

function detectBlsColumns(header: string[], components: Map<string, BlsComponent>) {
  const codeIndex = findColumn(header, /lebensmittel.?code|food.?code|schlüssel|kennziffer/i, 0)
  const nameDeIndex = findColumn(
    header,
    /lebensmittel.?bezeichnung|bezeichnung|deutsche.?bezeichnung|food.?description/i,
    1,
  )
  const nutrients: BlsColumn[] = []
  for (const [valueIndex, value] of header.entries()) {
    const parsed = parseBlsHeader(value)
    if (!parsed || !parsed.hasUnit || /datenherkunft|referenz/i.test(parsed.suffix)) continue
    const component = components.get(parsed.code)
    const canonicalKey = blsCanonicalKey(parsed.code)
    const canonicalUnit = blsCanonicalUnit(parsed.code, parsed.unit)
    const metadata: NutrientDefinitionMetadata = {
      canonicalKey,
      nameDe: component?.nameDe ?? parsed.name,
      nameEn: component?.nameEn ?? null,
      unit: canonicalUnit,
      nutrientGroup: blsNutrientGroup(component?.group ?? parsed.name, parsed.code),
      sourceMappings: {
        blsCode: parsed.code,
        blsUnit: parsed.unit,
        blsNameDe: component?.nameDe ?? parsed.name,
        blsNameEn: component?.nameEn ?? null,
      },
    }
    nutrients.push({
      definition: { key: canonicalKey, unit: canonicalUnit, metadata },
      valueIndex,
      sourceUnit: parsed.unit,
      originIndex: findBlsRelatedColumn(header, parsed.code, /datenherkunft|herkunft|origin/i),
      referenceIndex: findBlsRelatedColumn(header, parsed.code, /referenz|reference/i),
    })
  }
  return { codeIndex, nameDeIndex, nutrients }
}

function parseBlsHeader(value: string) {
  const match = value.match(/^([A-Z0-9:]+)\s+(.+?)(?:\s+\[([^\]]+)\/100g\])?$/i)
  if (!match) return null
  const code = match[1]
  const rest = match[2].trim()
  const unit = match[3]?.trim() ?? ''
  const suffixMatch = rest.match(/^(.*?)(?:\s+(Datenherkunft|Referenz))$/i) ?? rest.match(/^(Datenherkunft|Referenz)$/i)
  return {
    code,
    name: suffixMatch?.[2] ? suffixMatch[1].trim() : '',
    suffix: suffixMatch?.[2] ?? suffixMatch?.[1] ?? '',
    unit: unit || 'unknown',
    hasUnit: Boolean(unit),
  }
}

function findBlsRelatedColumn(header: string[], code: string, suffix: RegExp) {
  const index = header.findIndex((value) => {
    const parsed = parseBlsHeader(value)
    return parsed?.code === code && suffix.test(parsed.suffix)
  })
  return index >= 0 ? index : null
}

const blsCanonicalKeyMap: Record<string, string> = {
  ENERCC: 'energy_kcal',
  PROT625: 'protein',
  FAT: 'fat',
  CHO: 'carbohydrate',
  FIBT: 'fiber',
  VITAA: 'vitamin_a',
  VITD: 'vitamin_d',
  VITE: 'vitamin_e',
  VITK: 'vitamin_k',
  THIA: 'thiamin',
  RIBF: 'riboflavin',
  NIA: 'niacin',
  PANTAC: 'pantothenic_acid',
  BIOT: 'biotin',
  FOL: 'folate',
  VITB12: 'vitamin_b12',
  VITC: 'vitamin_c',
  NA: 'sodium',
  K: 'potassium',
  CA: 'calcium',
  MG: 'magnesium',
  P: 'phosphorus',
  FE: 'iron',
  ZN: 'zinc',
  ID: 'iodine',
  CU: 'copper',
  MN: 'manganese',
}

function blsCanonicalKey(code: string) {
  return blsCanonicalKeyMap[code] ?? `bls_${code.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
}

function blsCanonicalUnit(code: string, sourceUnit: string) {
  if (code === 'CU' || code === 'MN') return 'mg'
  if (code === 'ENERCJ') return 'kJ'
  return sourceUnit === 'µg' || sourceUnit === 'mg' || sourceUnit === 'g' || sourceUnit === 'kcal'
    ? sourceUnit
    : sourceUnit.toLowerCase()
}

function blsNutrientGroup(componentGroup: string, code: string) {
  if (
    /vitamin/i.test(componentGroup) ||
    /^(VITA|VITAA|RETOL|CARTB|CAROTPAXB|VITD|CHOCAL|ERGCAL|VITE|TOC|VITK|THIA|RIBF|NIA|PANTAC|VITB6|BIOT|FOL|VITB12|VITC)/i.test(
      code,
    )
  )
    return 'vitamin'
  if (/element/i.test(componentGroup) || /^(NA|CLD|K|CA|MG|P|S|FE|ZN|ID|CU|MN|FD|CR|MO)$/i.test(code)) return 'mineral'
  if (/fatty/i.test(componentGroup) || /^(FASAT|FAMS|FAPU|FAPUN|F\d)/i.test(code)) return 'fatty_acid'
  if (
    /amino/i.test(componentGroup) ||
    /^(AAE9|ALA|ARG|ASP|CYSTE|GLU|GLY|HIS|ILE|LEU|LYS|MET|PHE|PRO|SER|THR|TRP|TYR|VAL)$/i.test(code)
  )
    return 'amino_acid'
  if (
    /makro|carbohydrate|fibre|polyol/i.test(componentGroup) ||
    /^(ENERCJ|ENERCC|WATER|PROT625|FAT|CHO|FIBT|ALC|OA|ASH|NACL|POLYL|MNSAC|DISAC|SUGAR|OLSAC|STARCH|FIB)/i.test(code)
  )
    return 'macro'
  return 'other'
}

function parseBlsValue(value: unknown, origin: string) {
  const raw = typeof value === 'string' ? value.trim() : String(value ?? '').trim()
  if (!raw || raw === '-') return null
  const numeric = parseNullableNumber(raw)
  if (numeric !== null) {
    const valueStatus = /logische null|logical zero/i.test(origin)
      ? 'logical_zero'
      : /spur|trace/i.test(origin)
        ? 'trace'
        : /berechnung|formula|aggregation|übernommen|musterberechnung/i.test(origin)
          ? 'calculated'
          : 'measured'
    return { value: numeric, valueStatus } as const
  }
  if (/^</.test(raw)) return { value: null, valueStatus: 'below_limit' as const }
  return null
}

function findColumn(header: string[], pattern: RegExp, fallback: number) {
  const index = header.findIndex((value) => pattern.test(value))
  return index >= 0 ? index : fallback
}

async function parseUsdaJson(input: string): Promise<FoodCandidate[]> {
  const payload = JSON.parse(await readFile(input, 'utf8')) as JsonRecord | JsonRecord[]
  const foods = Array.isArray(payload)
    ? payload
    : ['FoundationFoods', 'SRLegacyFoods', 'SurveyFoods', 'BrandedFoods', 'foods'].flatMap((key) =>
        Array.isArray(payload[key]) ? (payload[key] as JsonRecord[]) : [],
      )
  return foods.flatMap((food) => {
    if (!isRecord(food)) return []
    const sourceRecordId = String(food.fdcId ?? food.fdc_id ?? '')
    const name = cleanString(food.description) ?? cleanString(food.lowercaseDescription) ?? ''
    if (!sourceRecordId || !name) return []
    const branded = Boolean(cleanString(food.brandOwner) || cleanString(food.brandName))
    const nutrients = Array.isArray(food.foodNutrients)
      ? food.foodNutrients.flatMap((nutrient) => {
          const nutrientObject = isRecord(nutrient.nutrient) ? nutrient.nutrient : nutrient
          if (!isRecord(nutrientObject)) return []
          const sourceDefinition = findNutrientDefinition(String(nutrientObject.name ?? ''))
          const definition = sourceDefinition
            ? nutrientDefinitionMetadata(sourceDefinition)
            : dynamicUsdaNutrientDefinition(nutrientObject)
          const value = parseNullableNumber(nutrient.amount ?? nutrient.value)
          const sourceUnit = normalizeUsdaUnit(cleanString(nutrientObject.unitName) ?? '')
          if (!definition || value === null || value < 0 || !sourceUnit) return []
          try {
            return [
              observation({
                nutrientKey: definition.canonicalKey,
                value: convertNutrientUnit(value, sourceUnit, definition.unit),
                unit: definition.unit,
                source: 'usda',
                sourceRecordId,
                role: branded ? 'declared' : 'reference',
                valueStatus: branded
                  ? 'declared'
                  : /calculated|imputed/i.test(cleanString(nutrient.foodNutrientDerivation?.description) ?? '')
                    ? 'calculated'
                    : 'measured',
                provenance:
                  [cleanString(nutrientObject.name), cleanString(nutrient.foodNutrientDerivation?.description)]
                    .filter(Boolean)
                    .join(' · ') || null,
                definition,
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
        countryCode: branded ? null : 'US',
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
  if (Array.isArray(food.foodPortions)) {
    const portions = food.foodPortions.flatMap((portion) => {
      if (!isRecord(portion)) return []
      const grams = parseNullableNumber(portion.gramWeight)
      if (grams === null || grams <= 0) return []
      const description =
        cleanString(portion.portionDescription) ??
        [
          cleanString(portion.amount ?? portion.value),
          isRecord(portion.measureUnit) ? cleanString(portion.measureUnit.name) : null,
        ]
          .filter(Boolean)
          .join(' ')
      return [
        {
          labelDe: description ? `${description} (${grams} g)` : `Portion (${grams} g)`,
          amount: grams,
          unit: 'g' as const,
          grams,
          confidence: 0.9,
        },
      ]
    })
    if (portions.length > 0) return portions
  }
  const amount = parseNullableNumber(food.servingSize)
  const unit = cleanString(food.servingSizeUnit)?.toLowerCase() as 'g' | 'ml' | undefined
  if (amount === null || amount <= 0 || (unit !== 'g' && unit !== 'ml')) return []
  return [
    { labelDe: `Portion (${amount} ${unit})`, amount, unit, grams: unit === 'g' ? amount : null, confidence: 0.95 },
  ]
}

function dynamicUsdaNutrientDefinition(nutrient: JsonRecord): NutrientDefinitionMetadata | null {
  const name = cleanString(nutrient.name)
  const id = nutrient.id ?? nutrient.number
  const sourceId = id === null || id === undefined ? null : String(id)
  const unit = normalizeUsdaUnit(cleanString(nutrient.unitName) ?? '')
  if (!name || !sourceId || !unit) return null
  return {
    canonicalKey: `usda_${sourceId.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase()}`,
    nameDe: name,
    nameEn: name,
    unit,
    nutrientGroup: inferUsdaNutrientGroup(name),
    sourceMappings: { usdaNutrientId: sourceId, usdaName: name },
  }
}

function normalizeUsdaUnit(value: string) {
  const unit = value.trim().toLowerCase()
  if (!unit) return null
  if (unit === 'kj' || unit === 'kilojoule' || unit === 'kilojoules') return 'kJ'
  if (unit === 'kcal' || unit === 'calorie' || unit === 'calories') return 'kcal'
  if (unit === 'g' || unit === 'gram' || unit === 'grams') return 'g'
  if (unit === 'mg' || unit === 'milligram' || unit === 'milligrams') return 'mg'
  if (unit === 'ug' || unit === 'µg' || unit === 'μg' || unit === 'mcg' || unit === 'microgram') return 'µg'
  return unit
}

function inferUsdaNutrientGroup(name: string) {
  if (/vitamin|thiamin|riboflavin|niacin|folate|biotin|choline/i.test(name)) return 'vitamin'
  if (/calcium|iron|magnesium|phosphorus|potassium|sodium|zinc|copper|manganese|selenium|iodine|chloride/i.test(name))
    return 'mineral'
  if (/fatty acid|lipid/i.test(name)) return 'fatty_acid'
  if (
    /amino acid|alanine|arginine|aspartic|cysteine|glutamic|glycine|histidine|isoleucine|leucine|lysine|methionine|phenylalanine|proline|serine|threonine|tryptophan|tyrosine|valine/i.test(
      name,
    )
  )
    return 'amino_acid'
  if (/energy|protein|carbohydrate|fat|fiber|sugar|water|ash|alcohol|cholesterol/i.test(name)) return 'macro'
  return 'other'
}

async function parseOpenFoodFacts(input: string, countries: string[]): Promise<FoodCandidate[]> {
  const candidates: FoodCandidate[] = []
  const stream = input.toLowerCase().endsWith('.gz')
    ? createReadStream(input).pipe(createGunzip())
    : createReadStream(input, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  let firstNonEmpty = ''
  let csvHeaders: string[] | null = null
  let csvIndexes: Map<string, number> | null = null
  for await (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (!firstNonEmpty) firstNonEmpty = trimmed[0]
    if (!csvHeaders && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      csvHeaders = parseDelimitedLine(line, '\t')
      csvIndexes = new Map(csvHeaders.map((header, index) => [header, index]))
      continue
    }
    if (csvHeaders) {
      const fields = parseDelimitedLine(line, '\t')
      const product = openFoodFactsCsvProduct(csvHeaders, csvIndexes ?? new Map(), fields)
      if (product) candidates.push(...parseOffProduct(product, countries))
      continue
    }
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

function parseDelimitedLine(line: string, delimiter: string) {
  const fields: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === delimiter && !quoted) {
      fields.push(field)
      field = ''
    } else {
      field += character
    }
  }
  fields.push(field)
  return fields
}

function openFoodFactsCsvProduct(headers: string[], indexes: Map<string, number>, fields: string[]): JsonRecord | null {
  const value = (name: string) => {
    const index = indexes.get(name) ?? -1
    return index >= 0 ? cleanString(fields[index]) : null
  }
  const code = value('code')
  const productName = value('product_name')
  const productNameDe = value('product_name_de')
  if (!code || (!productName && !productNameDe)) return null
  const nutriments: JsonRecord = {}
  for (const [index, header] of headers.entries()) {
    if (!header.endsWith('_100g') && !header.endsWith('_100ml')) continue
    const parsed = parseNullableNumber(fields[index])
    if (parsed !== null) nutriments[header] = parsed
  }
  return {
    code,
    product_name: productName,
    product_name_de: productNameDe,
    brands: value('brands'),
    quantity: value('quantity'),
    categories: value('categories'),
    languages: value('languages'),
    countries: value('countries'),
    countries_tags: (value('countries_tags') ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    serving_quantity: value('serving_quantity'),
    last_modified_t: value('last_modified_t'),
    nutriments,
  }
}

function parseOffProduct(product: JsonRecord, countries: string[]): FoodCandidate[] {
  if (!offProductMatchesCountry(product, countries)) return []
  const sourceRecordId = cleanString(product.code) ?? ''
  const name = cleanString(product.product_name_de) ?? cleanString(product.product_name) ?? ''
  if (!sourceRecordId || !name) return []
  const barcode = normalizeBarcode(sourceRecordId)
  if (!barcode) return []
  const brand = cleanString(product.brands)
  if (!brand) return []
  const nutriments = isRecord(product.nutriments) ? product.nutriments : {}
  const basisUnit = parseNullableNumber(nutriments['energy-kcal_100ml']) !== null ? 'ml' : 'g'
  const nutrients = nutrientDefinitions.flatMap((definition) => {
    const key = offNutrientKey(definition.key)
    const value = parseNullableNumber(nutriments[`${key}_100${basisUnit}`])
    if (value === null || value < 0) return []
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
  if (!nutrients.some((nutrient) => ['energy_kcal', 'protein', 'carbohydrate', 'fat'].includes(nutrient.nutrientKey))) {
    return []
  }
  return [
    {
      id: `off-${sourceRecordId}`,
      nameDe: name,
      nameEn: cleanString(product.product_name),
      normalizedName: normalizeSearchText(name),
      brand,
      manufacturer: brand,
      gtin: barcode,
      kind: 'branded',
      preparationState: inferPreparationState(name),
      countryCode: 'DE',
      source: 'open_food_facts',
      sourceRecordId,
      sourceUpdatedAt: offSourceUpdatedAt(product.last_modified_t),
      nutrients,
      portions: offPortion(product, basisUnit),
      rawPayload: {
        ...product,
        _bontSource: 'Open Food Facts',
        _bontLicense: 'ODbL 1.0 / DbCL',
        _bontAttribution: 'Open Food Facts',
      },
    },
  ]
}

function offSourceUpdatedAt(value: unknown) {
  const raw = typeof value === 'number' && Number.isFinite(value) ? String(value) : cleanString(value)
  if (!raw) return null
  if (/^\d{10}$/.test(raw)) return new Date(Number(raw) * 1000).toISOString()
  return raw
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
    async ensureNutrientDefinitions(definitions) {
      if (definitions.length === 0) return
      const { error } = await supabase.from('nutrients').upsert(
        definitions.map((definition) => ({
          canonical_key: definition.canonicalKey,
          name_de: definition.nameDe,
          name_en: definition.nameEn,
          unit: definition.unit,
          nutrient_group: definition.nutrientGroup,
          source_mappings: definition.sourceMappings,
          is_active: true,
        })),
        { onConflict: 'canonical_key', ignoreDuplicates: true },
      )
      if (error) throw formatSupabaseError(error, 'Nährstoffdefinitionen konnten nicht bereitgestellt werden.')
    },
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
      const { data, error } = await supabase.rpc('import_food_catalog_record_safe', {
        p_run_id: runId,
        p_dedupe_key: record.dedupeKey,
        p_record: compactRecord(record),
      })
      if (error) throw formatSupabaseError(error, `Datensatz ${record.dedupeKey} konnte nicht geladen werden.`)
      return parseLoadResult(data)
    },

    async loadRecords(runId, records) {
      const { data, error } = await supabase.rpc('import_food_catalog_records', {
        p_run_id: runId,
        p_records: records.map(compactRecord),
      })
      if (error) throw formatSupabaseError(error, 'Batch von Food-Datensätzen konnte nicht geladen werden.')
      return parseBatchLoadResults(data)
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

function compactRecord(record: CanonicalImportRecord) {
  return {
    ...record,
    nutrientDefinitions: undefined,
    nutrients: record.nutrients.map((nutrient) => {
      const compactNutrient = { ...nutrient }
      delete compactNutrient.definition
      return compactNutrient
    }),
  }
}

function parseBatchLoadResults(value: unknown): CatalogBatchLoadResult[] {
  if (!Array.isArray(value)) throw new Error('Batch-Loader lieferte kein Ergebnisarray.')
  return value.map((item) => {
    if (!isRecord(item) || typeof item.ok !== 'boolean')
      throw new Error('Batch-Loader lieferte ein ungültiges Ergebnis.')
    return item.ok
      ? { result: parseLoadResult(item.result) }
      : { result: null, error: typeof item.error === 'string' ? item.error : 'Unbekannter Datensatzfehler.' }
  })
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

await main()
