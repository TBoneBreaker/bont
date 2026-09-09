import { describe, expect, it } from 'vitest'
import { rankFoods } from './ranking'

describe('food catalog ranking', () => {
  it('prioritizes exact German generic names, then Germany, over recipes and brand-only matches', () => {
    const ranked = rankFoods(
      [
        { id: 'brand', nameDe: 'Joghurt Natur', brand: 'Skyr', kind: 'branded' as const, countryCode: 'DE' },
        { id: 'recipe', nameDe: 'Skyr Bowl Rezept', kind: 'recipe' as const, countryCode: 'DE' },
        { id: 'generic', nameDe: 'Skyr', kind: 'generic' as const, countryCode: 'DE', nutrientCoverage: 80 },
      ],
      'Skyr',
    )
    expect(ranked.map((food) => food.id)).toEqual(['generic', 'brand', 'recipe'])
  })
})
