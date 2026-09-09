export type Sex = 'male' | 'female'
export type ThemeMode = 'light' | 'dark' | 'system'
export type GoalMode = 'maintain' | 'cut' | 'bulk'
export type ActivityLevel = 'low' | 'light' | 'moderate' | 'high' | 'athlete'
export type BodyFatCategory = 'very_low' | 'athletic' | 'fit' | 'average' | 'high'
export type SyncOperation = 'upsert'
export type OutboxStatus = 'pending' | 'processing' | 'failed' | 'dead_letter'
export type FoodSource = 'open_food_facts' | 'usda'
export type FoodPreparationState = 'raw' | 'dry' | 'cooked' | 'prepared' | 'unknown'

export interface BaseRecord {
  id: string
  user_id: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Profile extends BaseRecord {
  display_name: string
  birth_date: string
  sex: Sex
  height_cm: number
  initial_weight_kg: number
  activity_level: ActivityLevel
  body_fat_category: BodyFatCategory
  onboarding_completed: boolean
}

export interface UserSettings extends BaseRecord {
  theme: ThemeMode
  goal_mode: GoalMode
  calorie_adjustment: number
  preliminary_maintenance: number | null
}

export interface GoalSettingsHistory extends BaseRecord {
  effective_from: string
  goal_mode: GoalMode
  calorie_adjustment: number
}

export interface TrainingPlan extends BaseRecord {
  name: string
  split_size: number
  notes: string
  is_active: boolean
  is_template: boolean
}

export interface TrainingDay extends BaseRecord {
  plan_id: string
  name: string
  order_index: number
}

export interface Exercise extends BaseRecord {
  training_day_id: string
  name: string
  target_sets: number
  order_index: number
}

export interface WorkoutSession extends BaseRecord {
  training_plan_id: string
  training_day_id: string
  entry_date: string
  started_at: string
  completed_at: string | null
  status: 'active' | 'completed'
}

export interface WorkoutSet extends BaseRecord {
  session_id: string
  exercise_id: string
  set_number: number
  weight_kg: number | null
  reps: number | null
  is_completed: boolean
}

export interface BodyEntry extends BaseRecord {
  entry_date: string
  weight_kg: number | null
  calories: number | null
  steps: number | null
}

export interface MealSlot extends BaseRecord {
  name: string
  order_index: number
}

export interface FoodEntry extends BaseRecord {
  meal_slot_id: string
  entry_date: string
  name: string
  // Optional for backwards compatibility with records created before the brand migration.
  brand?: string
  amount: number
  unit: 'g' | 'ml' | 'piece'
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  micronutrients: Record<string, number>
  food_source?: FoodSource
  source_id?: string
  preparation_state?: FoodPreparationState
  portion_grams?: number | null
  portion_label?: string | null
}

export type SyncedRecordMap = {
  profiles: Profile
  user_settings: UserSettings
  goal_settings_history: GoalSettingsHistory
  training_plans: TrainingPlan
  training_days: TrainingDay
  exercises: Exercise
  workout_sessions: WorkoutSession
  workout_sets: WorkoutSet
  body_entries: BodyEntry
  meal_slots: MealSlot
  food_entries: FoodEntry
}

export type SyncedTableName = keyof SyncedRecordMap
export type SyncedRecord<T extends SyncedTableName> = SyncedRecordMap[T]
export type AnySyncedRecord = SyncedRecordMap[SyncedTableName]
export type RecordWrite = {
  [T in SyncedTableName]: { table: T; record: SyncedRecordMap[T] }
}[SyncedTableName]

export interface OutboxItem {
  key: string
  table: SyncedTableName
  record_id: string
  user_id: string
  operation: SyncOperation
  payload: AnySyncedRecord
  status: OutboxStatus
  retry_count: number
  last_error: string | null
  next_retry_at: string | null
  created_at: string
  updated_at: string
}

export interface SyncMeta {
  key: string
  value: string
}

export const syncedTables: SyncedTableName[] = [
  'profiles',
  'user_settings',
  'goal_settings_history',
  'training_plans',
  'training_days',
  'exercises',
  'workout_sessions',
  'workout_sets',
  'body_entries',
  'meal_slots',
  'food_entries',
]

export const newId = () => crypto.randomUUID()

export const createBase = (userId: string, id: string = newId()): BaseRecord => {
  const timestamp = new Date().toISOString()
  return {
    id,
    user_id: userId,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
  }
}
