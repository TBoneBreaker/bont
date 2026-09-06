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
          brands: 'Beispiel',
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
})
