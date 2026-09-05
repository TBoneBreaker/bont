import { db } from './db'
import { DEMO_USER_ID } from './demo-constants'
import { createBase } from '../types'
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

const dateOffset = (days: number) => {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

const atNoon = (date: string) => `${date}T12:00:00.000Z`

let seedPromise: Promise<void> | null = null

export function seedDemoData() {
  if (!seedPromise) seedPromise = runSeedDemoData()
  return seedPromise
}

async function runSeedDemoData() {
  const [existingProfile, existingPlan, existingFood] = await Promise.all([
    db.profiles.where('user_id').equals(DEMO_USER_ID).first(),
    db.training_plans.get('demo-plan-ppl'),
    db.food_entries.get('demo-food-skyr'),
  ])
  if (existingProfile && existingPlan && existingFood) return

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
  const plan: TrainingPlan = {
    ...createBase(DEMO_USER_ID, 'demo-plan-ppl'),
    name: 'Push Pull Legs',
    split_size: 3,
    notes: 'Fokus auf saubere Technik und progressive Steigerung.',
    is_active: true,
    is_template: false,
  }
  const days: TrainingDay[] = [
    { ...createBase(DEMO_USER_ID, 'demo-day-push'), plan_id: plan.id, name: 'Push', order_index: 0 },
    { ...createBase(DEMO_USER_ID, 'demo-day-pull'), plan_id: plan.id, name: 'Pull', order_index: 1 },
    { ...createBase(DEMO_USER_ID, 'demo-day-legs'), plan_id: plan.id, name: 'Legs', order_index: 2 },
  ]
  const exercises: Exercise[] = [
    { ...createBase(DEMO_USER_ID, 'demo-ex-bench'), training_day_id: days[0].id, name: 'Bankdrücken', target_sets: 3, order_index: 0 },
    { ...createBase(DEMO_USER_ID, 'demo-ex-shoulder'), training_day_id: days[0].id, name: 'Schulterdrücken', target_sets: 2, order_index: 1 },
    { ...createBase(DEMO_USER_ID, 'demo-ex-triceps'), training_day_id: days[0].id, name: 'Trizeps Extension', target_sets: 2, order_index: 2 },
    { ...createBase(DEMO_USER_ID, 'demo-ex-pulldown'), training_day_id: days[1].id, name: 'Latzug', target_sets: 3, order_index: 0 },
    { ...createBase(DEMO_USER_ID, 'demo-ex-row'), training_day_id: days[1].id, name: 'Rudern', target_sets: 3, order_index: 1 },
    { ...createBase(DEMO_USER_ID, 'demo-ex-curl'), training_day_id: days[1].id, name: 'Bizeps Curls', target_sets: 2, order_index: 2 },
    { ...createBase(DEMO_USER_ID, 'demo-ex-squat'), training_day_id: days[2].id, name: 'Kniebeugen', target_sets: 3, order_index: 0 },
    { ...createBase(DEMO_USER_ID, 'demo-ex-legcurl'), training_day_id: days[2].id, name: 'Beinbeuger', target_sets: 3, order_index: 1 },
  ]

  const sessionDates = [-18, -11, -4].map(dateOffset)
  const sessions: WorkoutSession[] = sessionDates.map((date, index) => ({
    ...createBase(DEMO_USER_ID, `demo-session-${index + 1}`),
    training_plan_id: plan.id,
    training_day_id: days[0].id,
    started_at: atNoon(date),
    completed_at: `${date}T13:05:00.000Z`,
    status: 'completed',
  }))
  const weights = [80, 82.5, 85]
  const workoutSets: WorkoutSet[] = sessions.flatMap((session, sessionIndex) => [
    {
      ...createBase(DEMO_USER_ID, `demo-set-${sessionIndex + 1}-1`),
      session_id: session.id,
      exercise_id: 'demo-ex-bench',
      set_number: 1,
      weight_kg: weights[sessionIndex],
      reps: 7,
      is_completed: true,
    },
    {
      ...createBase(DEMO_USER_ID, `demo-set-${sessionIndex + 1}-2`),
      session_id: session.id,
      exercise_id: 'demo-ex-bench',
      set_number: 2,
      weight_kg: weights[sessionIndex],
      reps: 6,
      is_completed: true,
    },
    {
      ...createBase(DEMO_USER_ID, `demo-set-${sessionIndex + 1}-3`),
      session_id: session.id,
      exercise_id: 'demo-ex-bench',
      set_number: 3,
      weight_kg: weights[sessionIndex],
      reps: 5,
      is_completed: true,
    },
  ])

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
  await db.training_plans.put(plan)
  await db.training_days.bulkPut(days)
  await db.exercises.bulkPut(exercises)
  await db.workout_sessions.bulkPut(sessions)
  await db.workout_sets.bulkPut(workoutSets)
  await db.body_entries.bulkPut(bodyEntries)
  await db.meal_slots.bulkPut(meals)
  await db.food_entries.bulkPut(foods)
}
