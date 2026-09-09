import type { BodyEntry, BaseRecord } from '../../types'

export interface SyncCursor {
  updated_at: string
  id: string
}

/**
 * Last-write-wins is deterministic: the server row wins on a newer timestamp;
 * equal timestamps use the lexicographically larger id. Pending local writes
 * are handled before this policy and always stay local until acknowledged.
 */
export function remoteWins(local: BaseRecord | undefined, remote: BaseRecord) {
  if (!local) return true
  if (remote.updated_at !== local.updated_at) return remote.updated_at > local.updated_at
  return remote.id >= local.id
}

export function mergeBodyEntries(local: BodyEntry | undefined, remote: BodyEntry, localPending: BodyEntry | undefined) {
  if (!localPending) return remote
  return {
    ...remote,
    ...localPending,
    id: remote.id,
    weight_kg: localPending.weight_kg ?? remote.weight_kg,
    calories: localPending.calories ?? remote.calories,
    steps: localPending.steps ?? remote.steps,
  }
}

export function encodeCursor(cursor: SyncCursor) {
  return JSON.stringify(cursor)
}

export function decodeCursor(value: string | null | undefined): SyncCursor | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && 'updated_at' in parsed && 'id' in parsed
      && typeof parsed.updated_at === 'string' && typeof parsed.id === 'string') {
      return { updated_at: parsed.updated_at, id: parsed.id }
    }
  } catch {
    // A pre-cursor timestamp is intentionally treated as a timestamp-only cursor.
  }
  return { updated_at: value, id: '' }
}

export function afterCursor(row: Pick<BaseRecord, 'updated_at' | 'id'>, cursor: SyncCursor | null) {
  if (!cursor) return true
  return row.updated_at > cursor.updated_at || (row.updated_at === cursor.updated_at && row.id > cursor.id)
}

export function cursorFromRows(rows: Array<Pick<BaseRecord, 'updated_at' | 'id'>>, previous: SyncCursor | null) {
  const last = rows.at(-1)
  if (!last) return previous
  return { updated_at: last.updated_at, id: last.id }
}
