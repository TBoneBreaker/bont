import { syncedTables, type BodyEntry, type OutboxItem, type SyncedRecord, type SyncedTableName } from '../../types'
import { getUserMessage, logError } from '../errors'
import { putRemoteRecord } from '../local-db/local-repository'
import { db, getSyncedTable } from '../local-db/schema'
import { cursorFromRows, decodeCursor, encodeCursor, mergeBodyEntries, remoteWins } from './conflict-policy'
import { acknowledge, countOutbox, listDueOutbox, listPendingKeys, markFailed, markProcessing, recoverProcessing } from './outbox'
import { publishSyncResult, publishSyncStatus, registerSyncRunner } from './sync-status'
import { fetchSyncedPage, findRemoteBodyEntry, upsertSyncedRecord } from '../supabase-data'

export interface SyncResult {
  pushed: number
  pulled: number
  pending: number
  failed: number
  deadLetter: number
  error?: string
}

const syncChains = new Map<string, Promise<SyncResult>>()
const PAGE_SIZE = 500

async function pushItem(userId: string, item: OutboxItem) {
  let payload = item.payload
  let replacedLocalId: string | null = null
  let conflictTarget = 'id'

  if (item.table === 'body_entries') {
    const bodyPayload = item.payload as BodyEntry
    const { data: remote, error } = await findRemoteBodyEntry(userId, bodyPayload.entry_date)
    if (error) throw error
    if (remote) {
      const remoteBody = remote as BodyEntry
      replacedLocalId = bodyPayload.id !== remoteBody.id ? bodyPayload.id : null
      payload = mergeBodyEntries(undefined, remoteBody, bodyPayload)
    }
    conflictTarget = 'user_id,entry_date'
  }

  const { data: saved, error } = await upsertSyncedRecord(item.table, payload, conflictTarget)
  if (error) throw error
  if (replacedLocalId) await db.body_entries.delete(replacedLocalId)
  if (saved && saved.user_id === userId) {
    await putRemoteRecord(item.table, saved as SyncedRecord<typeof item.table>)
  }
  await acknowledge(item)
}

async function pullTable(userId: string, table: SyncedTableName, full: boolean, pendingKeys: Set<string>) {
  const cursorKey = `last-sync:${userId}:${table}`
  const storedCursor = full ? null : decodeCursor((await db.sync_meta.get(cursorKey))?.value)
  let cursor = storedCursor
  let offset = 0
  let pulled = 0

  while (true) {
    const { data, error } = await fetchSyncedPage(table, userId, storedCursor, offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    const rows = data ?? []
    for (const row of rows) {
      const key = `${table}:${row.id}`
      if (pendingKeys.has(key)) continue
      const local = await getSyncedTable(table).get(row.id)
      if (remoteWins(local, row)) {
        await putRemoteRecord(table, row as SyncedRecord<typeof table>)
        pulled += 1
      }
      cursor = cursorFromRows([row], cursor)
    }
    if (rows.length < PAGE_SIZE) break
    offset += rows.length
  }

  if (cursor && (!storedCursor || cursor.updated_at !== storedCursor.updated_at || cursor.id !== storedCursor.id)) {
    await db.sync_meta.put({ key: cursorKey, value: encodeCursor(cursor) })
  }
  return pulled
}

async function runSync(userId: string, full: boolean): Promise<SyncResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const counts = await countOutbox(userId)
    const result = { pushed: 0, pulled: 0, pending: counts.pending + counts.failed + counts.deadLetter, failed: counts.failed, deadLetter: counts.deadLetter }
    publishSyncStatus(userId, { state: 'offline', ...counts, pending: result.pending })
    return result
  }

  publishSyncStatus(userId, { state: 'syncing' })
  await recoverProcessing(userId)
  let pushed = 0
  let pulled = 0
  let firstError: unknown = null

  for (const item of await listDueOutbox(userId)) {
    if (!await markProcessing(item)) continue
    try {
      await pushItem(userId, item)
      pushed += 1
    } catch (error) {
      logError(`Synchronisierung ${item.table}/${item.record_id}`, error)
      await markFailed(item, error)
      if (!firstError) firstError = error
      // One malformed row must never prevent unrelated records from syncing.
    }
  }

  const pendingKeys = await listPendingKeys(userId)
  for (const table of syncedTables) {
    try {
      pulled += await pullTable(userId, table, full, pendingKeys)
    } catch (error) {
      logError(`Abruf ${table}`, error)
      if (!firstError) firstError = error
    }
  }

  const counts = await countOutbox(userId)
  const result: SyncResult = {
    pushed,
    pulled,
    pending: counts.pending + counts.failed + counts.deadLetter,
    failed: counts.failed,
    deadLetter: counts.deadLetter,
    ...(firstError ? { error: getUserMessage(firstError, 'Die Synchronisierung konnte nicht vollständig abgeschlossen werden.') } : {}),
  }
  publishSyncResult(userId, result)
  return result
}

export function syncUser(userId: string, options: { full?: boolean } = {}) {
  const previous = syncChains.get(userId) ?? Promise.resolve<SyncResult>({ pushed: 0, pulled: 0, pending: 0, failed: 0, deadLetter: 0 })
  const next = previous.catch(() => undefined).then(() => runSync(userId, options.full ?? false))
  syncChains.set(userId, next)
  return next.finally(() => {
    if (syncChains.get(userId) === next) syncChains.delete(userId)
  })
}

registerSyncRunner((userId) => { void syncUser(userId) })
