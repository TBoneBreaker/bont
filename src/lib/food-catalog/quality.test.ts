import { describe, expect, it } from 'vitest'
import { calculateCoverage, checkNutrientPlausibility } from './quality'
import type { NutrientObservation } from './types'

function item(nutrientKey: string, value: number | null): NutrientObservation {
  return {
    nutrientKey,
    value,
    unit: nutrientKey === 'energy_kcal' ? 'kcal' : 'g',
    basisAmount: 100,
    basisUnit: 'g',
    source: 'bls',
    sourceRecordId: 'bls-1',
    role: 'primary',
    valueStatus: value === 0 ? 'logical_zero' : value === null ? 'unknown' : 'measured',
    confidence: 0.99,
    provenance: null,
  }
}

describe('food catalog plausibility', () => {
  it('flags suspicious values without correcting them', () => {
    const flags = checkNutrientPlausibility([
      item('protein', 110),
      item('carbohydrate', 10),
      item('fat', 10),
      item('energy_kcal', 50),
    ])
    expect(flags.map((flag) => flag.code)).toContain('macro_over_100g')
    expect(flags.map((flag) => flag.code)).toContain('energy_mismatch')
  })

  it('counts only non-null values as covered', () => {
    const coverage = calculateCoverage([item('protein', 0), item('fat', null)], { protein: 'macro', fat: 'macro' })
    expect(coverage).toMatchObject({ total: 2, known: 1, percentage: 50 })
    expect(coverage.byGroup.macro).toMatchObject({ total: 2, known: 1, percentage: 50 })
  })
})
