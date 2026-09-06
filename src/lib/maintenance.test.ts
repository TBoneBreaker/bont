import { describe, expect, it } from 'vitest'
import type { BodyEntry } from '../types'
import { createBase } from '../types'
import { estimateMaintenance, preliminaryMaintenance, weeklyAverages } from './maintenance'

const entry = (day: number, weight: number, calories = 2500): BodyEntry => ({
  ...createBase('user', `entry-${day}`),
  entry_date: `2026-09-${String(day).padStart(2, '0')}`,
  weight_kg: weight,
  calories,
  steps: 10_000,
})

describe('maintenance estimation', () => {
  it('waits for seven complete days', () => {
    expect(estimateMaintenance([entry(1, 90)]).maintenance).toBeNull()
  })

  it('ignores partial days without losing their individual values', () => {
    const partial: BodyEntry[] = [
      { ...entry(1, 90), calories: null, steps: null },
      { ...entry(2, 90), weight_kg: null, steps: 12_000 },
    ]
    expect(estimateMaintenance(partial).days).toBe(0)
    expect(weeklyAverages(partial).current).toBeNull()
  })

  it('returns average calories when weight is stable', () => {
    const rows = Array.from({ length: 14 }, (_, index) => entry(index + 1, 90, 2400))
    expect(estimateMaintenance(rows).maintenance).toBe(2400)
  })

  it('subtracts the estimated surplus during weight gain', () => {
    const rows = Array.from({ length: 14 }, (_, index) => entry(index + 1, 90 + index * 0.01, 2800))
    expect(estimateMaintenance(rows).maintenance).toBeCloseTo(2720, -1)
  })

  it('compares two seven-entry windows', () => {
    const rows = Array.from({ length: 14 }, (_, index) => entry(index + 1, index < 7 ? 90 : 90.2))
    expect(weeklyAverages(rows).change).toBeCloseTo(0.2)
  })

  it('creates a plausible preliminary estimate', () => {
    expect(preliminaryMaintenance({ sex: 'male', birthDate: '2005-09-26', heightCm: 193, weightKg: 90, activityLevel: 'high' })).toBeGreaterThan(3000)
  })
})
