import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchFoods } from './food-search'

describe('searchFoods', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('normalizes Open Food Facts values per 100 grams', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        products: [{
          code: '123',
          product_name_de: 'Natur Skyr',
          brands: ['Beispiel', ' Beispiel '],
          nutriments: {
            'energy-kcal_100g': 63,
            proteins_100g: 11,
            carbohydrates_100g: 4,
            fat_100g: 0.2,
            calcium_100g: 0.12,
            calcium_unit: 'g',
          },
        }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchFoods('Skyr')).resolves.toEqual([expect.objectContaining({
      id: '123',
      name: 'Natur Skyr',
      brand: 'Beispiel',
      caloriesPer100: 63,
      proteinPer100: 11,
      micronutrientsPer100: { calcium: 120 },
    })])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/foods?q=Skyr')
  })

  it('drops products without a name or calorie value', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ products: [{ product_name: 'Ohne Werte', nutriments: {} }] }),
    }))

    await expect(searchFoods('test')).resolves.toEqual([])
  })

  it('shows array-based brands and ranks name matches above brand-only matches', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ products: [
        { code: '1', product_name: 'Compote', brands: ['Skyr'], nutriments: { 'energy-kcal_100g': 65 } },
        { code: '2', product_name: 'Skyr Natur', brands: ['K-Classic'], nutriments: { 'energy-kcal_100g': 64 } },
      ] }),
    }))

    const results = await searchFoods('Skyr')
    expect(results.map((product) => product.name)).toEqual(['Skyr Natur', 'Compote'])
    expect(results[0].brand).toBe('K-Classic')
  })

  it('normalizes detailed USDA micronutrients and their units', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ products: [{
        code: 'usda-123',
        product_name: 'Bananas, raw',
        brands: 'USDA FoodData Central',
        source: 'usda',
        data_type: 'Foundation',
        nutriments: {
          'energy-kcal_100g': 89,
          proteins_100g: 1.1,
          potassium_100g: 358,
          potassium_unit: 'mg',
          'vitamin-b6_100g': 0.367,
          'vitamin-b6_unit': 'mg',
        },
      }] }),
    }))

    const [result] = await searchFoods('Banane')
    expect(result).toEqual(expect.objectContaining({
      source: 'usda',
      dataType: 'Foundation',
      caloriesPer100: 89,
      micronutrientsPer100: { potassium: 358, vitamin_b6: 0.367 },
    }))
  })

  it('puts the detailed generic match before incomplete product variants', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ products: [
        { code: 'off-1', product_name_de: 'Nudeln', brands: 'Penny', source: 'open_food_facts', nutriments: { 'energy-kcal_100g': 359 } },
        { code: 'usda-1', product_name: 'Nudeln, trocken', brands: 'USDA FoodData Central', source: 'usda', search_match: 'Nudeln', nutriments: { 'energy-kcal_100g': 371, iron_100g: 3.3, iron_unit: 'mg' } },
      ] }),
    }))

    const results = await searchFoods('Nudeln')
    expect(results.map((product) => product.id)).toEqual(['usda-1', 'off-1'])
    expect(results[0].micronutrientsPer100).toEqual({ iron: 3.3 })
  })
})
