import type { BaseRecord, RecordWrite, SyncedRecord, SyncedTableName } from '../../types'
import { isDemoUserId } from '../demo-constants'
import { createOutboxItem, shouldQueue } from '../sync/outbox'
import { scheduleUserSync } from '../sync/sync-status'
import { db, getSyncedTable } from './schema'
import { listUserRecords } from './tables'

const tableObjects = [
  db.profiles,
  db.user_settings,
  db.training_plans,
  db.training_days,
  db.exercises,
  db.workout_sessions,
  db.workout_sets,
  db.body_entries,
  db.meal_slots,
  db.food_entries,
]

function now() {
  return new Date().toISOString()
}

function touchedRecord<T extends BaseRecord>(record: T, timestamp: string): T {
  return { ...record, updated_at: timestamp }
}

export async function saveRecord<T extends SyncedTableName>(table: T, record: SyncedRecord<T>, queue = true) {
  const next = touchedRecord(record, now())
  const localTable = getSyncedTable(table)
  const shouldEnqueue = queue && shouldQueue(next.user_id)

  await db.transaction('rw', localTable, db.outbox, async () => {
    await localTable.put(next)
    if (shouldEnqueue) await db.outbox.put(createOutboxItem(table, next))
  })
  if (shouldEnqueue) scheduleUserSync(next.user_id)
  return next
}

export async function saveRecordsAtomically(writes: RecordWrite[], queue = true) {
  if (!writes.length) return []
  const timestamp = now()
  const nextRecords = writes.map((write) => ({
    ...write,
    record: touchedRecord(write.record, timestamp),
  }))
  const users = new Set(nextRecords.map(({ record }) => record.user_id))
  if (users.size !== 1) throw new Error('Eine atomare lokale Änderung darf nur einen Nutzer betreffen.')
  const userId = nextRecords[0].record.user_id
  const shouldEnqueue = queue && shouldQueue(userId)

  await db.transaction('rw', [...tableObjects, db.outbox], async () => {
    for (const write of nextRecords) {
      const table = getSyncedTable(write.table) as unknown as { put(record: BaseRecord): Promise<string> }
      await table.put(write.record)
      if (shouldEnqueue) await db.outbox.put(createOutboxItem(write.table, write.record))
    }
  })
  if (shouldEnqueue) scheduleUserSync(userId)
  return nextRecords.map(({ record }) => record)
}

export async function softDeleteRecord<T extends SyncedTableName>(table: T, record: SyncedRecord<T>) {
  const timestamp = now()
  return saveRecord(table, { ...record, deleted_at: timestamp, updated_at: timestamp } as SyncedRecord<T>)
}

export async function softDeleteRecordsAtomically(writes: RecordWrite[]) {
  const timestamp = now()
  return saveRecordsAtomically(
    writes.map(
      (write) =>
        ({
          ...write,
          record: { ...write.record, deleted_at: timestamp, updated_at: timestamp },
        }) as RecordWrite,
    ),
  )
}

export async function listRecords<T extends SyncedTableName>(table: T, userId: string, includeDeleted = false) {
  return listUserRecords(table, userId, includeDeleted)
}

export async function putRemoteRecord<T extends SyncedTableName>(table: T, record: SyncedRecord<T>) {
  await getSyncedTable(table).put(record)
}

export async function clearLocalUserData(userId: string) {
  await db.transaction('rw', [...tableObjects, db.outbox, db.sync_meta], async () => {
    for (const table of tableObjects) {
      await table.where('user_id').equals(userId).delete()
    }
    const meta = await db.sync_meta.toArray()
    await db.sync_meta.bulkDelete(meta.filter((item) => item.key.includes(`:${userId}`)).map((item) => item.key))
    const outbox = await db.outbox.where('user_id').equals(userId).toArray()
    await db.outbox.bulkDelete(outbox.map((item) => item.key))
  })
}

export function shouldPersistLocally(userId: string) {
  return !isDemoUserId(userId)
}
