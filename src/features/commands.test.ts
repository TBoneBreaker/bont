import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../lib/local-db/schema'
import { completeOnboarding } from './onboarding/commands'
import { deleteMeal } from './nutrition/commands'
import { saveBodyMetric } from './body/commands'
import { startWorkout } from './training/commands'
import { createBase, type Exercise, type FoodEntry, type MealSlot, type TrainingDay, type TrainingPlan } from '../types'
import { saveRecord } from '../lib/local-db/local-repository'

const userId = 'command-test-user'

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('application commands', () => {
  it('completes onboarding in one local transaction', async () => {
    const profile = await completeOnboarding(userId, {
      displayName: 'Test',
      birthDate: '1990-01-01',
      sex: 'male',
      heightCm: 180,
      weightKg: 80,
      activityLevel: 'moderate',
      bodyFatCategory: 'athletic',
    })

    expect(profile.onboarding_completed).toBe(true)
    expect(await db.profiles.get(profile.id)).toBeTruthy()
    expect(await db.user_settings.where('user_id').equals(userId).count()).toBe(1)
    expect(await db.meal_slots.where('user_id').equals(userId).count()).toBe(4)
    expect(await db.body_entries.where('user_id').equals(userId).count()).toBe(1)
  })

  it('soft-deletes a meal and its food entries without hard cascading', async () => {
    const meal: MealSlot = { ...createBase(userId), name: 'Mittag', order_index: 0 }
    const food: FoodEntry = {
      ...createBase(userId),
      meal_slot_id: meal.id,
      entry_date: '2026-01-01',
      name: 'Reis',
      brand: '',
      amount: 100,
      unit: 'g',
      calories: 350,
      protein_g: 7,
      carbs_g: 77,
      fat_g: 1,
      micronutrients: {},
    }
    await saveRecord('meal_slots', meal, false)
    await saveRecord('food_entries', food, false)
    await deleteMeal(userId, meal)

    expect((await db.meal_slots.get(meal.id))?.deleted_at).toBeTruthy()
    expect((await db.food_entries.get(food.id))?.deleted_at).toBeTruthy()
  })

  it('keeps body metrics independent and soft-deletes empty entries', async () => {
    await saveBodyMetric({ userId, entryDate: '2026-01-01', metric: 'weight_kg', value: 80 })
    await saveBodyMetric({ userId, entryDate: '2026-01-01', metric: 'calories', value: 2400 })
    await saveBodyMetric({ userId, entryDate: '2026-01-01', metric: 'weight_kg', value: null })
    const current = await db.body_entries.where('entry_date').equals('2026-01-01').first()
    expect(current).toMatchObject({ weight_kg: null, calories: 2400, deleted_at: null })
    await saveBodyMetric({ userId, entryDate: '2026-01-01', metric: 'calories', value: null })
    expect((await db.body_entries.get(current!.id))?.deleted_at).toBeTruthy()
  })

  it('creates a workout session and all sets atomically', async () => {
    const plan: TrainingPlan = {
      ...createBase(userId),
      name: 'Plan',
      split_size: 1,
      notes: '',
      is_active: true,
      is_template: false,
    }
    const day: TrainingDay = { ...createBase(userId), plan_id: plan.id, name: 'Ganzkörper', order_index: 0 }
    const exercise: Exercise = {
      ...createBase(userId),
      training_day_id: day.id,
      name: 'Kniebeuge',
      target_sets: 2,
      order_index: 0,
    }
    await saveRecord('training_plans', plan, false)
    await saveRecord('training_days', day, false)
    await saveRecord('exercises', exercise, false)
    const session = await startWorkout({ userId, plan, day, exercises: [exercise], workoutDate: '2026-01-01' })

    expect(await db.workout_sessions.get(session.id)).toMatchObject({ status: 'active', user_id: userId })
    expect(await db.workout_sets.where('session_id').equals(session.id).count()).toBe(2)
  })
})
