import { UserFacingError } from '../../lib/errors'
import { saveRecord } from '../../lib/local-db/local-repository'
import { findBodyEntry } from '../../lib/local-db/tables'
import type { BodyEntry } from '../../types'
import { createBase } from '../../types'

export type BodyMetric = 'weight_kg' | 'calories' | 'steps'

function validateMetric(metric: BodyMetric, value: number | null) {
  if (value === null) return
  const valid =
    metric === 'weight_kg'
      ? value >= 35 && value <= 300
      : metric === 'calories'
        ? value >= 0 && value <= 10_000
        : value >= 0 && value <= 100_000
  if (!Number.isFinite(value) || !valid)
    throw new UserFacingError('Der Körperwert liegt außerhalb des zulässigen Bereichs.')
}

export async function saveBodyMetric({
  userId,
  entryDate,
  metric,
  value,
}: {
  userId: string
  entryDate: string
  metric: BodyMetric
  value: number | null
}) {
  validateMetric(metric, value)
  const current = await findBodyEntry(userId, entryDate)
  const next: BodyEntry = {
    ...(current ?? createBase(userId)),
    entry_date: entryDate,
    weight_kg: metric === 'weight_kg' ? value : (current?.weight_kg ?? null),
    calories: metric === 'calories' ? value : (current?.calories ?? null),
    steps: metric === 'steps' ? value : (current?.steps ?? null),
    deleted_at: null,
  }
  if (next.weight_kg === null && next.calories === null && next.steps === null) {
    next.deleted_at = new Date().toISOString()
  }
  return saveRecord('body_entries', next)
}
