import { UserFacingError } from '../../lib/errors'
import {
  listRecords,
  saveRecord,
  saveRecordsAtomically,
  softDeleteRecord,
  softDeleteRecordsAtomically,
} from '../../lib/local-db/local-repository'
import { localDateString } from '../../lib/date'
import type { FoodEntry, GoalSettingsHistory, MealSlot, RecordWrite, UserSettings } from '../../types'
import { createBase } from '../../types'

export async function deleteMeal(userId: string, meal: MealSlot) {
  if (meal.user_id !== userId) throw new UserFacingError('Diese Mahlzeit gehört nicht zu deinem Konto.')
  const foods = (await listRecords('food_entries', userId, true)).filter(
    (food) => food.meal_slot_id === meal.id && !food.deleted_at,
  )
  return softDeleteRecordsAtomically([
    { table: 'meal_slots', record: meal },
    ...foods.map((record) => ({ table: 'food_entries' as const, record })),
  ] as RecordWrite[])
}

export async function saveFoodEntry(entry: FoodEntry) {
  if (
    !entry.name.trim() ||
    !Number.isFinite(entry.amount) ||
    entry.amount <= 0 ||
    !Number.isFinite(entry.calories) ||
    entry.calories < 0
  ) {
    throw new UserFacingError('Bitte prüfe Name, Menge und Kalorien des Lebensmittels.')
  }
  for (const value of [entry.protein_g, entry.carbs_g, entry.fat_g]) {
    if (!Number.isFinite(value) || value < 0)
      throw new UserFacingError('Makronährstoffe müssen gültige positive Werte sein.')
  }
  return saveRecord('food_entries', entry)
}

export async function deleteFoodEntry(userId: string, entry: FoodEntry) {
  if (entry.user_id !== userId) throw new UserFacingError('Dieses Lebensmittel gehört nicht zu deinem Konto.')
  return softDeleteRecord('food_entries', entry)
}

export async function renameMeal(userId: string, meal: MealSlot, name: string) {
  if (meal.user_id !== userId) throw new UserFacingError('Diese Mahlzeit gehört nicht zu deinem Konto.')
  const normalized = name.trim()
  if (!normalized || normalized === meal.name) return meal
  return saveRecord('meal_slots', { ...meal, name: normalized })
}

export async function addMeal(userId: string, currentCount: number) {
  if (currentCount >= 10) throw new UserFacingError('Du kannst höchstens zehn Mahlzeiten anlegen.')
  return saveRecord('meal_slots', {
    ...createBase(userId),
    name: `Mahlzeit ${currentCount + 1}`,
    order_index: currentCount,
  })
}

export async function updateGoal(settings: UserSettings, mode: UserSettings['goal_mode']) {
  const nextSettings: UserSettings = {
    ...settings,
    goal_mode: mode,
    calorie_adjustment: mode === 'maintain' ? 0 : settings.calorie_adjustment || (mode === 'cut' ? 300 : 200),
  }
  const history = await goalHistoryForToday(nextSettings)
  await saveRecordsAtomically([
    { table: 'user_settings', record: nextSettings },
    { table: 'goal_settings_history', record: history },
  ])
  return nextSettings
}

export async function updateCalorieAdjustment(settings: UserSettings, value: number) {
  const nextSettings = { ...settings, calorie_adjustment: Math.max(0, Math.min(1500, value)) }
  const history = await goalHistoryForToday(nextSettings)
  await saveRecordsAtomically([
    { table: 'user_settings', record: nextSettings },
    { table: 'goal_settings_history', record: history },
  ])
  return nextSettings
}

async function goalHistoryForToday(settings: UserSettings): Promise<GoalSettingsHistory> {
  const effectiveFrom = localDateString()
  const existing = (await listRecords('goal_settings_history', settings.user_id, true)).find(
    (item) => item.effective_from === effectiveFrom,
  )
  return {
    ...(existing ?? createBase(settings.user_id)),
    effective_from: effectiveFrom,
    goal_mode: settings.goal_mode,
    calorie_adjustment: settings.calorie_adjustment,
    deleted_at: null,
  }
}
