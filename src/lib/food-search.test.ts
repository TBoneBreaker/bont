import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchFoods } from './food-search'

const sourceValue = (value: number | null, source: 'bls' | 'open_food_facts' = 'bls') => ({
  value,
  unit: 'mg',
  source,
  sourceRecordId: `${source}-record`,
  derivation: 'direct',
  valueStatus: 'measured',
  provenance: 'laboratory',
})

describe('searchFoods', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads canonical foods from the internal API and preserves nutrient provenance', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        foods: [{
          id: 'food-uuid',
          name_de: 'Natur-Skyr',
          brand: 'Beispiel',
          kind: 'branded',
          preparation_state: 'unknown',
          basis_unit: 'g',
          calories_per_100: 63,
          protein_per_100: 11,
          carbs_per_100: 4,
          fat_per_100: 0.2,
          source: 'open_food_facts',
          source_record_id: 'off-123',
          nutrient_coverage: 70,
          micronutrients: { calcium: sourceValue(120, 'bls') },
          portions: [{ label: '1 Becher', amount: 150, unit: 'g', grams: 150 }],
        }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchFoods('Skyr')).resolves.toEqual([expect.objectContaining({
      id: 'food-uuid',
      name: 'Natur-Skyr',
      source: 'open_food_facts',
      sourceRecordId: 'off-123',
      caloriesPer100: 63,
      micronutrientsPer100: { calcium: 120 },
      nutrientProvenance: { calcium: expect.objectContaining({ source: 'bls' }) },
      portions: [{ label: '1 Becher', amount: 150, unit: 'g', grams: 150 }],
    })])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/foods?q=Skyr')
  })

  it('drops catalog rows with missing mandatory macros instead of converting unknown to zero', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ foods: [{
        id: 'food-uuid',
        name_de: 'Unvollständig',
        kind: 'generic',
        preparation_state: 'raw',
        source: 'bls',
        source_record_id: 'bls-1',
        calories_per_100: 10,
        protein_per_100: null,
        carbs_per_100: 2,
        fat_per_100: 1,
      }] }),
    }))

    await expect(searchFoods('test')).resolves.toEqual([])
  })

  it('ranks exact German name before brand-only results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ foods: [
        {
          id: 'brand', name_de: 'Joghurt Natur', brand: 'Skyr', kind: 'branded', preparation_state: 'unknown',
          basis_unit: 'g', calories_per_100: 60, protein_per_100: 10, carbs_per_100: 4, fat_per_100: 1,
          source: 'open_food_facts', source_record_id: 'off-1',
        },
        {
          id: 'generic', name_de: 'Skyr', kind: 'generic', preparation_state: 'raw',
          basis_unit: 'g', calories_per_100: 62, protein_per_100: 11, carbs_per_100: 3, fat_per_100: 0.2,
          source: 'bls', source_record_id: 'bls-1', country_code: 'DE',
        },
      ] }),
    }))

    const results = await searchFoods('Skyr')
    expect(results.map((product) => product.id)).toEqual(['generic', 'brand'])
  })

  it('keeps explicit zero micronutrients while omitting unknown values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ foods: [{
        id: 'food-uuid', name_de: 'Lebensmittel', kind: 'generic', preparation_state: 'raw', basis_unit: 'g',
        calories_per_100: 10, protein_per_100: 1, carbs_per_100: 2, fat_per_100: 0,
        source: 'bls', source_record_id: 'bls-1',
        micronutrients: {
          sodium: sourceValue(0, 'bls'),
          iron: { ...sourceValue(null, 'bls'), value: null },
        },
      }] }),
    }))

    const [result] = await searchFoods('Lebensmittel')
    expect(result.micronutrientsPer100).toEqual({ sodium: 0 })
    expect(result.nutrientProvenance).toHaveProperty('sodium')
    expect(result.nutrientProvenance).not.toHaveProperty('iron')
  })
})
