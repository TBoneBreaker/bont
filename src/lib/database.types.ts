import type {
  BodyEntry,
  Exercise,
  FoodEntry,
  MealSlot,
  Profile,
  TrainingDay,
  TrainingPlan,
  UserSettings,
  WorkoutSession,
  WorkoutSet,
} from '../types'

type TableDefinition<Row> = {
  Row: Row & Record<string, unknown>
  Insert: Partial<Row> & Record<string, unknown>
  Update: Partial<Row> & Record<string, unknown>
  Relationships: []
}

/**
 * Kept in source control until the Supabase CLI is available in the project.
 * The shape mirrors the migrations in supabase/migrations and gives the client
 * a single typed boundary instead of spreading `any` casts through features.
 */
export interface Database {
  public: {
    Tables: {
      profiles: TableDefinition<Profile>
      user_settings: TableDefinition<UserSettings>
      training_plans: TableDefinition<TrainingPlan>
      training_days: TableDefinition<TrainingDay>
      exercises: TableDefinition<Exercise>
      workout_sessions: TableDefinition<WorkoutSession>
      workout_sets: TableDefinition<WorkoutSet>
      body_entries: TableDefinition<BodyEntry>
      meal_slots: TableDefinition<MealSlot>
      food_entries: TableDefinition<FoodEntry>
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
