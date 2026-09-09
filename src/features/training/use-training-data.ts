import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../lib/db'

export function useTrainingData(userId: string) {
  const plans = useLiveQuery(() => db.training_plans.where('user_id').equals(userId).toArray(), [userId], []).filter(
    (plan) => !plan.deleted_at,
  )
  const activePlan = plans.find((plan) => plan.is_active && !plan.is_template)
  const templates = plans.filter((plan) => plan.is_template)
  const days = useLiveQuery(
    async () =>
      activePlan
        ? (await db.training_days.where('plan_id').equals(activePlan.id).toArray())
            .filter((day) => day.user_id === userId && !day.deleted_at)
            .sort((a, b) => a.order_index - b.order_index)
        : [],
    [activePlan?.id, userId],
    [],
  )
  const exercises = useLiveQuery(
    async () =>
      (await db.exercises.where('user_id').equals(userId).toArray()).filter((exercise) => !exercise.deleted_at),
    [userId],
    [],
  )
  const activeSessions = useLiveQuery(
    async () =>
      (await db.workout_sessions.where('user_id').equals(userId).toArray()).filter(
        (session) => !session.deleted_at && session.status === 'active',
      ),
    [userId],
    [],
  )
  return { plans, activePlan, templates, days, exercises, activeSessions }
}
