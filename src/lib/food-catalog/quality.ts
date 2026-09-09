import type { FoodCandidate, NutrientCoverage, NutrientObservation } from './types.ts'

const macroKeys = new Set(['protein', 'carbohydrate', 'fat', 'fiber'])
const energyKeys = new Set(['energy_kcal', 'energy-kcal', 'calories'])

export interface QualityFlag {
  code: 'negative_value' | 'macro_over_100g' | 'energy_mismatch' | 'missing_basis' | 'unknown_unit'
  severity: 'warning' | 'error'
  nutrientKey?: string
  message: string
}

export function checkNutrientPlausibility(observations: NutrientObservation[]): QualityFlag[] {
  const flags: QualityFlag[] = []
  for (const observation of observations) {
    if (observation.basisAmount <= 0) {
      flags.push({
        code: 'missing_basis',
        severity: 'error',
        nutrientKey: observation.nutrientKey,
        message: 'Bezugsmenge ist nicht positiv.',
      })
    }
    if (observation.value !== null && observation.value < 0) {
      flags.push({
        code: 'negative_value',
        severity: 'error',
        nutrientKey: observation.nutrientKey,
        message: 'Nährstoffwert ist negativ.',
      })
    }
    if (
      observation.value !== null &&
      observation.basisUnit === 'g' &&
      observation.basisAmount === 100 &&
      macroKeys.has(observation.nutrientKey) &&
      observation.value > 100
    ) {
      flags.push({
        code: 'macro_over_100g',
        severity: 'warning',
        nutrientKey: observation.nutrientKey,
        message: 'Makronährstoff überschreitet 100 g pro 100 g.',
      })
    }
  }

  const energy = observations.find((item) => energyKeys.has(item.nutrientKey) && item.value !== null)
  const sameBasis = (item: NutrientObservation) =>
    energy && item.basisAmount === energy.basisAmount && item.basisUnit === energy.basisUnit
  const protein = observations.find((item) => item.nutrientKey === 'protein' && item.value !== null && sameBasis(item))
  const carbohydrate = observations.find(
    (item) => item.nutrientKey === 'carbohydrate' && item.value !== null && sameBasis(item),
  )
  const fat = observations.find((item) => item.nutrientKey === 'fat' && item.value !== null && sameBasis(item))
  if (
    energy &&
    protein &&
    carbohydrate &&
    fat &&
    energy.value !== null &&
    protein.value !== null &&
    carbohydrate.value !== null &&
    fat.value !== null
  ) {
    const calculated = Number(protein.value) * 4 + Number(carbohydrate.value) * 4 + Number(fat.value) * 9
    if (calculated > 20 && Math.abs(calculated - Number(energy.value)) / calculated > 0.35) {
      flags.push({
        code: 'energy_mismatch',
        severity: 'warning',
        message: 'Energie passt auffällig schlecht zu Protein, Kohlenhydraten und Fett.',
      })
    }
  }
  return flags
}

export function calculateCoverage(
  observations: NutrientObservation[],
  nutrientGroups: Record<string, string> = {},
): NutrientCoverage {
  const byKey = new Map<string, NutrientObservation>()
  for (const observation of observations)
    if (!byKey.has(observation.nutrientKey)) byKey.set(observation.nutrientKey, observation)
  const groups: Record<string, { total: number; known: number; percentage: number }> = {}
  for (const [key, group] of Object.entries(nutrientGroups)) {
    const current = groups[group] ?? { total: 0, known: 0, percentage: 0 }
    current.total += 1
    const observation = byKey.get(key)
    if (observation !== undefined && observation.value !== null) current.known += 1
    current.percentage = current.total ? (current.known / current.total) * 100 : 0
    groups[group] = current
  }
  const total = Object.keys(nutrientGroups).length
  const known = Object.keys(nutrientGroups).filter((key) => {
    const observation = byKey.get(key)
    return observation !== undefined && observation.value !== null
  }).length
  return { total, known, percentage: total ? (known / total) * 100 : 0, byGroup: groups }
}

export function checkFoodCandidate(candidate: FoodCandidate) {
  return checkNutrientPlausibility(candidate.nutrients)
}
