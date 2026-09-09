import type { WorkoutSession } from '../../types'

/** Compatibility read for rows created before the explicit entry_date column. */
export function workoutEntryDate(session: Pick<WorkoutSession, 'entry_date' | 'started_at'>) {
  return session.entry_date || session.started_at.slice(0, 10)
}
