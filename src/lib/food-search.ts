import type { FoodPreparationState, FoodSource } from '../types'

export interface FoodPortion {
  label: string
  amount: number
  unit: 'g' | 'ml' | 'piece'
  grams: number | null
}

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
  source: FoodSource
  dataType?: string
  matchQuery?: string
  preparationState: FoodPreparationState
  portions: FoodPortion[]
}

interface OpenFoodFactsProduct {
  code?: string
  product_name?: string
  product_name_de?: string
  brands?: string | string[]
  quantity?: string
  product_quantity_unit?: string
  serving_size?: string
  serving_quantity?: number
  serving_quantity_unit?: string
  nutriments?: Record<string, unknown>
  source?: 'open_food_facts' | 'usda'
  data_type?: string
  search_match?: string
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
  niacin: { aliases: ['vitamin-b3', 'niacin'], unit: 'mg' },
  vitamin_b6: { aliases: ['vitamin-b6'], unit: 'mg' },
  pantothenic_acid: { aliases: ['vitamin-b5', 'pantothenic-acid', 'pantothenic acid'], unit: 'mg' },
  biotin: { aliases: ['vitamin-b7', 'biotin'], unit: 'µg' },
  folate: { aliases: ['vitamin-b9', 'folates', 'folate'], unit: 'µg' },
  vitamin_b12: { aliases: ['vitamin-b12'], unit: 'µg' },
  calcium: { aliases: ['calcium'], unit: 'mg' },
  magnesium: { aliases: ['magnesium'], unit: 'mg' },
  phosphorus: { aliases: ['phosphorus', 'phosphor'], unit: 'mg' },
  iron: { aliases: ['iron'], unit: 'mg' },
  zinc: { aliases: ['zinc'], unit: 'mg' },
  copper: { aliases: ['copper'], unit: 'mg' },
  manganese: { aliases: ['manganese'], unit: 'mg' },
  sodium: { aliases: ['sodium'], unit: 'mg' },
  iodine: { aliases: ['iodine'], unit: 'µg' },
  selenium: { aliases: ['selenium'], unit: 'µg' },
  potassium: { aliases: ['potassium'], unit: 'mg' },
}

export async function searchFoods(query: string, signal?: AbortSignal): Promise<FoodSearchResult[]> {
  const normalizedQuery = query.trim()
  if (normalizedQuery.length < 2) return []

  const params = new URLSearchParams({ q: normalizedQuery })
  const response = await fetch(`/api/foods?${params}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) {
    const message = await response.json().then((body) => body?.error).catch(() => null)
    throw new Error(message || 'Die Lebensmittelsuche ist gerade nicht erreichbar.')
  }

  const data = await response.json() as OpenFoodFactsResponse
  const products = (data.products ?? []).flatMap((product) => {
    const normalized = normalizeProduct(product)
    return normalized ? [normalized] : []
  })
  const needle = normalizedQuery.toLocaleLowerCase('de-DE')
  return products.sort((a, b) => relevanceScore(b, needle) - relevanceScore(a, needle))
}

function normalizeProduct(product: OpenFoodFactsProduct): FoodSearchResult | null {
  const nutrients = product.nutriments ?? {}
  const name = cleanText(product.product_name_de) || cleanText(product.product_name)
  const unit = nutritionBasis(product)
  const calories = numberFrom(nutrients[`energy-kcal_100${unit}`])
  if (!name || calories === null) return null

  const micronutrientsPer100 = Object.fromEntries(
    Object.entries(micronutrientFields).flatMap(([key, definition]) => {
      const value = readNutrient(nutrients, definition.aliases, definition.unit, unit)
      return value === null ? [] : [[key, value]]
    }),
  )

  return {
    id: product.code || `${name}-${cleanBrand(product.brands)}`,
    name,
    brand: cleanBrand(product.brands),
    unit,
    caloriesPer100: calories,
    proteinPer100: numberFrom(nutrients[`proteins_100${unit}`]) ?? 0,
    carbsPer100: numberFrom(nutrients[`carbohydrates_100${unit}`]) ?? 0,
    fatPer100: numberFrom(nutrients[`fat_100${unit}`]) ?? 0,
    micronutrientsPer100,
    source: product.source === 'usda' ? 'usda' : 'open_food_facts',
    dataType: cleanText(product.data_type) || undefined,
    matchQuery: cleanText(product.search_match) || undefined,
    preparationState: inferPreparationState(name),
    portions: getPortionOptions(name, product, unit),
  }
}

function readNutrient(
  nutrients: Record<string, unknown>,
  aliases: string[],
  targetUnit: 'mg' | 'µg',
  basisUnit: 'g' | 'ml',
) {
  for (const alias of aliases) {
    const value = numberFrom(nutrients[`${alias}_100${basisUnit}`])
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

function cleanBrand(value: unknown) {
  const brands = Array.isArray(value) ? value : [value]
  return Array.from(new Set(brands.map(cleanText).filter(Boolean))).join(', ')
}

function relevanceScore(product: FoodSearchResult, needle: string) {
  const query = normalizeForSearch(needle)
  const name = normalizeForSearch(product.name)
  const brand = normalizeForSearch(product.brand)
  const queryTokens = tokenize(query)
  const nameTokens = tokenize(name)
  const nutrientBonus = Object.keys(product.micronutrientsPer100).length * 4
  let score = 0

  if (name === query) score = 1000
  else if (name.startsWith(query)) score = 790
  else if (queryTokens.length > 0 && queryTokens.every((token) => nameTokens.includes(token))) score = 680
  else if (name.includes(query)) score = 500
  else if (brand === query) score = 380
  else if (brand.startsWith(query)) score = 320
  else if (brand.includes(query)) score = 260

  if (isCompositeFood(product.name) && name !== query) score -= 230
  if (name === query && product.brand && Object.keys(product.micronutrientsPer100).length === 0) score -= 180
  if (product.preparationState !== 'unknown' && !query.includes(product.preparationState)) score += 25
  if (product.dataType === 'Foundation') score += 110
  else if (product.dataType === 'SR Legacy') score += 85
  else if (product.dataType === 'Survey (FNDDS)') score += 45
  if (product.source === 'usda' && (!product.brand || product.brand === 'USDA FoodData Central')) score += 180
  return score + nutrientBonus
}

function isLiquid(product: OpenFoodFactsProduct) {
  const unit = cleanText(product.product_quantity_unit).toLowerCase()
  const quantity = cleanText(product.quantity).toLowerCase()
  return unit === 'ml' || unit === 'cl' || unit === 'l' || /\b(ml|cl|l)\b/.test(quantity)
}

function nutritionBasis(product: OpenFoodFactsProduct): 'g' | 'ml' {
  if (!isLiquid(product)) return 'g'
  return numberFrom(product.nutriments?.['energy-kcal_100ml']) !== null ? 'ml' : 'g'
}

function normalizeForSearch(value: string) {
  return value
    .toLocaleLowerCase('de-DE')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function tokenize(value: string) {
  return value ? value.split(' ') : []
}

function isCompositeFood(name: string) {
  return /\b(mit|with|und|and|sauce|sosse|soße|toast|pancake|pfannkuchen|pudding|salat|salad|rezept|recipe|gericht|meal|pizza|riegel|bar|müsli|muesli|cereal|mix|mixture|flavour|flavor|geschmack)\b/i.test(name)
}

function inferPreparationState(name: string): FoodPreparationState {
  if (/\b(gekocht|cooked|boiled|steamed|gedämpft|prepared|zubereitet)\b/i.test(name)) return 'cooked'
  if (/\b(trocken|dry|dehydrated)\b/i.test(name)) return 'dry'
  if (/\b(roh|raw|ungekocht|uncooked|fresh)\b/i.test(name)) return 'raw'
  if (/\b(gebacken|baked|fried|gebraten)\b/i.test(name)) return 'prepared'
  return 'unknown'
}

function getPortionOptions(name: string, product: OpenFoodFactsProduct, unit: 'g' | 'ml'): FoodPortion[] {
  const options: FoodPortion[] = []
  const serving = parseServingSize(product)
  if (serving && serving.unit === unit) {
    options.push({
      label: `Portion (${formatPortionNumber(serving.amount)} ${serving.unit})`,
      amount: serving.amount,
      unit: serving.unit,
      grams: serving.unit === 'g' ? serving.amount : null,
    })
  }

  const common = commonPortions.find(({ pattern }) => pattern.test(name))?.options ?? []
  for (const option of common) {
    if (!options.some((current) => current.label === option.label)) options.push(option)
  }
  return options
}

function parseServingSize(product: OpenFoodFactsProduct): { amount: number; unit: 'g' | 'ml' } | null {
  const explicitAmount = numberFrom(product.serving_quantity)
  const explicitUnit = normalizeServingUnit(product.serving_quantity_unit)
  if (explicitAmount !== null && explicitUnit) {
    return { amount: explicitAmount * explicitUnit.factor, unit: explicitUnit.unit }
  }

  const text = cleanText(product.serving_size)
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l)\b/i)
  if (!match) return null
  const amount = numberFrom(match[1].replace(',', '.'))
  const parsedUnit = normalizeServingUnit(match[2])
  return amount !== null && parsedUnit
    ? { amount: amount * parsedUnit.factor, unit: parsedUnit.unit }
    : null
}

function normalizeServingUnit(value: unknown): { unit: 'g' | 'ml'; factor: number } | null {
  const normalized = cleanText(value).toLowerCase()
  if (normalized === 'g' || normalized === 'gram' || normalized === 'grams') return { unit: 'g', factor: 1 }
  if (normalized === 'kg' || normalized === 'kilogram' || normalized === 'kilograms') return { unit: 'g', factor: 1_000 }
  if (normalized === 'ml' || normalized === 'milliliter' || normalized === 'milliliters') return { unit: 'ml', factor: 1 }
  if (normalized === 'cl') return { unit: 'ml', factor: 10 }
  if (normalized === 'l' || normalized === 'liter' || normalized === 'liters') return { unit: 'ml', factor: 1_000 }
  return null
}

const commonPortions: Array<{ pattern: RegExp; options: FoodPortion[] }> = [
  { pattern: /\b(apfel|apple)\b/i, options: [
    { label: '1 kleiner Apfel', amount: 1, unit: 'piece', grams: 120 },
    { label: '1 mittelgroßer Apfel', amount: 1, unit: 'piece', grams: 182 },
    { label: '1 großer Apfel', amount: 1, unit: 'piece', grams: 250 },
  ] },
  { pattern: /\b(banane|banana)\b/i, options: [
    { label: '1 kleine Banane', amount: 1, unit: 'piece', grams: 80 },
    { label: '1 mittelgroße Banane', amount: 1, unit: 'piece', grams: 118 },
    { label: '1 große Banane', amount: 1, unit: 'piece', grams: 136 },
  ] },
  { pattern: /\b(ei|eier|egg|eggs)\b/i, options: [
    { label: '1 Ei', amount: 1, unit: 'piece', grams: 50 },
  ] },
]

function formatPortionNumber(value: number) {
  return String(Math.round(value * 10) / 10)
}
