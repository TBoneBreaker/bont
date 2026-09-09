import type { CatalogSource } from './types.ts'
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

export interface CatalogImportDatabase {
  startRun(input: {
    source: CatalogSource
    sourceVersion: string
    plannedRecords: number
    metadata: Record<string, unknown>
  }): Promise<string>
  loadRecord(runId: string, record: CanonicalImportRecord): Promise<CatalogRecordLoadResult>
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

  for (const record of input.records) {
    try {
      const validationErrors = validateCanonicalImportRecord(record)
      if (validationErrors.length > 0) throw new Error(validationErrors.join(' '))
      const loaded = await database.loadRecord(runId, record)
      counts.loadedRecords += 1
      counts.foodsCreated += loaded.foodCreated ? 1 : 0
      counts.foodsReused += loaded.foodCreated ? 0 : 1
      counts.sourceRecordsUpserted += loaded.sourceRecordsUpserted
      counts.identityMappingsUpserted += loaded.identityMappingsUpserted
      counts.nutrientObservationsUpserted += loaded.nutrientObservationsUpserted
      counts.canonicalNutrientsUpserted += loaded.canonicalNutrientsUpserted
      counts.portionsUpserted += loaded.portionsUpserted
      counts.qualityFlagsUpserted += loaded.qualityFlagsUpserted
    } catch (error) {
      counts.failedRecords += 1
      errors.push({
        dedupeKey: record.dedupeKey,
        sourceRecords: record.sourceRecords.map(
          (sourceRecord) => `${sourceRecord.source}:${sourceRecord.sourceRecordId}`,
        ),
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const status = errors.length === 0 ? 'loaded' : 'failed'
  await database.finishRun({ runId, status, counts, errors })
  return { runId, status, counts, errors }
}

export function summarizeCatalogRecords(input: {
  source: CatalogSource
  sourceVersion: string
  candidates: number
  duplicateCandidates: number
  records: CanonicalImportRecord[]
}) {
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
    canonicalNutrients: input.records.reduce((total, record) => total + record.nutrients.length, 0),
    foodsWithMicronutrients: input.records.filter((record) =>
      record.nutrients.some(
        (nutrient) => nutrient.nutrientKey.startsWith('vitamin_') || nutrient.nutrientKey === 'folate',
      ),
    ).length,
    portions: input.records.reduce((total, record) => total + record.portions.length, 0),
    unmappedReferenceValues: input.records.reduce(
      (total, record) => total + record.rejectedReferenceNutrients.length,
      0,
    ),
  }
}
