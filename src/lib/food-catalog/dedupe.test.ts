import { describe, expect, it } from 'vitest'
import { foodDedupeKey, groupDuplicateFoods } from './dedupe'
import type { FoodCandidate } from './types'

function food(overrides: Partial<FoodCandidate>): FoodCandidate {
  return {
    id: 'internal',
    nameDe: 'Joghurt Natur',
    normalizedName: 'joghurt natur',
    kind: 'branded',
    preparationState: 'unknown',
    source: 'open_food_facts',
    sourceRecordId: 'off-1',
    nutrients: [],
    ...overrides,
  }
}

describe('food deduplication', () => {
  it('uses validated GTIN identity for branded products', () => {
    const first = food({ gtin: '4006381333931' })
    const second = food({ gtin: '04006381333931', sourceRecordId: 'off-2' })
    expect(foodDedupeKey(first)).toBe(foodDedupeKey(second))
    expect(groupDuplicateFoods([first, second])).toHaveLength(1)
  })

  it('keeps raw/cooked generic foods separate', () => {
    const raw = food({ kind: 'generic', nameDe: 'Reis', preparationState: 'raw', gtin: null })
    const cooked = food({
      kind: 'generic',
      nameDe: 'Reis',
      preparationState: 'cooked',
      gtin: null,
      sourceRecordId: 'bls-cooked',
    })
    expect(groupDuplicateFoods([raw, cooked])).toHaveLength(2)
  })
})
