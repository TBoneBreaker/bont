import type { CatalogSource, FoodIdentity, FoodPortionCandidate, NutrientDefinitionMetadata } from './types.ts'
import { validateCanonicalImportRecord, type CanonicalImportRecord } from './import-record.ts'

export type ImportRunStatus = 'running' | 'validated' | 'loaded' | 'failed' | 'rolled_back'

export interface CatalogImportError {
  dedupeKey: string
  sourceRecords: string[]
  message: string
}

export interface CatalogRecordLoadResult {
  foodId: string
  foodCreated: boolean
  sourceRecordsUpserted: number
  identityMappingsUpserted: number
  nutrientObservationsUpserted: number
  canonicalNutrientsUpserted: number
  portionsUpserted: number
  qualityFlagsUpserted: number
}

export interface CatalogBatchLoadResult {
  result: CatalogRecordLoadResult | null
  error?: string
}

export interface CatalogImportDatabase {
  startRun(input: {
    source: CatalogSource
    sourceVersion: string
    plannedRecords: number
    metadata: Record<string, unknown>
  }): Promise<string>
  ensureNutrientDefinitions?(definitions: NutrientDefinitionMetadata[]): Promise<void>
  syncFoodMetadata?(input: {
    foodId: string
    identity: Omit<FoodIdentity, 'nutrients' | 'source' | 'sourceRecordId' | 'portions' | 'rawPayload'>
    portions: FoodPortionCandidate[]
  }): Promise<void>
  syncFoodMetadataBatch?(inputs: Array<{
    foodId: string
    identity: Omit<FoodIdentity, 'nutrients' | 'source' | 'sourceRecordId' | 'portions' | 'rawPayload'>
    portions: FoodPortionCandidate[]
  }>): Promise<void>
  loadRecord(runId: string, record: CanonicalImportRecord): Promise<CatalogRecordLoadResult>
  loadRecords?(runId: string, records: CanonicalImportRecord[]): Promise<CatalogBatchLoadResult[]>
  finishRun(input: {
    runId: string
    status: Exclude<ImportRunStatus, 'running' | 'validated' | 'rolled_back'>
    counts: CatalogImportCounts
    errors: CatalogImportError[]
  }): Promise<void>
}

export interface CatalogImportCounts {
  candidateRecords: number
  deduplicatedFoods: number
  duplicateCandidates: number
  loadedRecords: number
  failedRecords: number
  foodsCreated: number
  foodsReused: number
  sourceRecordsUpserted: number
  identityMappingsUpserted: number
  nutrientObservationsUpserted: number
  canonicalNutrientsUpserted: number
  portionsUpserted: number
  qualityFlagsUpserted: number
}

export interface CatalogImportResult {
  runId: string
  status: 'loaded' | 'failed'
  counts: CatalogImportCounts
  errors: CatalogImportError[]
}

export interface CatalogImportInput {
  source: CatalogSource
  sourceVersion: string
  candidates: number
  duplicateCandidates: number
  records: CanonicalImportRecord[]
  metadata?: Record<string, unknown>
}

/**
 * Loads records one at a time. The database RPC wraps every record in one
 * transaction, so a malformed record rolls back only itself while the run
 * continues and records the error for later inspection.
 */
export async function loadCatalogRecords(
  database: CatalogImportDatabase,
  input: CatalogImportInput,
): Promise<CatalogImportResult> {
  const runId = await database.startRun({
    source: input.source,
    sourceVersion: input.sourceVersion,
    plannedRecords: input.records.length,
    metadata: input.metadata ?? {},
  })
  const errors: CatalogImportError[] = []
  const counts: CatalogImportCounts = {
    candidateRecords: input.candidates,
    deduplicatedFoods: input.records.length,
    duplicateCandidates: input.duplicateCandidates,
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

  if (database.ensureNutrientDefinitions) {
    try {
      await database.ensureNutrientDefinitions(uniqueNutrientDefinitions(input.records))
    } catch (error) {
      const structuralError: CatalogImportError = {
        dedupeKey: '__nutrient-definitions__',
        sourceRecords: [],
        message: error instanceof Error ? error.message : String(error),
      }
      await database.finishRun({ runId, status: 'failed', counts, errors: [structuralError] })
      return { runId, status: 'failed', counts, errors: [structuralError] }
    }
  }

  const validRecords: CanonicalImportRecord[] = []
  for (const record of input.records) {
    try {
      const validationErrors = validateCanonicalImportRecord(record)
      if (validationErrors.length > 0) throw new Error(validationErrors.join(' '))
      validRecords.push(record)
    } catch (error) {
      addRecordError(errors, record, error)
    }
  }

  if (database.loadRecords) {
    for (const batch of chunk(validRecords, 25)) {
      try {
        const results = await database.loadRecords(runId, batch)
        if (results.length !== batch.length) throw new Error('Batch-Loader lieferte eine unerwartete Ergebnisanzahl.')
        const metadataItems: Array<{
          record: CanonicalImportRecord
          loaded: CatalogRecordLoadResult
        }> = []
        for (const [index, item] of results.entries()) {
          const record = batch[index]
          if (!record) continue
          if (item.result) {
            addLoadCounts(counts, item.result)
            metadataItems.push({ record, loaded: item.result })
          }
          else addRecordError(errors, record, item.error ?? 'Datensatz konnte nicht geladen werden.')
        }
        if (database.syncFoodMetadataBatch && metadataItems.length > 0) {
          try {
            await database.syncFoodMetadataBatch(
              metadataItems.map(({ record, loaded }) => ({
                foodId: loaded.foodId,
                identity: record.identity,
                portions: record.portions,
              })),
            )
          } catch (error) {
            for (const { record } of metadataItems) addRecordError(errors, record, error)
          }
        } else if (database.syncFoodMetadata) {
          for (const { record, loaded } of metadataItems) {
            try {
              await database.syncFoodMetadata({ foodId: loaded.foodId, identity: record.identity, portions: record.portions })
            } catch (error) {
              addRecordError(errors, record, error)
            }
          }
        }
      } catch (error) {
        for (const record of batch) addRecordError(errors, record, error)
      }
    }
  } else {
    for (const record of validRecords) {
      try {
        const loaded = await database.loadRecord(runId, record)
        addLoadCounts(counts, loaded)
        if (database.syncFoodMetadata) {
          await database.syncFoodMetadata({ foodId: loaded.foodId, identity: record.identity, portions: record.portions })
        }
      } catch (error) {
        addRecordError(errors, record, error)
      }
    }
  }

  counts.failedRecords = errors.length
  const status = errors.length === 0 ? 'loaded' : 'failed'
  await database.finishRun({ runId, status, counts, errors })
  return { runId, status, counts, errors }
}

function addLoadCounts(counts: CatalogImportCounts, loaded: CatalogRecordLoadResult) {
  counts.loadedRecords += 1
  counts.foodsCreated += loaded.foodCreated ? 1 : 0
  counts.foodsReused += loaded.foodCreated ? 0 : 1
  counts.sourceRecordsUpserted += loaded.sourceRecordsUpserted
  counts.identityMappingsUpserted += loaded.identityMappingsUpserted
  counts.nutrientObservationsUpserted += loaded.nutrientObservationsUpserted
  counts.canonicalNutrientsUpserted += loaded.canonicalNutrientsUpserted
  counts.portionsUpserted += loaded.portionsUpserted
  counts.qualityFlagsUpserted += loaded.qualityFlagsUpserted
}

function addRecordError(errors: CatalogImportError[], record: CanonicalImportRecord, error: unknown) {
  errors.push({
    dedupeKey: record.dedupeKey,
    sourceRecords: record.sourceRecords.map((sourceRecord) => `${sourceRecord.source}:${sourceRecord.sourceRecordId}`),
    message: error instanceof Error ? error.message : String(error),
  })
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size))
  return chunks
}

function uniqueNutrientDefinitions(records: CanonicalImportRecord[]) {
  const definitions = new Map<string, NutrientDefinitionMetadata>()
  for (const record of records) {
    for (const definition of record.nutrientDefinitions) definitions.set(definition.canonicalKey, definition)
  }
  return [...definitions.values()]
}

export function summarizeCatalogRecords(input: {
  source: CatalogSource
  sourceVersion: string
  candidates: number
  duplicateCandidates: number
  records: CanonicalImportRecord[]
}) {
  const coverage = input.records.map((record) => record.nutrientCoverage.percentage)
  const sortedCoverage = coverage.slice().sort((left, right) => left - right)
  const medianCoverage = sortedCoverage.length ? (sortedCoverage[Math.floor((sortedCoverage.length - 1) / 2)] ?? 0) : 0
  const qualityFlagCounts = input.records
    .flatMap((record) => record.qualityFlags)
    .reduce<Record<string, number>>((counts, flag) => {
      const key = `${flag.severity}:${flag.code}`
      counts[key] = (counts[key] ?? 0) + 1
      return counts
    }, {})
  return {
    source: input.source,
    sourceVersion: input.sourceVersion,
    candidates: input.candidates,
    deduplicatedFoods: input.records.length,
    duplicateCandidates: input.duplicateCandidates,
    qualityErrors: input.records.flatMap((record) => record.qualityFlags).filter((flag) => flag.severity === 'error')
      .length,
    qualityWarnings: input.records
      .flatMap((record) => record.qualityFlags)
      .filter((flag) => flag.severity === 'warning').length,
    qualityFlagCounts,
    canonicalNutrients: input.records.reduce((total, record) => total + record.nutrients.length, 0),
    foodsWithMicronutrients: input.records.filter((record) =>
      record.nutrientDefinitions.some((definition) => definition.nutrientGroup === 'vitamin'),
    ).length,
    portions: input.records.reduce((total, record) => total + record.portions.length, 0),
    unmappedReferenceValues: input.records.reduce(
      (total, record) => total + record.rejectedReferenceNutrients.length,
      0,
    ),
    nutrientCoverage: {
      averagePercentage: coverage.length ? coverage.reduce((total, value) => total + value, 0) / coverage.length : 0,
      medianPercentage: medianCoverage,
      foodsAbove90Percent: coverage.filter((value) => value >= 90).length,
    },
  }
}
