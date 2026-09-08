import { describe, expect, it } from 'vitest'
import { dateAtNoon, localDateString } from './date'

describe('date helpers', () => {
  it('formats date-only values in the local calendar without UTC shifting', () => {
    expect(localDateString(new Date(2026, 8, 8, 23, 45))).toBe('2026-09-08')
  })

  it('creates a stable noon timestamp for date-only display values', () => {
    expect(dateAtNoon('2026-09-08')).toBe('2026-09-08T12:00:00.000Z')
  })
})
