import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../lib/db'

export function useWorkoutData(userId: string, sessionId: string) {
  const session = useLiveQuery(async () => {
    const value = await db.workout_sessions.get(sessionId)
    return value?.user_id === userId ? value : undefined
  }, [sessionId, userId])
  const day = useLiveQuery(async () => {
    if (!session) return undefined
    const value = await db.training_days.get(session.training_day_id)
    return value?.user_id === userId ? value : undefined
  }, [session?.training_day_id, userId])
  const exercises = useLiveQuery(
    async () =>
      session
        ? (await db.exercises.where('training_day_id').equals(session.training_day_id).toArray())
            .filter((item) => item.user_id === userId && !item.deleted_at)
            .sort((a, b) => a.order_index - b.order_index)
        : [],
    [session?.training_day_id, userId],
    [],
  )
  const sets = useLiveQuery(
    async () =>
      (await db.workout_sets.where('session_id').equals(sessionId).toArray())
        .filter((item) => item.user_id === userId && !item.deleted_at)
        .sort((a, b) => a.set_number - b.set_number),
    [sessionId, userId],
    [],
  )
  return { session, day, exercises, sets }
}

export function useExerciseProgressData(userId: string, exerciseId: string | undefined) {
  const sessions = useLiveQuery(
    async () =>
      (await db.workout_sessions.where('user_id').equals(userId).toArray())
        .filter((item) => item.status === 'completed' && !item.deleted_at)
        .sort((a, b) => a.started_at.localeCompare(b.started_at)),
    [userId],
    [],
  )
  const allSets = useLiveQuery(
    async () =>
      exerciseId
        ? (await db.workout_sets.where('exercise_id').equals(exerciseId).toArray()).filter(
            (item) => item.user_id === userId && !item.deleted_at && item.is_completed,
          )
        : [],
    [exerciseId, userId],
    [],
  )
  return sessions
    .map((session) => ({
      session,
      sets: allSets.filter((set) => set.session_id === session.id && set.weight_kg !== null),
    }))
    .filter((item) => item.sets.length > 0)
    .slice(-10)
}
