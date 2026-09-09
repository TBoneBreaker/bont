import { describe, expect, it } from 'vitest'
import { onboardingInputSchema } from './validation'

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
})
