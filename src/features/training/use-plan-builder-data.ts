import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../lib/db'

export function usePlanBuilderData(userId: string, planId: string | undefined) {
  return useLiveQuery(async () => {
    if (!planId) return null
    const storedDays = (await db.training_days.where('plan_id').equals(planId).toArray())
      .filter((day) => day.user_id === userId && !day.deleted_at)
      .sort((a, b) => a.order_index - b.order_index)
    const storedExercises = (await db.exercises.where('user_id').equals(userId).toArray()).filter((exercise) => !exercise.deleted_at)
    return storedDays.map((day) => ({
      id: day.id,
      name: day.name,
      exercises: storedExercises
        .filter((exercise) => exercise.training_day_id === day.id)
        .sort((a, b) => a.order_index - b.order_index)
        .map((exercise) => ({ id: exercise.id, name: exercise.name, targetSets: exercise.target_sets })),
    }))
  }, [planId, userId])
}
