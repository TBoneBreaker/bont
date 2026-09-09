import type {
  CanonicalNutrient,
  CatalogSource,
  FoodKind,
  NutrientInheritanceRule,
  NutrientObservation,
  SelectedNutrientsResult,
} from './types.ts'

export const REFERENCE_INHERITANCE_THRESHOLD = 0.9

const genericSourcePriority: Record<CatalogSource, number> = {
  manual: 50,
  bls: 40,
  usda: 30,
  open_food_facts: 20,
}

function directPriority(kind: FoodKind, observation: NutrientObservation) {
  if (kind === 'branded' && observation.role === 'declared') return 100
  return genericSourcePriority[observation.source]
}

function byQuality(kind: FoodKind, left: NutrientObservation, right: NutrientObservation) {
  return (
    directPriority(kind, right) - directPriority(kind, left) ||
    right.confidence - left.confidence ||
    right.sourceRecordId.localeCompare(left.sourceRecordId)
  )
}

function keyFor(observation: NutrientObservation) {
  return `${observation.nutrientKey}:${observation.basisAmount}:${observation.basisUnit}`
}

/** Selects one observation per nutrient. It intentionally contains no averaging path. */
export function selectCanonicalNutrients(
  kind: FoodKind,
  observations: NutrientObservation[],
  rules: NutrientInheritanceRule[] = [],
): SelectedNutrientsResult {
  const byNutrientAndBasis = new Map<string, NutrientObservation[]>()
  for (const observation of observations) {
    const group = byNutrientAndBasis.get(keyFor(observation)) ?? []
    group.push(observation)
    byNutrientAndBasis.set(keyFor(observation), group)
  }

  const selected: CanonicalNutrient[] = []
  const rejectedReferenceNutrients: string[] = []
  const conflictingNutrients: string[] = []

  for (const candidates of byNutrientAndBasis.values()) {
    const nutrientKey = candidates[0]?.nutrientKey
    if (!nutrientKey) continue
    const known = candidates.filter((candidate) => candidate.value !== null)
    if (known.length === 0) {
      const unknown = candidates.slice().sort((left, right) => byQuality(kind, left, right))[0]
      if (unknown) selected.push(toCanonical(unknown, 'direct'))
      continue
    }

    const direct = known.filter((candidate) => candidate.role !== 'reference')
    const directCandidates = direct.length > 0 ? direct : []
    const bestDirect = directCandidates.slice().sort((left, right) => byQuality(kind, left, right))[0]
    const directValues = new Set(directCandidates.map((candidate) => candidate.value))
    if (directValues.size > 1) conflictingNutrients.push(nutrientKey)

    if (bestDirect) {
      selected.push(toCanonical(bestDirect, 'direct'))
      continue
    }

    const rule = rules.find((candidate) => candidate.nutrientKey === nutrientKey)
    const bestReference = known
      .filter((candidate) => candidate.role === 'reference')
      .sort((left, right) => byQuality(kind, left, right))[0]
    const canInherit = Boolean(
      bestReference &&
      rule?.allowed &&
      rule.confidence >= REFERENCE_INHERITANCE_THRESHOLD &&
      rule.stateMatches &&
      rule.definitionMatches,
    )
    if (canInherit && bestReference) selected.push(toCanonical(bestReference, 'inherited_reference'))
    else if (bestReference) rejectedReferenceNutrients.push(nutrientKey)
  }

  return { nutrients: selected, rejectedReferenceNutrients, conflictingNutrients }
}

function toCanonical(observation: NutrientObservation, derivation: CanonicalNutrient['derivation']): CanonicalNutrient {
  return { ...observation, derivation }
}
