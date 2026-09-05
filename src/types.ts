export type Sex = 'male' | 'female'
export type ThemeMode = 'light' | 'dark' | 'system'
export type GoalMode = 'maintain' | 'cut' | 'bulk'
export type SyncOperation = 'upsert'

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
  activity_level: string
  body_fat_category: string
  onboarding_completed: boolean
}

export interface UserSettings extends BaseRecord {
  theme: ThemeMode
  goal_mode: GoalMode
  calorie_adjustment: number
  preliminary_maintenance: number | null
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
  weight_kg: number
  calories: number
  steps: number
}

export interface MealSlot extends BaseRecord {
  name: string
  order_index: number
}

export interface FoodEntry extends BaseRecord {
  meal_slot_id: string
  entry_date: string
  name: string
  amount: number
  unit: 'g' | 'ml' | 'piece'
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  micronutrients: Record<string, number>
}

export interface OutboxItem {
  key: string
  table: SyncedTableName
  record_id: string
  operation: SyncOperation
  payload: BaseRecord
  created_at: string
}

export interface SyncMeta {
  key: string
  value: string
}

export type SyncedTableName =
  | 'profiles'
  | 'user_settings'
  | 'training_plans'
  | 'training_days'
  | 'exercises'
  | 'workout_sessions'
  | 'workout_sets'
  | 'body_entries'
  | 'meal_slots'
  | 'food_entries'

export type AnySyncedRecord =
  | Profile
  | UserSettings
  | TrainingPlan
  | TrainingDay
  | Exercise
  | WorkoutSession
  | WorkoutSet
  | BodyEntry
  | MealSlot
  | FoodEntry

export const syncedTables: SyncedTableName[] = [
  'profiles',
  'user_settings',
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
