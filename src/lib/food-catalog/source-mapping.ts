import { normalizeFoodIdentity, normalizeSearchText } from './normalize.ts'
import type { FoodCandidate, FoodIdentityMapping } from './types.ts'

// Deliberately small and auditable. Cross-source linking only happens when
// every meaningful token can be mapped deterministically; fuzzy similarity is
// never used to inherit a nutrient value.
const englishFoodTokens: Record<string, string> = {
  apple: 'apfel',
  apples: 'apfel',
  banana: 'banane',
  bananas: 'banane',
  beef: 'rind',
  bread: 'brot',
  carrot: 'karotte',
  carrots: 'karotte',
  cheese: 'kaese',
  chicken: 'huhn',
  cucumber: 'gurke',
  egg: 'ei',
  eggs: 'ei',
  flour: 'mehl',
  gouda: 'gouda',
  milk: 'milch',
  noodle: 'nudel',
  noodles: 'nudel',
  oat: 'hafer',
  oats: 'hafer',
  oatmeal: 'haferflocken',
  onion: 'zwiebel',
  onions: 'zwiebel',
  pasta: 'nudel',
  pear: 'birne',
  potato: 'kartoffel',
  potatoes: 'kartoffel',
  rice: 'reis',
  salmon: 'lachs',
  skyr: 'skyr',
  tomato: 'tomate',
  tomatoes: 'tomate',
  tuna: 'thunfisch',
  turkey: 'truthahn',
  yogurt: 'joghurt',
  yoghurt: 'joghurt',
}

const germanFoodTokens: Record<string, string> = {
  aepfel: 'apfel',
  eier: 'ei',
  kartoffeln: 'kartoffel',
  nudeln: 'nudel',
  tomaten: 'tomate',
}

const nonDefiningTokens = new Set(['a', 'an', 'and', 'or', 'of', 'the', 'with', 'without', 'in', 'im', 'mit', 'und', 'oder'])

export function buildSafeCrossSourceMappings(candidates: FoodCandidate[]): FoodIdentityMapping[] {
  const index = new Map<string, FoodCandidate[]>()
  for (const candidate of candidates) {
    if (!isEligible(candidate)) continue
    const key = safeIdentityKey(candidate)
    if (!key) continue
    const values = index.get(key) ?? []
    values.push(candidate)
    index.set(key, values)
  }

  const mappings: FoodIdentityMapping[] = []
  for (const group of index.values()) {
    const bls = group.filter((candidate) => candidate.source === 'bls')
    const usda = group.filter((candidate) => candidate.source === 'usda')
    if (bls.length !== 1 || usda.length !== 1) continue
    const left = bls[0]
    const right = usda[0]
    if (!left || !right || left.preparationState !== right.preparationState) continue
    mappings.push({
      left: { source: left.source, sourceRecordId: left.sourceRecordId },
      right: { source: right.source, sourceRecordId: right.sourceRecordId },
      method: 'normalized_identity',
      confidence: 0.94,
      stateMatches: true,
      definitionMatches: true,
      manuallyVerified: false,
      reason: `Exact token identity after conservative DE/EN normalization: ${safeIdentityKey(left)}.`,
    })
  }
  return mappings
}

export function safeIdentityKey(candidate: FoodCandidate) {
  if (!isEligible(candidate)) return null
  const base = normalizeFoodIdentity(candidate.nameDe)
  const tokens = base
    .split(' ')
    .map((token) => englishFoodTokens[token] ?? germanFoodTokens[token] ?? token)
    .filter((token) => token && !nonDefiningTokens.has(token))
  return tokens.length > 0 ? `${tokens.join(' ')}|${candidate.preparationState}` : null
}

function isEligible(candidate: FoodCandidate) {
  return (
    candidate.kind === 'generic' &&
    (candidate.source === 'bls' || candidate.source === 'usda') &&
    candidate.nameDe.trim().length > 0 &&
    normalizeSearchText(candidate.nameDe).split(' ').filter(Boolean).length <= 8
  )
}
