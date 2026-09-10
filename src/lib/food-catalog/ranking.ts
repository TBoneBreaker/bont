import { foodSearchVariants, normalizeSearchText } from './normalize.ts'
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
  category?: string | null
  nutrientCoverage?: number
}

const preparationWords = new Set([
  'roh',
  'raw',
  'frisch',
  'fresh',
  'gekocht',
  'cooked',
  'gebraten',
  'fried',
  'gebacken',
  'baked',
  'geduenstet',
  'gedampft',
  'getrocknet',
  'dried',
  'trocken',
  'dry',
])

function tokenized(value: string) {
  return normalizeSearchText(value).split(' ').filter(Boolean)
}

function compoundPenalty(tokens: string[], variants: string[]) {
  if (tokens.length <= 1) return 0
  const firstIsQuery = variants.includes(tokens[0] ?? '')
  if (!firstIsQuery) return tokens.some((token) => variants.includes(token)) ? 160 : 0
  const nonPreparationTokens = tokens.slice(1).filter((token) => !preparationWords.has(token))
  return nonPreparationTokens.length * 130 + Math.max(0, tokens.length - 2) * 20
}

export function scoreFood(food: SearchableFood, rawQuery: string) {
  const query = normalizeSearchText(rawQuery)
  const variants = foodSearchVariants(query)
  const names = [food.nameDe ?? food.name ?? '', food.nameEn ?? '', ...(food.aliases ?? [])]
    .map(normalizeSearchText)
    .filter(Boolean)
  const brand = normalizeSearchText(food.brand ?? '')
  const primaryName = normalizeSearchText(food.nameDe ?? food.name ?? '')
  const primaryTokens = tokenized(primaryName)
  const aliasNames = names.slice(1)
  let score = 0
  if (variants.includes(primaryName)) score += 1_600
  else if (aliasNames.some((name) => variants.includes(name))) score += 1_500
  else if (primaryTokens.length > 0 && variants.includes(primaryTokens[0] ?? '')) score += 1_260
  else if (primaryTokens.some((token) => variants.includes(token))) score += 980
  else if (names.some((name) => variants.some((variant) => name.startsWith(variant)))) score += 760
  else if (names.some((name) => variants.some((variant) => name.includes(variant)))) score += 420
  else if (variants.includes(brand)) score += 900
  else if (variants.some((variant) => brand.startsWith(variant))) score += 350
  else if (variants.some((variant) => brand.includes(variant))) score += 250
  score -= compoundPenalty(primaryTokens, variants)
  if (food.countryCode?.toUpperCase() === 'DE') score += 60
  if (food.kind === 'branded') score += 15
  if (food.kind === 'recipe') score -= 330
  if (food.preparationState && preparationWords.has(normalizeSearchText(food.preparationState))) score += 15
  score += Math.min(100, Math.max(0, food.nutrientCoverage ?? 0))
  return score
}

export function rankFoods<T extends SearchableFood>(foods: T[], query: string) {
  return foods
    .map((food, index) => ({ food, index, score: scoreFood(food, query) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ food }) => food)
}
