import { describe, expect, it } from 'vitest'
import { onboardingInputSchema, parseRemoteRecord } from './validation'

describe('onboardingInputSchema', () => {
  it('accepts the supported domain values', () => {
    const result = onboardingInputSchema.safeParse({
      displayName: 'Bont',
      birthDate: '1990-02-03',
      sex: 'female',
      heightCm: 170,
      weightKg: 68.5,
      activityLevel: 'moderate',
      bodyFatCategory: 'fit',
    })

    expect(result.success).toBe(true)
  })

  it('rejects unsafe physical input at the boundary', () => {
    const result = onboardingInputSchema.safeParse({
      displayName: 'A',
      birthDate: 'not-a-date',
      sex: 'other',
      heightCm: 400,
      weightKg: -1,
      activityLevel: 'unknown',
      bodyFatCategory: 'unknown',
    })

    expect(result.success).toBe(false)
  })

  it('rejects remote rows for another user or with invalid timestamps', () => {
    const row = { id: 'row-1', user_id: 'user-1', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null }
    expect(() => parseRemoteRecord(row, 'user-2')).toThrow('Cloud-Datensatz')
    expect(() => parseRemoteRecord({ ...row, updated_at: 'not-a-date' }, 'user-1')).toThrow()
  })
})
