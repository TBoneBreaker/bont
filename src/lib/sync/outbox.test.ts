import { beforeEach, describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { createBase, type MealSlot } from '../../types'
import { BontDatabase, db } from '../local-db/schema'
import { saveRecord, saveRecordsAtomically } from '../local-db/local-repository'
import { acknowledge, countOutbox, listDueOutbox, markFailed, markProcessing, recoverProcessing } from './outbox'

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

  it('does not let an older request overwrite a newer local edit', async () => {
    const first: MealSlot = { ...createBase(userId), name: 'Erste Fassung', order_index: 0 }
    await saveRecord('meal_slots', first, true)
    const queued = (await db.outbox.get(`meal_slots:${first.id}`))!
    const second = await saveRecord('meal_slots', { ...first, name: 'Zweite Fassung' }, true)

    expect(await markProcessing(queued)).toBe(false)
    await acknowledge(queued)
    expect(await db.outbox.get(`meal_slots:${first.id}`)).toMatchObject({ payload: second, status: 'pending' })
  })

  it('migrates legacy outbox rows with durable processing fields', async () => {
    const name = `bont-migration-${Date.now()}`
    const legacy = new Dexie(name)
    legacy.version(1).stores({ outbox: '&key,table,record_id,created_at' })
    await legacy.open()
    await legacy.table('outbox').put({
      key: 'meal_slots:legacy',
      table: 'meal_slots',
      record_id: 'legacy',
      operation: 'upsert',
      payload: { ...createBase(userId), name: 'Alt', order_index: 0 },
      created_at: '2026-01-01T00:00:00.000Z',
    })
    legacy.close()

    const migrated = new BontDatabase(name)
    await migrated.open()
    expect(await migrated.outbox.get('meal_slots:legacy')).toMatchObject({ user_id: userId, status: 'pending', retry_count: 0 })
    await migrated.delete()
  })
})
