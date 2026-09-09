import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../lib/db'

export function useNutritionData(userId: string) {
  const settings = useLiveQuery(() => db.user_settings.where('user_id').equals(userId).first(), [userId])
  const entries = useLiveQuery(async () => (await db.food_entries.where('user_id').equals(userId).toArray()).filter((entry) => !entry.deleted_at), [userId], [])
  const bodyEntries = useLiveQuery(async () => (await db.body_entries.where('user_id').equals(userId).toArray()).filter((entry) => !entry.deleted_at), [userId], [])
  const mealSlots = useLiveQuery(async () => (await db.meal_slots.where('user_id').equals(userId).toArray()).filter((meal) => !meal.deleted_at).sort((a, b) => a.order_index - b.order_index), [userId], [])
  return { settings, entries, bodyEntries, mealSlots }
}
