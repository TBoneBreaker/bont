import { describe, expect, it } from 'vitest'
import { afterCursor, cursorFromRows, decodeCursor, encodeCursor, mergeBodyEntries, remoteWins } from './conflict-policy'
import type { BodyEntry } from '../../types'

const base = { id: 'a', user_id: 'user', created_at: '2026-01-01T00:00:00.000Z', deleted_at: null }

describe('sync conflict policy', () => {
  it('uses timestamp and id as a deterministic last-write-wins order', () => {
    expect(remoteWins({ ...base, updated_at: '2026-01-01T00:00:00.000Z' }, { ...base, id: 'b', updated_at: '2026-01-01T00:00:00.000Z' })).toBe(true)
    expect(remoteWins({ ...base, updated_at: '2026-01-02T00:00:00.000Z' }, { ...base, updated_at: '2026-01-01T00:00:00.000Z' })).toBe(false)
  })

  it('merges independent body metrics from a pending local row', () => {
    const remote: BodyEntry = { ...base, id: 'remote', updated_at: '2026-01-02T00:00:00.000Z', entry_date: '2026-01-02', weight_kg: 80, calories: 2500, steps: null }
    const pending: BodyEntry = { ...remote, id: 'local', updated_at: '2026-01-03T00:00:00.000Z', weight_kg: 79, calories: null, steps: 9000 }
    expect(mergeBodyEntries(undefined, remote, pending)).toMatchObject({ id: 'remote', weight_kg: 79, calories: 2500, steps: 9000 })
  })

  it('serializes the composite cursor and advances equal timestamps by id', () => {
    const cursor = { updated_at: '2026-01-01T00:00:00.000Z', id: 'a' }
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
    expect(afterCursor({ updated_at: cursor.updated_at, id: 'b' }, cursor)).toBe(true)
    expect(cursorFromRows([{ updated_at: cursor.updated_at, id: 'b' }], cursor)).toEqual({ updated_at: cursor.updated_at, id: 'b' })
  })
})
