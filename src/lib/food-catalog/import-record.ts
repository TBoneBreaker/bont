import { calculateCoverage, checkFoodCandidate, type QualityFlag } from './quality.ts'
import { selectCanonicalNutrients } from './merge.ts'
import { nutrientDefinitions } from './source-mappings.ts'
import type {
  CatalogSource,
  FoodCandidate,
  FoodIdentityMapping,
  FoodPortionCandidate,
  NutrientInheritanceRule,
} from './types.ts'

export interface CanonicalImportRecord {
  dedupeKey: string
  identity: Omit<FoodCandidate, 'nutrients' | 'source' | 'sourceRecordId' | 'portions' | 'rawPayload'>
  identitySource: CatalogSource
  sourceRecords: Array<{
    source: CatalogSource
    sourceRecordId: string
    sourceUpdatedAt?: string | null
    rawPayload: Record<string, unknown>
  }>
  identityMappings: FoodIdentityMapping[]
  nutrients: ReturnType<typeof selectCanonicalNutrients>['nutrients']
  portions: FoodPortionCandidate[]
  qualityFlags: QualityFlag[]
  nutrientCoverage: ReturnType<typeof calculateCoverage>
  rejectedReferenceNutrients: string[]
  conflictingNutrients: string[]
}

export function validateCanonicalImportRecord(record: CanonicalImportRecord) {
  const errors: string[] = []
  if (!record.dedupeKey.trim()) errors.push('dedupeKey fehlt.')
  if (!record.identity.nameDe.trim() || !record.identity.kind) errors.push('Food-Identität ist unvollständig.')
  if (record.sourceRecords.length === 0) errors.push('Mindestens ein Source-Record ist erforderlich.')
  for (const sourceRecord of record.sourceRecords) {
    if (!sourceRecord.sourceRecordId.trim()) errors.push('Source-Record-ID fehlt.')
    if (!sourceRecord.rawPayload || Array.isArray(sourceRecord.rawPayload))
      errors.push('Raw-Payload muss ein Objekt sein.')
  }
  for (const nutrient of record.nutrients) {
    if (!nutrient.nutrientKey.trim()) errors.push('Nährstoffschlüssel fehlt.')
    if (nutrient.value !== null && !Number.isFinite(nutrient.value)) errors.push('Nährstoffwert ist nicht numerisch.')
    if (!Number.isFinite(nutrient.basisAmount) || nutrient.basisAmount <= 0) errors.push('Bezugsmenge ist ungültig.')
    if (nutrient.confidence < 0 || nutrient.confidence > 1) errors.push('Nährstoff-Confidence ist ungültig.')
  }
  for (const portion of record.portions) {
    if (!portion.labelDe.trim() || portion.amount <= 0 || portion.confidence < 0 || portion.confidence > 1) {
      errors.push('Portionsdaten sind ungültig.')
    }
  }
  return errors
}

/**
 * Turns a deduplicated candidate group into the exact, provenance-preserving
 * payload consumed by the production loader. No nutrient values are averaged.
 */
export function buildCanonicalRecord(
  dedupeKey: string,
  candidates: FoodCandidate[],
  explicitMappings: FoodIdentityMapping[] = [],
): CanonicalImportRecord {
  const identity = candidates.slice().sort((left, right) => identityPriority(right) - identityPriority(left))[0]
  if (!identity) throw new Error(`Keine Kandidaten für ${dedupeKey}.`)

  const identityData = Object.fromEntries(
    Object.entries(identity).filter(
      ([key]) => !['nutrients', 'source', 'sourceRecordId', 'portions', 'rawPayload'].includes(key),
    ),
  ) as CanonicalImportRecord['identity']
  const identityMappings = buildIdentityMappings(candidates, explicitMappings)
  const rules = buildReferenceRules(candidates, identityMappings)
  const selected = selectCanonicalNutrients(
    identity.kind,
    candidates.flatMap((candidate) => candidate.nutrients),
    rules,
  )
  const portions = deduplicatePortions(candidates.flatMap((candidate) => candidate.portions ?? []))

  return {
    dedupeKey,
    identity: identityData,
    identitySource: identity.source,
    sourceRecords: candidates.map((candidate) => ({
      source: candidate.source,
      sourceRecordId: candidate.sourceRecordId,
      sourceUpdatedAt: candidate.sourceUpdatedAt ?? null,
      rawPayload: candidate.rawPayload ?? {
        id: candidate.id,
        name: candidate.nameDe,
        brand: candidate.brand ?? null,
      },
    })),
    identityMappings,
    nutrients: selected.nutrients,
    portions,
    qualityFlags: candidates.flatMap(checkFoodCandidate),
    nutrientCoverage: calculateCoverage(
      selected.nutrients,
      Object.fromEntries(nutrientDefinitions.map((definition) => [definition.key, definition.group])),
    ),
    rejectedReferenceNutrients: selected.rejectedReferenceNutrients,
    conflictingNutrients: selected.conflictingNutrients,
  }
}

function buildReferenceRules(candidates: FoodCandidate[], mappings: FoodIdentityMapping[]): NutrientInheritanceRule[] {
  const hasBlsReference = candidates.some((candidate) => candidate.source === 'bls' && candidate.kind === 'generic')
  return candidates.flatMap((candidate) => {
    if (candidate.source !== 'usda' || candidate.kind !== 'generic') return []
    const mapping = mappings.find((item) => mappingConnectsCandidate(item, candidate, candidates))
    const standaloneFallback = !hasBlsReference
    return nutrientDefinitions.map((definition) => ({
      nutrientKey: definition.key,
      allowed: standaloneFallback || Boolean(mapping),
      confidence: mapping?.confidence ?? (standaloneFallback ? 0.9 : 0),
      stateMatches: mapping?.stateMatches ?? standaloneFallback,
      definitionMatches: mapping?.definitionMatches ?? standaloneFallback,
      reason:
        mapping?.reason ??
        (standaloneFallback
          ? 'USDA fallback because no BLS identity exists in this import group.'
          : 'No verified BLS mapping.'),
    }))
  })
}

function buildIdentityMappings(candidates: FoodCandidate[], explicitMappings: FoodIdentityMapping[]) {
  const result = new Map<string, FoodIdentityMapping>()
  for (const mapping of explicitMappings) {
    if (!mappingConnectsGroup(mapping, candidates)) continue
    result.set(
      mappingKey(mapping.left.source, mapping.left.sourceRecordId, mapping.right.source, mapping.right.sourceRecordId),
      mapping,
    )
  }

  // A shared normalized dedupe key plus identical preparation state is the
  // deterministic, non-fuzzy mapping used for generic BLS/USDA supplements.
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    const left = candidates[leftIndex]
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const right = candidates[rightIndex]
      if (left.source === right.source || left.kind !== right.kind) continue
      if (left.kind !== 'generic' || left.preparationState !== right.preparationState) continue
      const key = mappingKey(left.source, left.sourceRecordId, right.source, right.sourceRecordId)
      if (result.has(key)) continue
      result.set(key, {
        left: { source: left.source, sourceRecordId: left.sourceRecordId },
        right: { source: right.source, sourceRecordId: right.sourceRecordId },
        method: 'normalized_identity',
        confidence: 0.95,
        stateMatches: true,
        definitionMatches: true,
        manuallyVerified: false,
        reason: 'Normalized identity and identical preparation state within one import group.',
      })
    }
  }
  return [...result.values()]
}

function mappingConnectsGroup(mapping: FoodIdentityMapping, candidates: FoodCandidate[]) {
  return (
    candidates.some(
      (candidate) =>
        candidate.source === mapping.left.source && candidate.sourceRecordId === mapping.left.sourceRecordId,
    ) &&
    candidates.some(
      (candidate) =>
        candidate.source === mapping.right.source && candidate.sourceRecordId === mapping.right.sourceRecordId,
    )
  )
}

function mappingConnectsCandidate(mapping: FoodIdentityMapping, candidate: FoodCandidate, candidates: FoodCandidate[]) {
  const candidateIsSide =
    (mapping.left.source === candidate.source && mapping.left.sourceRecordId === candidate.sourceRecordId) ||
    (mapping.right.source === candidate.source && mapping.right.sourceRecordId === candidate.sourceRecordId)
  return candidateIsSide && mappingConnectsGroup(mapping, candidates)
}

function mappingKey(leftSource: CatalogSource, leftId: string, rightSource: CatalogSource, rightId: string) {
  return [leftSource, leftId, rightSource, rightId].join(':')
}

function deduplicatePortions(portions: FoodPortionCandidate[]) {
  const unique = new Map<string, FoodPortionCandidate>()
  for (const portion of portions) {
    const key = `${portion.labelDe}|${portion.amount}|${portion.unit}`
    if (!unique.has(key)) unique.set(key, portion)
  }
  return [...unique.values()]
}

function identityPriority(candidate: FoodCandidate) {
  if (candidate.kind === 'branded' && candidate.source === 'open_food_facts') return 50
  if (candidate.source === 'bls') return 40
  if (candidate.source === 'usda') return 30
  return 10
}
