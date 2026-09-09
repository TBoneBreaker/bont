import { normalizeSearchText } from './normalize.ts'
import type { FoodKind } from './types.ts'

export interface SearchableFood {
  id: string
  nameDe?: string
  name?: string
  nameEn?: string | null
  aliases?: string[]
  brand?: string | null
  kind: FoodKind
  countryCode?: string | null
  preparationState?: string | null
  nutrientCoverage?: number
}

function hasExactOrPrefix(values: string[], query: string) {
  return values.some((value) => value === query || value.startsWith(query))
}

export function scoreFood(food: SearchableFood, rawQuery: string) {
  const query = normalizeSearchText(rawQuery)
  const names = [food.nameDe ?? food.name ?? '', food.nameEn ?? '', ...(food.aliases ?? [])]
    .map(normalizeSearchText)
    .filter(Boolean)
  const brand = normalizeSearchText(food.brand ?? '')
  let score = 0
  if (names.includes(query)) score += 1_000
  else if (names.some((name) => name.startsWith(query))) score += 800
  else if (names.some((name) => name.includes(query))) score += 500
  else if (brand === query) score += 450
  else if (brand.startsWith(query)) score += 350
  else if (brand.includes(query)) score += 250
  if (food.countryCode?.toUpperCase() === 'DE') score += 60
  if (food.kind === 'branded' && brand && hasExactOrPrefix([brand], query)) score += 45
  if (food.kind === 'recipe') score -= 350
  score += Math.min(100, Math.max(0, food.nutrientCoverage ?? 0))
  return score
}

export function rankFoods<T extends SearchableFood>(foods: T[], query: string) {
  return foods
    .map((food, index) => ({ food, index, score: scoreFood(food, query) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ food }) => food)
}
