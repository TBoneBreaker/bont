import type { OutboxItem, SyncedRecord, SyncedTableName } from '../../types'
import { isDemoUserId } from '../demo-constants'
import { db } from '../local-db/schema'
import { recordKey, tablePriority } from '../local-db/tables'

export const MAX_RETRIES = 5

export function createOutboxItem<T extends SyncedTableName>(table: T, record: SyncedRecord<T>, timestamp = record.updated_at): OutboxItem {
  return {
    key: recordKey(table, record.id),
    table,
    record_id: record.id,
    user_id: record.user_id,
    operation: 'upsert',
    payload: record,
    status: 'pending',
    retry_count: 0,
    last_error: null,
    next_retry_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  }
}

export async function listDueOutbox(userId: string, now = new Date()) {
  const nowIso = now.toISOString()
  return (await db.outbox.where('user_id').equals(userId).toArray())
    .filter((item) => (item.status === 'pending' || item.status === 'failed')
      && (!item.next_retry_at || item.next_retry_at <= nowIso))
    .sort((a, b) => (tablePriority.get(a.table) ?? 99) - (tablePriority.get(b.table) ?? 99)
      || a.created_at.localeCompare(b.created_at))
}

export async function listPendingKeys(userId: string) {
  const items = await db.outbox.where('user_id').equals(userId).toArray()
  return new Set(items.filter((item) => item.status !== 'dead_letter').map((item) => item.key))
}

export async function countOutbox(userId: string) {
  const items = await db.outbox.where('user_id').equals(userId).toArray()
  return {
    pending: items.filter((item) => item.status === 'pending' || item.status === 'processing').length,
    failed: items.filter((item) => item.status === 'failed').length,
    deadLetter: items.filter((item) => item.status === 'dead_letter').length,
  }
}

export async function markProcessing(item: OutboxItem) {
  const current = await db.outbox.get(item.key)
  if (!current || current.created_at !== item.created_at) return false
  await db.outbox.put({ ...current, status: 'processing', updated_at: new Date().toISOString() })
  return true
}

export async function markFailed(item: OutboxItem, error: unknown, now = new Date()) {
  const current = await db.outbox.get(item.key)
  if (!current || current.created_at !== item.created_at) return 'superseded' as const
  const retryCount = current.retry_count + 1
  const deadLetter = retryCount >= MAX_RETRIES
  const message = error instanceof Error ? error.message : 'Unbekannter Synchronisierungsfehler'
  await db.outbox.put({
    ...current,
    status: deadLetter ? 'dead_letter' : 'failed',
    retry_count: retryCount,
    last_error: message,
    next_retry_at: deadLetter ? null : new Date(now.getTime() + Math.min(60_000, 1_000 * 2 ** (retryCount - 1))).toISOString(),
    updated_at: now.toISOString(),
  })
  return deadLetter ? 'dead_letter' as const : 'failed' as const
}

export async function acknowledge(item: OutboxItem) {
  const current = await db.outbox.get(item.key)
  if (current?.created_at === item.created_at) await db.outbox.delete(item.key)
}

export async function recoverProcessing(userId?: string) {
  const items = userId ? await db.outbox.where('user_id').equals(userId).toArray() : await db.outbox.toArray()
  const stale = items.filter((item) => item.status === 'processing')
  await Promise.all(stale.map((item) => db.outbox.put({
    ...item,
    status: 'failed',
    next_retry_at: null,
    last_error: item.last_error ?? 'Synchronisierung wurde unterbrochen und wird erneut versucht.',
    updated_at: new Date().toISOString(),
  })))
}

export function shouldQueue(userId: string) {
  return !isDemoUserId(userId)
}
