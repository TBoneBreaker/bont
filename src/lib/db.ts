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
  return next
}

export async function softDeleteRecord(table: SyncedTableName, record: AnySyncedRecord) {
  const timestamp = new Date().toISOString()
  return saveRecord(table, { ...record, deleted_at: timestamp, updated_at: timestamp } as AnySyncedRecord)
}

let activeSync: Promise<SyncResult> | null = null

export interface SyncResult {
  pushed: number
  pulled: number
  pending: number
  error?: string
}

async function runSync(userId: string): Promise<SyncResult> {
  if (!navigator.onLine) {
    return { pushed: 0, pulled: 0, pending: await db.outbox.count() }
  }

  let pushed = 0
  let pulled = 0

  try {
    const queued = await db.outbox.orderBy('created_at').toArray()
    for (const item of queued) {
      if (item.payload.user_id !== userId) continue
      const { error } = await supabase.from(item.table).upsert(item.payload, { onConflict: 'id' })
      if (error) throw error
      await db.outbox.delete(item.key)
      pushed += 1
    }

    const lastSync = (await db.sync_meta.get(`last-sync:${userId}`))?.value ?? '1970-01-01T00:00:00.000Z'
    const pendingKeys = new Set((await db.outbox.toArray()).map((item) => item.key))

    for (const tableName of syncedTables) {
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .eq('user_id', userId)
        .gt('updated_at', lastSync)
        .order('updated_at', { ascending: true })
        .limit(1000)

      if (error) throw error
      const localTable = getTable(tableName)
      for (const row of data ?? []) {
        if (!pendingKeys.has(`${tableName}:${row.id}`)) {
          await localTable.put(row as AnySyncedRecord)
          pulled += 1
        }
      }
    }

    await db.sync_meta.put({ key: `last-sync:${userId}`, value: new Date().toISOString() })
    return { pushed, pulled, pending: await db.outbox.count() }
  } catch (error) {
    return {
      pushed,
      pulled,
      pending: await db.outbox.count(),
      error: error instanceof Error ? error.message : 'Synchronisierung fehlgeschlagen',
    }
  }
}

export function syncUser(userId: string) {
  if (!activeSync) {
    activeSync = runSync(userId).finally(() => {
      activeSync = null
    })
  }
  return activeSync
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
  })
}
