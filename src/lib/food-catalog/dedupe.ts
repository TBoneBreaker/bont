import { normalizeBarcode, normalizeSearchText } from './normalize.ts'
import type { FoodCandidate, FoodIdentityMapping } from './types.ts'

export interface FoodDedupeGroup {
  key: string
  candidates: FoodCandidate[]
}

/** Barcode identity is authoritative for branded products; names are only a fallback. */
export function foodDedupeKey(food: FoodCandidate) {
  const barcode = normalizeBarcode(food.gtin)
  if (barcode && food.kind === 'branded') return `gtin:${barcode}`
  const name = normalizeSearchText(food.nameDe)
  const brand = normalizeSearchText(food.brand ?? '')
  const country = (food.countryCode ?? '').toUpperCase()
  return [food.kind, name, food.preparationState, brand, country].join('|')
}

export function groupDuplicateFoods(candidates: FoodCandidate[], mappings: FoodIdentityMapping[] = []) {
  const parents = candidates.map((_, index) => index)
  const candidateIndex = new Map(
    candidates.map((candidate, index) => [`${candidate.source}:${candidate.sourceRecordId}`, index]),
  )
  const find = (index: number): number => {
    if (parents[index] === index) return index
    parents[index] = find(parents[index])
    return parents[index]
  }
  const union = (left: number, right: number) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot
  }
  for (const mapping of mappings) {
    if (mapping.confidence < 0.9 || !mapping.stateMatches || !mapping.definitionMatches) continue
    const left = candidateIndex.get(`${mapping.left.source}:${mapping.left.sourceRecordId}`)
    const right = candidateIndex.get(`${mapping.right.source}:${mapping.right.sourceRecordId}`)
    if (left !== undefined && right !== undefined && candidates[left].kind === candidates[right].kind)
      union(left, right)
  }

  const roots = candidates.map((_, index) => find(index))
  const membersByRoot = new Map<number, FoodCandidate[]>()
  for (const [index, candidate] of candidates.entries()) {
    const members = membersByRoot.get(roots[index]) ?? []
    members.push(candidate)
    membersByRoot.set(roots[index], members)
  }
  const groups = new Map<string, FoodDedupeGroup>()
  for (const [index, candidate] of candidates.entries()) {
    const mappedMembers = membersByRoot.get(roots[index]) ?? [candidate]
    const key =
      mappedMembers.length > 1
        ? `mapped:${mappedMembers
            .map((member) => `${member.source}:${member.sourceRecordId}`)
            .sort()
            .join('|')}`
        : foodDedupeKey(candidate)
    const group = groups.get(key) ?? { key, candidates: [] }
    group.candidates.push(candidate)
    groups.set(key, group)
  }
  return [...groups.values()]
}
