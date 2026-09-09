import { describe, expect, it } from 'vitest'
import type { CatalogImportDatabase, CatalogImportError, CatalogImportCounts, CatalogRecordLoadResult } from './loader'
import { loadCatalogRecords } from './loader'
import type { CanonicalImportRecord } from './import-record'

const record: CanonicalImportRecord = {
  dedupeKey: 'generic|skyr|unknown||DE',
  identity: {
    id: 'bls-1',
    nameDe: 'Skyr',
    nameEn: null,
    normalizedName: 'skyr',
    kind: 'generic',
    preparationState: 'unknown',
    countryCode: 'DE',
  },
  identitySource: 'bls',
  sourceRecords: [{ source: 'bls', sourceRecordId: 'bls-1', rawPayload: { name: 'Skyr' } }],
  identityMappings: [],
  nutrients: [],
  portions: [],
  qualityFlags: [],
  nutrientCoverage: { total: 0, known: 0, percentage: 0, byGroup: {} },
  rejectedReferenceNutrients: [],
  conflictingNutrients: [],
}

class FakeDatabase implements CatalogImportDatabase {
  readonly foods = new Map<string, string>()
  readonly finished: Array<{
    runId: string
    status: string
    counts: CatalogImportCounts
    errors: CatalogImportError[]
  }> = []
  private nextRun = 1

  async startRun() {
    return `run-${this.nextRun++}`
  }

  async loadRecord(_runId: string, input: CanonicalImportRecord): Promise<CatalogRecordLoadResult> {
    const foodCreated = !this.foods.has(input.dedupeKey)
    if (foodCreated) this.foods.set(input.dedupeKey, `food-${this.foods.size + 1}`)
    return {
      foodId: this.foods.get(input.dedupeKey) ?? 'missing',
      foodCreated,
      sourceRecordsUpserted: 1,
      identityMappingsUpserted: 0,
      nutrientObservationsUpserted: 0,
      canonicalNutrientsUpserted: 0,
      portionsUpserted: 0,
      qualityFlagsUpserted: 0,
    }
  }

  async finishRun(input: {
    runId: string
    status: 'loaded' | 'failed'
    counts: CatalogImportCounts
    errors: CatalogImportError[]
  }) {
    this.finished.push(input)
  }
}

describe('catalog loader orchestration', () => {
  it('is idempotent at the loader boundary when the same record is run twice', async () => {
    const database = new FakeDatabase()
    const first = await loadCatalogRecords(database, {
      source: 'bls',
      sourceVersion: 'fixture-1',
      candidates: 1,
      duplicateCandidates: 0,
      records: [record],
    })
    const second = await loadCatalogRecords(database, {
      source: 'bls',
      sourceVersion: 'fixture-1',
      candidates: 1,
      duplicateCandidates: 0,
      records: [record],
    })

    expect(first.status).toBe('loaded')
    expect(first.counts.foodsCreated).toBe(1)
    expect(second.status).toBe('loaded')
    expect(second.counts.foodsCreated).toBe(0)
    expect(second.counts.foodsReused).toBe(1)
    expect(database.foods.size).toBe(1)
    expect(database.finished).toHaveLength(2)
  })

  it('continues after a single-record error and records a failed run', async () => {
    const database = new FakeDatabase()
    const badRecord = { ...record, dedupeKey: 'bad-record' }
    const originalLoad = database.loadRecord.bind(database)
    database.loadRecord = async (runId, input) => {
      if (input.dedupeKey === 'bad-record') throw new Error('ungültige Portion')
      return originalLoad(runId, input)
    }

    const result = await loadCatalogRecords(database, {
      source: 'open_food_facts',
      sourceVersion: 'fixture-1',
      candidates: 2,
      duplicateCandidates: 0,
      records: [record, badRecord],
    })

    expect(result.status).toBe('failed')
    expect(result.counts.loadedRecords).toBe(1)
    expect(result.counts.failedRecords).toBe(1)
    expect(result.errors).toEqual([expect.objectContaining({ dedupeKey: 'bad-record', message: 'ungültige Portion' })])
    expect(database.finished[0]?.status).toBe('failed')
  })

  it('validates records before opening a database transaction', async () => {
    const database = new FakeDatabase()
    const invalidRecord = {
      ...record,
      dedupeKey: 'invalid-record',
      nutrients: [
        {
          nutrientKey: 'protein',
          value: 10,
          unit: 'g',
          basisAmount: 0,
          basisUnit: 'g' as const,
          source: 'bls' as const,
          sourceRecordId: 'bls-1',
          derivation: 'direct' as const,
          valueStatus: 'measured' as const,
          confidence: 0.95,
          provenance: null,
        },
      ],
    }

    const result = await loadCatalogRecords(database, {
      source: 'bls',
      sourceVersion: 'fixture-1',
      candidates: 1,
      duplicateCandidates: 0,
      records: [invalidRecord],
    })

    expect(result.status).toBe('failed')
    expect(result.errors[0]?.message).toContain('Bezugsmenge ist ungültig')
    expect(database.foods.size).toBe(0)
  })
})
