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
          niacin_100g: 0.785,
          'pantothenic-acid_100g': 0.334,
          'pantothenic-acid_unit': 'mg',
          biotin_100g: 5,
          biotin_unit: 'µg',
          phosphorus_100g: 22,
          copper_100g: 0.078,
          manganese_100g: 0.27,
          sodium_100g: 1,
        },
      }] }),
    }))

    const [result] = await searchFoods('Banane')
    expect(result).toEqual(expect.objectContaining({
      source: 'usda',
      dataType: 'Foundation',
      caloriesPer100: 89,
      micronutrientsPer100: {
        potassium: 358,
        vitamin_b6: 0.367,
        niacin: 0.785,
        pantothenic_acid: 0.334,
        biotin: 5,
        phosphorus: 22,
        copper: 0.078,
        manganese: 0.27,
        sodium: 1,
      },
    }))
  })

  it('uses the source nutrition basis for liquids instead of mixing milliliters and grams', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ products: [{
        code: 'milk-ml',
        product_name: 'Milch',
        product_quantity_unit: 'ml',
        nutriments: {
          'energy-kcal_100ml': 46,
          proteins_100ml: 3.4,
          calcium_100ml: 120,
          calcium_unit: 'mg',
        },
      }] }),
    }))

    await expect(searchFoods('Milch')).resolves.toEqual([expect.objectContaining({
      unit: 'ml',
      caloriesPer100: 46,
      proteinPer100: 3.4,
      micronutrientsPer100: { calcium: 120 },
    })])
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

  it('ranks a direct product name above a composed USDA result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ products: [
        { code: 'usda-toast', product_name: 'Nutella Toast', brands: 'USDA FoodData Central', source: 'usda', search_match: 'Nutella', nutriments: { 'energy-kcal_100g': 280 } },
        { code: 'off-nutella', product_name: 'Nutella', brands: 'Ferrero', nutriments: { 'energy-kcal_100g': 539 } },
      ] }),
    }))

    const results = await searchFoods('Nutella')
    expect(results.map((product) => product.id)).toEqual(['off-nutella', 'usda-toast'])
  })

  it('exposes preparation state and natural piece portions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ products: [{
        code: 'banana-raw',
        product_name_de: 'Banane, roh',
        nutriments: { 'energy-kcal_100g': 89 },
      }] }),
    }))

    const [result] = await searchFoods('Banane')
    expect(result.preparationState).toBe('raw')
    expect(result.portions).toContainEqual(expect.objectContaining({ label: '1 mittelgroße Banane', grams: 118, unit: 'piece' }))
  })
})
