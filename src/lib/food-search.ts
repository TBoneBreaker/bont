export interface FoodSearchResult {
  id: string
  name: string
  brand: string
  unit: 'g' | 'ml'
  caloriesPer100: number
  proteinPer100: number
  carbsPer100: number
  fatPer100: number
  micronutrientsPer100: Record<string, number>
}

interface OpenFoodFactsProduct {
  code?: string
  product_name?: string
  product_name_de?: string
  brands?: string
  quantity?: string
  product_quantity_unit?: string
  nutriments?: Record<string, unknown>
}

interface OpenFoodFactsResponse {
  products?: OpenFoodFactsProduct[]
}

const micronutrientFields: Record<string, { aliases: string[]; unit: 'mg' | 'µg' }> = {
  vitamin_a: { aliases: ['vitamin-a'], unit: 'µg' },
  vitamin_d: { aliases: ['vitamin-d'], unit: 'µg' },
  vitamin_e: { aliases: ['vitamin-e'], unit: 'mg' },
  vitamin_k: { aliases: ['vitamin-k'], unit: 'µg' },
  vitamin_c: { aliases: ['vitamin-c'], unit: 'mg' },
  thiamin: { aliases: ['vitamin-b1', 'thiamin'], unit: 'mg' },
  riboflavin: { aliases: ['vitamin-b2', 'riboflavin'], unit: 'mg' },
  vitamin_b6: { aliases: ['vitamin-b6'], unit: 'mg' },
  folate: { aliases: ['vitamin-b9', 'folates', 'folate'], unit: 'µg' },
  vitamin_b12: { aliases: ['vitamin-b12'], unit: 'µg' },
  calcium: { aliases: ['calcium'], unit: 'mg' },
  magnesium: { aliases: ['magnesium'], unit: 'mg' },
  iron: { aliases: ['iron'], unit: 'mg' },
  zinc: { aliases: ['zinc'], unit: 'mg' },
  iodine: { aliases: ['iodine'], unit: 'µg' },
  selenium: { aliases: ['selenium'], unit: 'µg' },
  potassium: { aliases: ['potassium'], unit: 'mg' },
}

export async function searchFoods(query: string, signal?: AbortSignal): Promise<FoodSearchResult[]> {
  const normalizedQuery = query.trim()
  if (normalizedQuery.length < 2) return []

  const params = new URLSearchParams({
    search_terms: normalizedQuery,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '12',
    lc: 'de',
    cc: 'de',
    fields: 'code,product_name,product_name_de,brands,quantity,product_quantity_unit,nutriments',
  })
  const response = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?${params}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) throw new Error('Die Lebensmittelsuche ist gerade nicht erreichbar.')

  const data = await response.json() as OpenFoodFactsResponse
  return (data.products ?? []).flatMap((product) => {
    const normalized = normalizeProduct(product)
    return normalized ? [normalized] : []
  })
}

function normalizeProduct(product: OpenFoodFactsProduct): FoodSearchResult | null {
  const nutrients = product.nutriments ?? {}
  const name = cleanText(product.product_name_de) || cleanText(product.product_name)
  const calories = numberFrom(nutrients['energy-kcal_100g'])
  if (!name || calories === null) return null

  const micronutrientsPer100 = Object.fromEntries(
    Object.entries(micronutrientFields).flatMap(([key, definition]) => {
      const value = readNutrient(nutrients, definition.aliases, definition.unit)
      return value === null ? [] : [[key, value]]
    }),
  )

  return {
    id: product.code || `${name}-${cleanText(product.brands)}`,
    name,
    brand: cleanText(product.brands),
    unit: isLiquid(product) ? 'ml' : 'g',
    caloriesPer100: calories,
    proteinPer100: numberFrom(nutrients.proteins_100g) ?? 0,
    carbsPer100: numberFrom(nutrients.carbohydrates_100g) ?? 0,
    fatPer100: numberFrom(nutrients.fat_100g) ?? 0,
    micronutrientsPer100,
  }
}

function readNutrient(
  nutrients: Record<string, unknown>,
  aliases: string[],
  targetUnit: 'mg' | 'µg',
) {
  for (const alias of aliases) {
    const value = numberFrom(nutrients[`${alias}_100g`])
    if (value === null) continue
    const sourceUnit = String(nutrients[`${alias}_unit`] ?? targetUnit).toLowerCase()
    return convertUnit(value, sourceUnit, targetUnit)
  }
  return null
}

function convertUnit(value: number, sourceUnit: string, targetUnit: 'mg' | 'µg') {
  const normalized = sourceUnit.replace('μ', 'µ').replace('mcg', 'µg').replace('ug', 'µg')
  const inMicrograms = normalized === 'g' ? value * 1_000_000 : normalized === 'mg' ? value * 1_000 : value
  return targetUnit === 'mg' ? inMicrograms / 1_000 : inMicrograms
}

function numberFrom(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isLiquid(product: OpenFoodFactsProduct) {
  const unit = cleanText(product.product_quantity_unit).toLowerCase()
  const quantity = cleanText(product.quantity).toLowerCase()
  return unit === 'ml' || unit === 'cl' || unit === 'l' || /\b(ml|cl|l)\b/.test(quantity)
}
