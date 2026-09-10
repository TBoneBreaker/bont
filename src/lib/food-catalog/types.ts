import type { QualityFlag } from './quality.ts'

export type CatalogSource = 'bls' | 'usda' | 'open_food_facts' | 'manual'
export type FoodKind = 'generic' | 'branded' | 'recipe'
export type CatalogBasisUnit = 'g' | 'ml'
export type NutrientValueStatus =
  'measured' | 'declared' | 'calculated' | 'estimated' | 'trace' | 'below_limit' | 'logical_zero' | 'unknown'

export type NutrientObservationRole = 'primary' | 'declared' | 'reference'
export type PortionType =
  | 'whole_fruit'
  | 'whole_vegetable'
  | 'egg'
  | 'bread_slice'
  | 'toast_slice'
  | 'crispbread'
  | 'cheese_slice'
  | 'deli_slice'
  | 'bar'
  | 'cup'
  | 'package'
  | 'can'
  | 'bottle'
  | 'spoonable'
  | 'tortilla'
  | 'roll'
  | 'piece'
  | 'serving'

export type PortionExactness = 'exact' | 'estimated'

export interface NutrientDefinitionMetadata {
  canonicalKey: string
  nameDe: string
  nameEn: string | null
  unit: string
  nutrientGroup: string
  sourceMappings: Record<string, unknown>
}

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
  definition?: NutrientDefinitionMetadata
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
  definition?: NutrientDefinitionMetadata
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
  qualityFlags?: QualityFlag[]
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
  portionType?: PortionType
  exactness?: PortionExactness
  source?: CatalogSource
  sourceRecordId?: string
  isDefault?: boolean
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
