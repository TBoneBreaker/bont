import type { FoodEntry } from '../../types'

export function sumFood(entries: FoodEntry[]) {
  return entries.reduce(
    (sum, entry) => ({
      calories: sum.calories + entry.calories,
      protein: sum.protein + entry.protein_g,
      carbs: sum.carbs + entry.carbs_g,
      fat: sum.fat + entry.fat_g,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  )
}
