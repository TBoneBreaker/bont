import { describe, expect, it } from 'vitest'
import { calculateCalorieTarget, calorieTargetForDate } from './calorie-target'
import { createBase, type BodyEntry, type GoalSettingsHistory, type UserSettings } from '../types'

const settings = (goal_mode: UserSettings['goal_mode'], calorie_adjustment: number): UserSettings => ({
  ...createBase('user'),
  theme: 'system',
  goal_mode,
  calorie_adjustment,
  preliminary_maintenance: 2800,
})

describe('calorie target calculation', () => {
  it.each([
    ['maintain', 0, 2800],
    ['cut', 500, 2300],
    ['bulk', 300, 3100],
  ] as const)('calculates %s from maintenance and adjustment', (mode, adjustment, expected) => {
    expect(calculateCalorieTarget(2800, settings(mode, adjustment))).toBe(expected)
  })

  it('does not fabricate a target for an old date without known history', () => {
    expect(
      calorieTargetForDate({ date: '2026-09-01', entries: [], settings: settings('bulk', 300), history: [] }),
    ).toBeNull()
  })

  it('uses the effective historical goal snapshot for a date', () => {
    const history: GoalSettingsHistory[] = [
      { ...createBase('user'), effective_from: '2026-09-01', goal_mode: 'maintain', calorie_adjustment: 0 },
      { ...createBase('user'), effective_from: '2026-09-11', goal_mode: 'bulk', calorie_adjustment: 300 },
    ]
    const entries: BodyEntry[] = Array.from({ length: 7 }, (_, index) => ({
      ...createBase('user', `body-${index}`),
      entry_date: `2026-09-${String(index + 1).padStart(2, '0')}`,
      weight_kg: 90,
      calories: 2800,
      steps: null,
    }))
    expect(calorieTargetForDate({ date: '2026-09-10', entries, settings: settings('bulk', 300), history })).toBe(2800)
    expect(calorieTargetForDate({ date: '2026-09-11', entries, settings: settings('bulk', 300), history })).toBe(3100)
  })
})
