import { describe, expect, it } from 'vitest'
import { calculateNiceAxis, formatAxisTick } from './nice-axis'

describe('nice body chart axes', () => {
  it('uses whole kilograms for a normal weight range', () => {
    const axis = calculateNiceAxis({ min: 90.8, max: 92.1, metric: 'weight' })
    expect(axis.step).toBe(1)
    expect(axis.ticks).toEqual([90, 91, 92, 93])
    expect(axis.ticks.every((tick) => Number.isInteger(tick))).toBe(true)
  })

  it('uses readable calorie steps and includes padded bounds', () => {
    const axis = calculateNiceAxis({ min: 2200, max: 3100, metric: 'calories' })
    expect(axis.step).toBe(500)
    expect(axis.ticks).toEqual([2000, 2500, 3000, 3500])

    const targetAboveActual = calculateNiceAxis({ min: 2500, max: 3200, metric: 'calories' })
    expect(targetAboveActual.max).toBeGreaterThanOrEqual(3200)
  })

  it('uses readable steps for activity values', () => {
    const axis = calculateNiceAxis({ min: 8000, max: 13000, metric: 'steps' })
    expect(axis.step).toBe(2000)
    expect(axis.ticks).toEqual([6000, 8000, 10000, 12000, 14000])
  })

  it('handles one value, identical values, tiny ranges, large ranges and no data', () => {
    expect(calculateNiceAxis({ min: 90, max: 90, metric: 'weight' }).ticks.length).toBeGreaterThanOrEqual(3)
    expect(calculateNiceAxis({ min: 90.1, max: 90.3, metric: 'weight' }).step).toBe(0.5)
    expect(calculateNiceAxis({ min: 0, max: 1_000_000, metric: 'calories' }).step).toBeGreaterThanOrEqual(100)
    expect(calculateNiceAxis({ min: Number.NaN, max: 10, metric: 'steps' })).toEqual({
      min: 0,
      max: 1,
      step: 1,
      ticks: [0, 1],
    })
  })

  it('only shows weight decimals when the chosen step needs them', () => {
    expect(formatAxisTick(90, 'weight', 1)).toBe('90')
    expect(formatAxisTick(90.5, 'weight', 0.5)).toBe('90,5')
  })
})
