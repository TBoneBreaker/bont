import type { BaseRecord, SyncedRecord, SyncedTableName } from '../../types'
import { syncedTables } from '../../types'
import { db, getSyncedTable } from './schema'

export { syncedTables }

export const tablePriority = new Map(syncedTables.map((table, index) => [table, index]))

export async function listUserRecords<T extends SyncedTableName>(table: T, userId: string, includeDeleted = false) {
  const records = await getSyncedTable(table).where('user_id').equals(userId).toArray()
  return includeDeleted ? records : records.filter((record) => !record.deleted_at)
}

export async function findUserRecord<T extends SyncedTableName>(table: T, userId: string, id: string) {
  const record = await getSyncedTable(table).get(id)
  return record?.user_id === userId ? record : undefined
}

export async function findBodyEntry(userId: string, entryDate: string) {
  return (await db.body_entries.where('entry_date').equals(entryDate).toArray()).find(
    (entry) => entry.user_id === userId,
  )
}

export function isActiveRecord(record: BaseRecord) {
  return !record.deleted_at
}

export function recordKey(table: SyncedTableName, id: string) {
  return `${table}:${id}`
}

export type TableRecord<T extends SyncedTableName> = SyncedRecord<T>
