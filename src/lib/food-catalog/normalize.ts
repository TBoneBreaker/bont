import type { CatalogBasisUnit, NutrientObservation } from './types'

const germanTransliterations: Array<[string, string]> = [
  ['ä', 'a'],
  ['ö', 'o'],
  ['ü', 'u'],
  ['ß', 'ss'],
]

/** One deterministic form is shared by database imports and client search. */
export function normalizeSearchText(value: string) {
  let normalized = value.trim().toLocaleLowerCase('de-DE')
  normalized = normalized.replace(/ae/g, 'ä').replace(/oe/g, 'ö').replace(/ue/g, 'ü')
  for (const [from, to] of germanTransliterations) normalized = normalized.replaceAll(from, to)
  return normalized
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** Returns a canonical GTIN-14 or null for malformed/non-checksum-valid codes. */
export function normalizeBarcode(value: unknown): string | null {
  const digits = typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\D/g, '') : ''
  if (![8, 12, 13, 14].includes(digits.length)) return null
  const padded = digits.padStart(14, '0')
  const body = padded.slice(0, -1)
  const checkDigit = Number(padded.at(-1))
  let sum = 0
  for (let index = body.length - 1; index >= 0; index -= 1) {
    const positionFromRight = body.length - index
    sum += Number(body[index]) * (positionFromRight % 2 === 1 ? 3 : 1)
  }
  return (10 - (sum % 10)) % 10 === checkDigit ? padded : null
}

const unitAliases: Record<string, string> = {
  μg: 'µg',
  mcg: 'µg',
  ug: 'µg',
  gram: 'g',
  grams: 'g',
  milligram: 'mg',
  milligrams: 'mg',
  microgram: 'µg',
  micrograms: 'µg',
  kilojoule: 'kj',
  kilojoules: 'kj',
}

/** Converts only known nutrient units. Unknown units are rejected, never guessed. */
export function convertNutrientUnit(value: number, sourceUnit: string, targetUnit: string) {
  if (!Number.isFinite(value)) throw new Error('Nährstoffwert ist nicht numerisch.')
  const source = unitAliases[sourceUnit.trim().toLowerCase()] ?? sourceUnit.trim().toLowerCase()
  const target = unitAliases[targetUnit.trim().toLowerCase()] ?? targetUnit.trim().toLowerCase()
  if (source === target) return value
  if (source === 'kj' && target === 'kcal') return value / 4.184
  if (source === 'kcal' && target === 'kj') return value * 4.184
  const massUnits = new Set(['g', 'mg', 'µg'])
  if (!massUnits.has(source) || !massUnits.has(target)) {
    throw new Error(`Unbekannte Nährstoffeinheit: ${sourceUnit} -> ${targetUnit}`)
  }
  const toMicrograms: Record<string, number> = { g: 1_000_000, mg: 1_000, µg: 1 }
  return (value * toMicrograms[source]) / toMicrograms[target]
}

export function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

export function canonicalizeObservationUnit(observation: NutrientObservation, targetUnit: string): NutrientObservation {
  return {
    ...observation,
    value: observation.value === null ? null : convertNutrientUnit(observation.value, observation.unit, targetUnit),
    unit: targetUnit,
  }
}

export function canonicalizeBasis(value: unknown): { amount: number; unit: CatalogBasisUnit } | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { amount?: unknown; unit?: unknown }
  const amount = parseNullableNumber(candidate.amount)
  const unit = candidate.unit === 'g' || candidate.unit === 'ml' ? candidate.unit : null
  return amount !== null && amount > 0 && unit ? { amount, unit } : null
}
