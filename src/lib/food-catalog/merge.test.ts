import { describe, expect, it } from 'vitest'
import { REFERENCE_INHERITANCE_THRESHOLD, selectCanonicalNutrients } from './merge'
import type { NutrientInheritanceRule, NutrientObservation } from './types'

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
    provenance: 'analysis',
    ...overrides,
  }
}

function rule(overrides: Partial<NutrientInheritanceRule> = {}): NutrientInheritanceRule {
  return {
    nutrientKey: 'protein',
    allowed: true,
    confidence: REFERENCE_INHERITANCE_THRESHOLD,
    stateMatches: true,
    definitionMatches: true,
    reason: 'same generic food and preparation state',
    ...overrides,
  }
}

describe('selectCanonicalNutrients', () => {
  it('keeps BLS as primary and never averages a conflicting USDA value', () => {
    const result = selectCanonicalNutrients(
      'generic',
      [
        observation({ value: 20, source: 'bls', sourceRecordId: 'bls-1', role: 'primary' }),
        observation({ value: 30, source: 'usda', sourceRecordId: 'usda-1', role: 'reference' }),
      ],
      [rule()],
    )

    expect(result.nutrients[0]).toMatchObject({ value: 20, source: 'bls', derivation: 'direct' })
    expect(result.nutrients[0].value).not.toBe(25)
    expect(result.conflictingNutrients).toEqual([])
  })

  it('inherits a missing generic value only when the per-nutrient rule is safe', () => {
    const result = selectCanonicalNutrients(
      'generic',
      [
        observation({ value: null, source: 'bls', sourceRecordId: 'bls-1', role: 'primary', valueStatus: 'unknown' }),
        observation({ value: 30, source: 'usda', sourceRecordId: 'usda-1', role: 'reference' }),
      ],
      [rule()],
    )

    expect(result.nutrients[0]).toMatchObject({ value: 30, source: 'usda', derivation: 'inherited_reference' })
  })

  it('rejects reference inheritance below the threshold or with a mismatched state', () => {
    const result = selectCanonicalNutrients(
      'branded',
      [
        observation({
          value: null,
          source: 'open_food_facts',
          sourceRecordId: 'off-1',
          role: 'declared',
          valueStatus: 'unknown',
        }),
        observation({ value: 30, source: 'bls', sourceRecordId: 'bls-1', role: 'reference' }),
      ],
      [rule({ confidence: 0.89, stateMatches: false })],
    )

    expect(result.nutrients).toEqual([])
    expect(result.rejectedReferenceNutrients).toEqual(['protein'])
  })

  it('lets a declared brand value win over a reference value', () => {
    const result = selectCanonicalNutrients(
      'branded',
      [
        observation({
          value: 5,
          source: 'open_food_facts',
          sourceRecordId: 'off-1',
          role: 'declared',
          valueStatus: 'declared',
        }),
        observation({ value: 20, source: 'bls', sourceRecordId: 'bls-1', role: 'reference' }),
      ],
      [rule()],
    )

    expect(result.nutrients[0]).toMatchObject({ value: 5, source: 'open_food_facts', derivation: 'direct' })
  })

  it('retains true zero as a known direct value', () => {
    const result = selectCanonicalNutrients(
      'generic',
      [
        observation({ value: 0, source: 'bls', sourceRecordId: 'bls-1', valueStatus: 'logical_zero' }),
        observation({ value: 20, source: 'usda', sourceRecordId: 'usda-1', role: 'reference' }),
      ],
      [rule()],
    )

    expect(result.nutrients[0]).toMatchObject({ value: 0, valueStatus: 'logical_zero' })
  })
})
