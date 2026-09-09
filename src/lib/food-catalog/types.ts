export type CatalogSource = 'bls' | 'usda' | 'open_food_facts' | 'manual'
export type FoodKind = 'generic' | 'branded' | 'recipe'
export type CatalogBasisUnit = 'g' | 'ml'
export type NutrientValueStatus =
  'measured' | 'declared' | 'calculated' | 'estimated' | 'trace' | 'below_limit' | 'logical_zero' | 'unknown'

export type NutrientObservationRole = 'primary' | 'declared' | 'reference'

export interface NutrientObservation {
  nutrientKey: string
  value: number | null
  unit: string
  basisAmount: number
  basisUnit: CatalogBasisUnit
  source: CatalogSource
  sourceRecordId: string
  role: NutrientObservationRole
  valueStatus: NutrientValueStatus
  confidence: number
  provenance: string | null
  sourceUpdatedAt?: string | null
}

export interface NutrientInheritanceRule {
  nutrientKey: string
  allowed: boolean
  confidence: number
  stateMatches: boolean
  definitionMatches: boolean
  reason: string
}

export interface CanonicalNutrient {
  nutrientKey: string
  value: number | null
  unit: string
  basisAmount: number
  basisUnit: CatalogBasisUnit
  source: CatalogSource
  sourceRecordId: string
  derivation: 'direct' | 'inherited_reference'
  valueStatus: NutrientValueStatus
  confidence: number
  provenance: string | null
}

export interface FoodIdentity {
  id: string
  nameDe: string
  nameEn?: string | null
  normalizedName: string
  aliases?: string[]
  brand?: string | null
  manufacturer?: string | null
  gtin?: string | null
  kind: FoodKind
  preparationState: string
  countryCode?: string | null
  category?: string | null
}

export interface FoodCandidate extends FoodIdentity {
  source: CatalogSource
  sourceRecordId: string
  nutrients: NutrientObservation[]
  portions?: FoodPortionCandidate[]
  sourceUpdatedAt?: string | null
  rawPayload?: Record<string, unknown>
}

export interface FoodIdentityMapping {
  left: { source: CatalogSource; sourceRecordId: string }
  right: { source: CatalogSource; sourceRecordId: string }
  method: 'normalized_identity' | 'manual' | 'model_assisted'
  confidence: number
  stateMatches: boolean
  definitionMatches: boolean
  manuallyVerified: boolean
  reason: string
}

export interface FoodPortionCandidate {
  labelDe: string
  amount: number
  unit: CatalogBasisUnit | 'piece'
  grams?: number | null
  confidence: number
}

export interface SelectedNutrientsResult {
  nutrients: CanonicalNutrient[]
  rejectedReferenceNutrients: string[]
  conflictingNutrients: string[]
}

export interface NutrientCoverage {
  total: number
  known: number
  percentage: number
  byGroup: Record<string, { total: number; known: number; percentage: number }>
}
