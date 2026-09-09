import { beforeEach, describe, expect, it } from 'vitest'
import { createBase, type MealSlot } from '../../types'
import { db } from '../local-db/schema'
import { saveRecord, saveRecordsAtomically } from '../local-db/local-repository'
import { countOutbox, listDueOutbox, markFailed, markProcessing, recoverProcessing } from './outbox'

const userId = 'outbox-test-user'

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('durable outbox', () => {
  it('writes the local record and its outbox item together', async () => {
    const meal: MealSlot = { ...createBase(userId), name: 'Frühstück', order_index: 0 }
    await saveRecord('meal_slots', meal, true)

    expect(await db.meal_slots.get(meal.id)).toMatchObject({ name: 'Frühstück' })
    expect(await db.outbox.get(`meal_slots:${meal.id}`)).toMatchObject({ status: 'pending', retry_count: 0, user_id: userId })
    expect((await listDueOutbox(userId)).map((item) => item.record_id)).toEqual([meal.id])
  })

  it('supports atomic multi-record writes', async () => {
    const writes = [0, 1].map((index) => ({
      table: 'meal_slots' as const,
      record: { ...createBase(userId), name: `Mahlzeit ${index + 1}`, order_index: index },
    }))
    await saveRecordsAtomically(writes)
    expect(await db.meal_slots.where('user_id').equals(userId).count()).toBe(2)
    expect((await countOutbox(userId)).pending).toBe(2)
  })

  it('recovers interrupted work and dead-letters a poison record', async () => {
    const meal: MealSlot = { ...createBase(userId), name: 'Fehler', order_index: 0 }
    await saveRecord('meal_slots', meal, true)
    const item = (await db.outbox.get(`meal_slots:${meal.id}`))!
    await markProcessing(item)
    await recoverProcessing(userId)
    expect((await db.outbox.get(item.key))?.status).toBe('failed')

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await markFailed(item, new Error('poison'))
    }
    expect((await db.outbox.get(item.key))?.status).toBe('dead_letter')
    expect((await countOutbox(userId)).deadLetter).toBe(1)
  })
})
