import { db } from './db'
import { DEMO_USER_ID } from './demo-constants'
import { createBase } from '../types'
import type {
  BodyEntry,
  FoodEntry,
  MealSlot,
  Profile,
  UserSettings,
} from '../types'

const dateOffset = (days: number) => {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

let seedPromise: Promise<void> | null = null

export function seedDemoData() {
  if (!seedPromise) seedPromise = runSeedDemoData()
  return seedPromise
}

async function runSeedDemoData() {
  const [existingProfile, existingFood] = await Promise.all([
    db.profiles.where('user_id').equals(DEMO_USER_ID).first(),
    db.food_entries.get('demo-food-skyr'),
  ])
  if (existingProfile && existingFood) return

  const profile: Profile = {
    ...createBase(DEMO_USER_ID, 'demo-profile'),
    display_name: 'Alex',
    birth_date: '2000-01-01',
    sex: 'male',
    height_cm: 180,
    initial_weight_kg: 78.4,
    activity_level: 'moderate',
    body_fat_category: 'fit',
    onboarding_completed: true,
  }
  const settings: UserSettings = {
    ...createBase(DEMO_USER_ID, 'demo-settings'),
    theme: 'system',
    goal_mode: 'bulk',
    calorie_adjustment: 200,
    preliminary_maintenance: 2550,
  }
  const bodyEntries: BodyEntry[] = Array.from({ length: 14 }, (_, index) => ({
    ...createBase(DEMO_USER_ID, `demo-body-${index}`),
    entry_date: dateOffset(index - 13),
    weight_kg: Number((78.4 - index * 0.025 + [0.08, -0.04, 0.03][index % 3]).toFixed(2)),
    calories: 2380 + [80, -40, 20, 0][index % 4],
    steps: 10_800 + [1200, 400, 2100, 800][index % 4],
  }))
  const meals: MealSlot[] = ['Frühstück', 'Mittagessen', 'Pre Workout', 'Abendessen'].map((name, index) => ({
    ...createBase(DEMO_USER_ID, `demo-meal-${index}`),
    name,
    order_index: index,
  }))
  const today = dateOffset(0)
  const foods: FoodEntry[] = [
    {
      ...createBase(DEMO_USER_ID, 'demo-food-skyr'),
      meal_slot_id: meals[0].id,
      entry_date: today,
      name: 'Skyr mit Blaubeeren',
      amount: 500,
      unit: 'g',
      calories: 410,
      protein_g: 57,
      carbs_g: 34,
      fat_g: 3,
      micronutrients: {},
    },
    {
      ...createBase(DEMO_USER_ID, 'demo-food-oats'),
      meal_slot_id: meals[1].id,
      entry_date: today,
      name: 'Overnight Oats',
      amount: 350,
      unit: 'g',
      calories: 620,
      protein_g: 31,
      carbs_g: 82,
      fat_g: 18,
      micronutrients: {},
    },
    {
      ...createBase(DEMO_USER_ID, 'demo-food-banana'),
      meal_slot_id: meals[2].id,
      entry_date: today,
      name: 'Banane',
      amount: 1,
      unit: 'piece',
      calories: 120,
      protein_g: 1,
      carbs_g: 28,
      fat_g: 0,
      micronutrients: {},
    },
  ]

  await db.profiles.put(profile)
  await db.user_settings.put(settings)
  await db.body_entries.bulkPut(bodyEntries)
  await db.meal_slots.bulkPut(meals)
  await db.food_entries.bulkPut(foods)
}
