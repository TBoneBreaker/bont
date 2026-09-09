import { describe, expect, it } from 'vitest'
import { buildCanonicalRecord } from './import-record'
import type { FoodCandidate, NutrientObservation } from './types'

function observation(overrides: Partial<NutrientObservation>): NutrientObservation {
  return {
    nutrientKey: 'protein',
    value: 20,
    unit: 'g',
    basisAmount: 100,
    basisUnit: 'g',
    source: 'bls',
    sourceRecordId: 'bls-1',
    role: 'primary',
    valueStatus: 'measured',
    confidence: 0.99,
    provenance: 'BLS analysis',
    ...overrides,
  }
}

function food(overrides: Partial<FoodCandidate>): FoodCandidate {
  return {
    id: 'food-1',
    nameDe: 'Skyr',
    normalizedName: 'skyr',
    kind: 'generic',
    preparationState: 'unknown',
    countryCode: 'DE',
    source: 'bls',
    sourceRecordId: 'bls-1',
    nutrients: [],
    rawPayload: { source: 'fixture' },
    ...overrides,
  }
}

describe('canonical import records', () => {
  it('keeps BLS as the direct value and inherits only missing USDA nutrients', () => {
    const record = buildCanonicalRecord('generic|skyr|unknown||DE', [
      food({
        nutrients: [observation({ nutrientKey: 'protein', value: 10, sourceRecordId: 'bls-1' })],
      }),
      food({
        source: 'usda',
        sourceRecordId: 'usda-1',
        nutrients: [
          observation({
            nutrientKey: 'protein',
            value: 30,
            source: 'usda',
            sourceRecordId: 'usda-1',
            role: 'reference',
          }),
          observation({
            nutrientKey: 'calcium',
            value: 120,
            unit: 'mg',
            source: 'usda',
            sourceRecordId: 'usda-1',
            role: 'reference',
          }),
        ],
      }),
    ])

    expect(record.nutrients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nutrientKey: 'protein', value: 10, source: 'bls', derivation: 'direct' }),
        expect.objectContaining({
          nutrientKey: 'calcium',
          value: 120,
          source: 'usda',
          derivation: 'inherited_reference',
        }),
      ]),
    )
    expect(record.nutrients.find((nutrient) => nutrient.nutrientKey === 'protein')?.value).not.toBe(20)
    expect(record.identityMappings).toHaveLength(1)
  })

  it('does not serialize unknown values as zero and preserves reliable portions', () => {
    const record = buildCanonicalRecord('branded|gouda|unknown|marke|DE', [
      food({
        kind: 'branded',
        source: 'open_food_facts',
        sourceRecordId: '4006381333931',
        brand: 'Marke',
        gtin: '4006381333931',
        nutrients: [
          observation({ value: 0, valueStatus: 'logical_zero', role: 'declared', source: 'open_food_facts' }),
        ],
        portions: [{ labelDe: 'Portion (150 g)', amount: 150, unit: 'g', grams: 150, confidence: 0.95 }],
      }),
    ])

    expect(record.nutrients[0]).toMatchObject({ value: 0, valueStatus: 'logical_zero' })
    expect(record.nutrients.some((nutrient) => nutrient.value === null)).toBe(false)
    expect(record.portions).toEqual([
      { labelDe: 'Portion (150 g)', amount: 150, unit: 'g', grams: 150, confidence: 0.95 },
    ])
  })

  it('treats a standalone USDA generic as direct USDA data', () => {
    const record = buildCanonicalRecord('generic|oats|raw||US', [
      food({
        source: 'usda',
        sourceRecordId: 'usda-2',
        nameDe: 'Oats, raw',
        normalizedName: 'oats raw',
        countryCode: 'US',
        nutrients: [
          observation({
            nutrientKey: 'protein',
            value: 13.2,
            source: 'usda',
            sourceRecordId: 'usda-2',
            role: 'reference',
          }),
        ],
      }),
    ])

    expect(record.nutrients[0]).toMatchObject({
      source: 'usda',
      derivation: 'direct',
    })
  })
})
