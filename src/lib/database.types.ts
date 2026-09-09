import type {
  BodyEntry,
  Exercise,
  FoodEntry,
  GoalSettingsHistory,
  MealSlot,
  Profile,
  TrainingDay,
  TrainingPlan,
  UserSettings,
  WorkoutSession,
  WorkoutSet,
} from '../types'

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null

interface FoodSourceRow {
  code: string
  name: string
  license: string
  license_url: string | null
  source_url: string | null
  default_country_code: string | null
  is_active: boolean
  created_at: string
}

interface NutrientRow {
  id: string
  canonical_key: string
  name_de: string
  name_en: string | null
  unit: string
  nutrient_group: string
  source_mappings: Json
  is_active: boolean
  created_at: string
}

interface FoodRow {
  id: string
  kind: 'generic' | 'branded' | 'recipe'
  name_de: string
  name_en: string | null
  normalized_name: string
  brand: string | null
  manufacturer: string | null
  category_id: string | null
  subcategory: string | null
  preparation_state: string
  country_code: string | null
  nutrient_coverage: Json
  data_quality: Json
  confidence: number | null
  is_active: boolean
  created_at: string
  updated_at: string
}

interface FoodNutrientRow {
  food_id: string
  nutrient_id: string
  value: number | null
  unit: string
  basis_amount: number
  basis_unit: 'g' | 'ml'
  source_code: string
  source_external_id: string
  source_record_id: string
  derivation: 'direct' | 'inherited_reference'
  value_status: string
  confidence: number
  provenance: string | null
  updated_at: string
}

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
      goal_settings_history: TableDefinition<GoalSettingsHistory>
      training_plans: TableDefinition<TrainingPlan>
      training_days: TableDefinition<TrainingDay>
      exercises: TableDefinition<Exercise>
      workout_sessions: TableDefinition<WorkoutSession>
      workout_sets: TableDefinition<WorkoutSet>
      body_entries: TableDefinition<BodyEntry>
      meal_slots: TableDefinition<MealSlot>
      food_entries: TableDefinition<FoodEntry>
      food_sources: TableDefinition<FoodSourceRow>
      nutrients: TableDefinition<NutrientRow>
      foods: TableDefinition<FoodRow>
      food_nutrients: TableDefinition<FoodNutrientRow>
    }
    Views: Record<string, never>
    Functions: {
      search_foods: {
        Args: { search_query: string; result_limit?: number }
        Returns: Array<Record<string, unknown>>
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
