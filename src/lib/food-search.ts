import type { FoodPreparationState, FoodSource, NutrientProvenanceSnapshot } from '../types'
import { normalizeSearchText } from './food-catalog/normalize'
import { rankFoods } from './food-catalog/ranking'

export interface FoodPortion {
  label: string
  amount: number
  unit: 'g' | 'ml' | 'piece'
  grams: number | null
}

export interface FoodSearchResult {
  /** Stable internal UUID, not a source ID or a display hash. */
  id: string
  name: string
  brand: string
  unit: 'g' | 'ml'
  caloriesPer100: number
  proteinPer100: number
  carbsPer100: number
  fatPer100: number
  micronutrientsPer100: Record<string, number>
  nutrientProvenance: Record<string, NutrientProvenanceSnapshot>
  source: FoodSource
  sourceRecordId: string
  nutrientCoverage: number
  kind: 'generic' | 'branded' | 'recipe'
  preparationState: FoodPreparationState
  portions: FoodPortion[]
}

interface NutrientApiValue {
  value: number | null
  unit: string
  source: FoodSource
  sourceRecordId: string
  derivation: 'direct' | 'inherited_reference'
  valueStatus: string
  provenance: string | null
}

interface CatalogSearchResponse {
  foods?: Array<{
    id?: string
    name_de?: string
    name_en?: string | null
    brand?: string | null
    kind?: FoodSearchResult['kind']
    preparation_state?: string
    basis_unit?: 'g' | 'ml'
    calories_per_100?: number | null
    protein_per_100?: number | null
    carbs_per_100?: number | null
    fat_per_100?: number | null
    source?: FoodSource | null
    source_record_id?: string | null
    nutrient_coverage?: number | null
    micronutrients?: Record<string, NutrientApiValue>
    portions?: Array<{ label?: string; amount?: number; unit?: 'g' | 'ml' | 'piece'; grams?: number | null }>
  }>
}

/** Queries the internal catalog API. External data providers are never queried from the browser. */
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
    const message = await response
      .json()
      .then((body) => body?.error)
      .catch(() => null)
    throw new Error(message || 'Die Lebensmittelsuche ist gerade nicht erreichbar.')
  }

  const data = (await response.json()) as CatalogSearchResponse
  const products = (data.foods ?? []).flatMap((food) => {
    const normalized = normalizeCatalogFood(food)
    return normalized ? [normalized] : []
  })
  return rankFoods(products, normalizeSearchText(normalizedQuery))
}

function normalizeCatalogFood(food: NonNullable<CatalogSearchResponse['foods']>[number]): FoodSearchResult | null {
  const name = cleanText(food.name_de) || cleanText(food.name_en)
  const source = food.source ?? null
  const basisUnit = food.basis_unit === 'ml' ? 'ml' : 'g'
  if (
    !name ||
    !cleanText(food.id) ||
    !source ||
    !cleanText(food.source_record_id) ||
    !isFoodKind(food.kind) ||
    !isPreparationState(food.preparation_state) ||
    !isFiniteNonNegative(food.calories_per_100) ||
    !isFiniteNonNegative(food.protein_per_100) ||
    !isFiniteNonNegative(food.carbs_per_100) ||
    !isFiniteNonNegative(food.fat_per_100)
  ) {
    // A food without mandatory energy/macros cannot be written to the current
    // user snapshot without turning unknown into a fake zero.
    return null
  }

  const micronutrientsPer100: Record<string, number> = {}
  const nutrientProvenance: Record<string, NutrientProvenanceSnapshot> = {}
  for (const [key, nutrient] of Object.entries(food.micronutrients ?? {})) {
    if (!isFiniteNonNegative(nutrient.value)) continue
    micronutrientsPer100[key] = nutrient.value
    nutrientProvenance[key] = {
      source: nutrient.source,
      source_record_id: nutrient.sourceRecordId,
      derivation: nutrient.derivation,
      value_status: nutrient.valueStatus,
      provenance: nutrient.provenance,
    }
  }

  return {
    id: food.id as string,
    name,
    brand: cleanText(food.brand),
    unit: basisUnit,
    caloriesPer100: food.calories_per_100 as number,
    proteinPer100: food.protein_per_100 as number,
    carbsPer100: food.carbs_per_100 as number,
    fatPer100: food.fat_per_100 as number,
    micronutrientsPer100,
    nutrientProvenance,
    source,
    sourceRecordId: food.source_record_id as string,
    nutrientCoverage: Math.max(0, Number(food.nutrient_coverage ?? 0)),
    kind: food.kind as FoodSearchResult['kind'],
    preparationState: food.preparation_state as FoodPreparationState,
    portions: normalizePortions(food.portions),
  }
}

function normalizePortions(portions: NonNullable<CatalogSearchResponse['foods']>[number]['portions']) {
  return (portions ?? []).flatMap((portion) => {
    if (!cleanText(portion.label) || !isFinitePositive(portion.amount) || !portion.unit) return []
    return [
      {
        label: portion.label as string,
        amount: portion.amount as number,
        unit: portion.unit,
        grams: isFinitePositive(portion.grams) ? (portion.grams as number) : null,
      },
    ]
  })
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isFinitePositive(value: unknown): value is number {
  return isFiniteNonNegative(value) && value > 0
}

function isFoodKind(value: unknown): value is FoodSearchResult['kind'] {
  return value === 'generic' || value === 'branded' || value === 'recipe'
}

function isPreparationState(value: unknown): value is FoodPreparationState {
  return (
    value === 'raw' ||
    value === 'cooked' ||
    value === 'fried' ||
    value === 'steamed' ||
    value === 'baked' ||
    value === 'dry' ||
    value === 'dried' ||
    value === 'frozen' ||
    value === 'drained' ||
    value === 'prepared' ||
    value === 'uncooked' ||
    value === 'unknown'
  )
}
