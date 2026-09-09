import Dexie, { type Table } from 'dexie'
import type {
  BodyEntry,
  BaseRecord,
  Exercise,
  FoodEntry,
  MealSlot,
  OutboxItem,
  Profile,
  SyncedRecord,
  SyncedTableName,
  SyncMeta,
  TrainingDay,
  TrainingPlan,
  UserSettings,
  WorkoutSession,
  WorkoutSet,
} from '../../types'

export class BontDatabase extends Dexie {
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

  constructor(name = 'bont-local') {
    super(name)
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
    this.version(2)
      .stores({
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
        outbox: '&key,user_id,table,record_id,status,next_retry_at,created_at,updated_at',
        sync_meta: 'key',
      })
      .upgrade((transaction) =>
        transaction
          .table('outbox')
          .toCollection()
          .modify((item: OutboxItem) => {
            const payload = item.payload as BaseRecord
            item.user_id ??= payload.user_id
            item.status ??= 'pending'
            item.retry_count ??= 0
            item.last_error ??= null
            item.next_retry_at ??= null
            item.updated_at ??= item.created_at
          }),
      )
  }
}

export const db = new BontDatabase()

export function getSyncedTable<T extends SyncedTableName>(table: T): Table<SyncedRecord<T>, string> {
  return db.table(table) as unknown as Table<SyncedRecord<T>, string>
}
