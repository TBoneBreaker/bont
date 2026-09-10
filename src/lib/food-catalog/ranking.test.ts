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

  it('keeps a base food ahead of German compounds and recipes', () => {
    const ranked = rankFoods(
      [
        { id: 'noodles', nameDe: 'Eiernudeln', kind: 'generic' as const, countryCode: 'DE' },
        { id: 'salad', nameDe: 'Eiersalat', kind: 'recipe' as const, countryCode: 'DE' },
        { id: 'cooked', nameDe: 'Eier gekocht', kind: 'generic' as const, countryCode: 'DE' },
        { id: 'egg', nameDe: 'Hühnerei', aliases: ['Ei'], kind: 'generic' as const, countryCode: 'DE' },
      ],
      'eier',
    )
    expect(ranked.map((food) => food.id)).toEqual(['egg', 'cooked', 'noodles', 'salad'])
  })

  it('supports conservative singular/plural variants', () => {
    const ranked = rankFoods(
      [
        { id: 'juice', nameDe: 'Apfelsaft', kind: 'generic' as const },
        { id: 'apple', nameDe: 'Apfel', kind: 'generic' as const },
      ],
      'Äpfel',
    )
    expect(ranked[0]?.id).toBe('apple')
  })
})
