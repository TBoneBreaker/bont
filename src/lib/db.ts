import Dexie, { type Table } from 'dexie'
import { supabase } from './supabase'
import type {
  AnySyncedRecord,
  BodyEntry,
  Exercise,
  FoodEntry,
  MealSlot,
  OutboxItem,
  Profile,
  SyncedTableName,
  SyncMeta,
  TrainingDay,
  TrainingPlan,
  UserSettings,
  WorkoutSession,
  WorkoutSet,
} from '../types'
import { syncedTables } from '../types'
import { isDemoUserId } from './demo-constants'

class BontDatabase extends Dexie {
  profiles!: Table<Profile, string>
  user_settings!: Table<UserSettings, string>
  training_plans!: Table<TrainingPlan, string>
  training_days!: Table<TrainingDay, string>
  exercises!: Table<Exercise, string>
  workout_sessions!: Table<WorkoutSession, string>
  workout_sets!: Table<WorkoutSet, string>
  body_entries!: Table<BodyEntry, string>
  meal_slots!: Table<MealSlot, string>
  food_entries!: Table<FoodEntry, string>
  outbox!: Table<OutboxItem, string>
  sync_meta!: Table<SyncMeta, string>

  constructor() {
    super('bont-local')
    this.version(1).stores({
      profiles: 'id,&user_id,updated_at,deleted_at',
      user_settings: 'id,&user_id,updated_at,deleted_at',
      training_plans: 'id,user_id,is_active,is_template,updated_at,deleted_at',
      training_days: 'id,user_id,plan_id,order_index,updated_at,deleted_at',
      exercises: 'id,user_id,training_day_id,order_index,updated_at,deleted_at',
      workout_sessions: 'id,user_id,training_plan_id,training_day_id,status,started_at,updated_at,deleted_at',
      workout_sets: 'id,user_id,session_id,exercise_id,set_number,updated_at,deleted_at',
      body_entries: 'id,user_id,entry_date,updated_at,deleted_at',
      meal_slots: 'id,user_id,order_index,updated_at,deleted_at',
      food_entries: 'id,user_id,meal_slot_id,entry_date,updated_at,deleted_at',
      outbox: '&key,table,record_id,created_at',
      sync_meta: 'key',
    })
  }
}

export const db = new BontDatabase()

const getTable = (table: SyncedTableName): Table<AnySyncedRecord, string> =>
  db.table(table) as Table<AnySyncedRecord, string>

export async function saveRecord<T extends AnySyncedRecord>(
  table: SyncedTableName,
  record: T,
  queue = true,
) {
  const timestamp = new Date().toISOString()
  const next = { ...record, updated_at: timestamp } as T
  const localTable = getTable(table)

  await db.transaction('rw', localTable, db.outbox, async () => {
    await localTable.put(next)
    if (queue && !isDemoUserId(next.user_id)) {
      await db.outbox.put({
        key: `${table}:${next.id}`,
        table,
        record_id: next.id,
        operation: 'upsert',
        payload: next,
        created_at: timestamp,
      })
    }
  })
  if (queue && !isDemoUserId(next.user_id)) scheduleUserSync(next.user_id)
  return next
}

export async function softDeleteRecord(table: SyncedTableName, record: AnySyncedRecord) {
  const timestamp = new Date().toISOString()
  return saveRecord(table, { ...record, deleted_at: timestamp, updated_at: timestamp } as AnySyncedRecord)
}

const syncChains = new Map<string, Promise<SyncResult>>()
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>()

const tablePriority = new Map(syncedTables.map((table, index) => [table, index]))

function pendingForUser(userId: string) {
  return db.outbox.toArray().then((items) => items.filter((item) => item.payload.user_id === userId).length)
}

function scheduleUserSync(userId: string) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return
  const current = syncTimers.get(userId)
  if (current) window.clearTimeout(current)
  syncTimers.set(userId, window.setTimeout(() => {
    syncTimers.delete(userId)
    void syncUser(userId)
  }, 350))
}

export interface SyncResult {
  pushed: number
  pulled: number
  pending: number
  error?: string
}

async function runSync(userId: string, full = false): Promise<SyncResult> {
  if (!navigator.onLine) {
    return { pushed: 0, pulled: 0, pending: await pendingForUser(userId) }
  }

  let pushed = 0
  let pulled = 0

  try {
    const queued = (await db.outbox.orderBy('created_at').toArray())
      .filter((item) => item.payload.user_id === userId)
      .sort((a, b) => (tablePriority.get(a.table) ?? 99) - (tablePriority.get(b.table) ?? 99)
        || a.created_at.localeCompare(b.created_at))
    for (const item of queued) {
      const { error } = await supabase.from(item.table).upsert(item.payload, { onConflict: 'id' })
      if (error) throw error
      const current = await db.outbox.get(item.key)
      if (current?.created_at === item.created_at) await db.outbox.delete(item.key)
      pushed += 1
    }

    const pendingKeys = new Set((await db.outbox.toArray())
      .filter((item) => item.payload.user_id === userId)
      .map((item) => item.key))

    for (const tableName of syncedTables) {
      const cursorKey = `last-sync:${userId}:${tableName}`
      const legacyCursor = (await db.sync_meta.get(`last-sync:${userId}`))?.value
      const cursor = full ? null : (await db.sync_meta.get(cursorKey))?.value ?? legacyCursor ?? null
      const localTable = getTable(tableName)
      let offset = 0
      let newestTimestamp = cursor

      while (true) {
        let query = supabase
          .from(tableName)
          .select('*')
          .eq('user_id', userId)
          .order('updated_at', { ascending: true })
          .order('id', { ascending: true })
          .range(offset, offset + 499)
        if (cursor) query = query.gt('updated_at', cursor)
        const { data, error } = await query
        if (error) throw error

        for (const row of data ?? []) {
          const key = `${tableName}:${row.id}`
          if (!pendingKeys.has(key)) {
            await localTable.put(row as AnySyncedRecord)
            pulled += 1
          }
          if (!newestTimestamp || row.updated_at > newestTimestamp) newestTimestamp = row.updated_at
        }
        if (!data || data.length < 500) break
        offset += data.length
      }

      if (newestTimestamp) await db.sync_meta.put({ key: cursorKey, value: newestTimestamp })
    }

    return { pushed, pulled, pending: await pendingForUser(userId) }
  } catch (error) {
    return {
      pushed,
      pulled,
      pending: await pendingForUser(userId),
      error: error instanceof Error ? error.message : 'Synchronisierung fehlgeschlagen',
    }
  }
}

export function syncUser(userId: string, options: { full?: boolean } = {}) {
  const previous = syncChains.get(userId)
  const next = (previous ?? Promise.resolve({ pushed: 0, pulled: 0, pending: 0 }))
    .then(() => runSync(userId, options.full))
  syncChains.set(userId, next)
  void next.then(() => {
    if (syncChains.get(userId) === next) syncChains.delete(userId)
  })
  return next
}

export async function clearLocalUserData(userId: string) {
  await db.transaction('rw', [...syncedTables.map(getTable), db.outbox, db.sync_meta], async () => {
    for (const tableName of syncedTables) {
      const rows = await getTable(tableName).where('user_id').equals(userId).primaryKeys()
      await getTable(tableName).bulkDelete(rows)
    }
    const queued = await db.outbox.toArray()
    await db.outbox.bulkDelete(queued.filter((item) => item.payload.user_id === userId).map((item) => item.key))
    await db.sync_meta.delete(`last-sync:${userId}`)
    const perTableCursors = (await db.sync_meta.toArray())
      .filter((item) => item.key.startsWith(`last-sync:${userId}:`))
      .map((item) => item.key)
    await db.sync_meta.bulkDelete(perTableCursors)
  })
}
