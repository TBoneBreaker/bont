import { preliminaryMaintenance } from '../../lib/maintenance'
import { localDateString } from '../../lib/date'
import { saveRecordsAtomically } from '../../lib/local-db/local-repository'
import { onboardingInputSchema, type OnboardingInput } from '../../lib/validation'
import type { BodyEntry, GoalSettingsHistory, MealSlot, Profile, RecordWrite, UserSettings } from '../../types'
import { createBase, newId } from '../../types'

export async function completeOnboarding(userId: string, input: OnboardingInput) {
  const values = onboardingInputSchema.parse(input)
  const profile: Profile = {
    ...createBase(userId),
    display_name: values.displayName,
    birth_date: values.birthDate,
    sex: values.sex,
    height_cm: values.heightCm,
    initial_weight_kg: values.weightKg,
    activity_level: values.activityLevel,
    body_fat_category: values.bodyFatCategory,
    onboarding_completed: true,
  }
  const settings: UserSettings = {
    ...createBase(userId),
    theme: 'system',
    goal_mode: 'maintain',
    calorie_adjustment: 0,
    preliminary_maintenance: preliminaryMaintenance({
      sex: values.sex,
      birthDate: values.birthDate,
      heightCm: values.heightCm,
      weightKg: values.weightKg,
      activityLevel: values.activityLevel,
    }),
  }
  const meals: MealSlot[] = ['Frühstück', 'Mittagessen', 'Abendessen', 'Snack'].map((name, order_index) => ({
    ...createBase(userId, newId()),
    name,
    order_index,
  }))
  const body: BodyEntry = {
    ...createBase(userId),
    entry_date: localDateString(),
    weight_kg: values.weightKg,
    calories: null,
    steps: null,
  }
  const goalHistory: GoalSettingsHistory = {
    ...createBase(userId),
    effective_from: body.entry_date,
    goal_mode: settings.goal_mode,
    calorie_adjustment: settings.calorie_adjustment,
  }
  const writes: RecordWrite[] = [
    { table: 'profiles', record: profile },
    { table: 'user_settings', record: settings },
    { table: 'goal_settings_history', record: goalHistory },
    ...meals.map((record) => ({ table: 'meal_slots' as const, record })),
    { table: 'body_entries', record: body },
  ]
  await saveRecordsAtomically(writes)
  return profile
}
