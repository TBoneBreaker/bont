import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBase, type MealSlot } from '../../types'
import { supabase } from '../supabase'
import { db } from '../local-db/schema'
import { saveRecord } from '../local-db/local-repository'
import { syncUser } from './sync-engine'

const userId = 'sync-engine-test-user'

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
})

function mockSupabase(remoteRows: Record<string, unknown[]>) {
  vi.spyOn(supabase, 'from').mockImplementation((table) => {
    let pushed: unknown = null
    const query = {
      upsert(payload: unknown) {
        pushed = payload
        return query
      },
      select() { return query },
      maybeSingle() { return Promise.resolve({ data: pushed, error: null }) },
      eq() { return query },
      order() { return query },
      range() { return query },
      or() { return query },
      then(resolve: (value: { data: unknown[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve({ data: remoteRows[table] ?? [], error: null }).then(resolve, reject)
      },
    }
    return query as never
  })
}

describe('sync engine transport', () => {
  it('pushes queued records and stores the server response locally', async () => {
    const meal: MealSlot = { ...createBase(userId), name: 'Lokal', order_index: 0 }
    const serverMeal = { ...meal, name: 'Server', updated_at: '2099-01-03T00:00:00.000Z' }
    const originalOnline = navigator.onLine
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await saveRecord('meal_slots', meal)
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    mockSupabase({ meal_slots: [serverMeal] })

    const result = await syncUser(userId, { full: true })

    expect(result.pushed).toBe(1)
    expect(result.pending).toBe(0)
    expect(await db.meal_slots.get(meal.id)).toMatchObject({ name: 'Server', updated_at: serverMeal.updated_at })
    expect(await db.outbox.get(`meal_slots:${meal.id}`)).toBeUndefined()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: originalOnline })
    vi.restoreAllMocks()
  })

  it('pulls remote rows without allowing an older remote row to replace newer local data', async () => {
    const meal: MealSlot = { ...createBase(userId), name: 'Lokal', order_index: 0, updated_at: '2026-01-04T00:00:00.000Z' }
    await saveRecord('meal_slots', meal, false)
    mockSupabase({ meal_slots: [{ ...meal, name: 'Alt', updated_at: '2026-01-03T00:00:00.000Z' }] })

    const result = await syncUser(userId, { full: true })

    expect(result.pulled).toBe(0)
    expect(await db.meal_slots.get(meal.id)).toMatchObject({ name: 'Lokal' })
    vi.restoreAllMocks()
  })
})
