import { UserFacingError } from '../../lib/errors'
import { listRecords, saveRecord, saveRecordsAtomically } from '../../lib/local-db/local-repository'
import { dateAtNoon } from '../../lib/date'
import type { Exercise, TrainingDay, TrainingPlan, WorkoutSession, WorkoutSet, RecordWrite } from '../../types'
import { createBase } from '../../types'

export interface ExerciseDraft {
  id: string
  name: string
  targetSets: number
}

export interface DayDraft {
  id: string
  name: string
  exercises: ExerciseDraft[]
}

export async function saveTrainingPlan({ userId, existingPlan, templateMode, name, notes, split, days }: {
  userId: string
  existingPlan?: TrainingPlan
  templateMode: boolean
  name: string
  notes: string
  split: number
  days: DayDraft[]
}) {
  if (name.trim().length < 2 || days.length !== split || days.some((day) => !day.name.trim() || !day.exercises.length || day.exercises.some((exercise) => !exercise.name.trim() || exercise.targetSets < 1))) {
    throw new UserFacingError('Benenne jeden Trainingstag und füge mindestens eine benannte Übung hinzu.')
  }
  const plan: TrainingPlan = {
    ...(existingPlan ?? createBase(userId)),
    name: name.trim(),
    split_size: split,
    notes: notes.trim(),
    is_active: !templateMode,
    is_template: templateMode,
    deleted_at: null,
  }
  const oldDays = existingPlan ? (await listRecords('training_days', userId, true)).filter((day) => day.plan_id === plan.id && !day.deleted_at) : []
  const oldExercises = (await listRecords('exercises', userId, true)).filter((exercise) => oldDays.some((day) => day.id === exercise.training_day_id) && !exercise.deleted_at)
  const writes: RecordWrite[] = []
  if (!templateMode) {
    const activePlans = (await listRecords('training_plans', userId)).filter((item) => item.id !== plan.id && item.is_active && !item.is_template)
    writes.push(...activePlans.map((record) => ({ table: 'training_plans' as const, record: { ...record, is_active: false } })))
  }
  writes.push({ table: 'training_plans', record: plan })
  writes.push(...oldExercises.filter((record) => !days.some((day) => day.exercises.some((exercise) => exercise.id === record.id))).map((record) => ({ table: 'exercises' as const, record: { ...record, deleted_at: new Date().toISOString() } })))
  writes.push(...oldDays.filter((record) => !days.some((day) => day.id === record.id)).map((record) => ({ table: 'training_days' as const, record: { ...record, deleted_at: new Date().toISOString() } })))
  for (const [dayIndex, draftDay] of days.entries()) {
    const oldDay = oldDays.find((day) => day.id === draftDay.id)
    const day: TrainingDay = { ...(oldDay ?? createBase(userId, draftDay.id)), plan_id: plan.id, name: draftDay.name.trim(), order_index: dayIndex, deleted_at: null }
    writes.push({ table: 'training_days', record: day })
    for (const [exerciseIndex, draftExercise] of draftDay.exercises.entries()) {
      const oldExercise = oldExercises.find((exercise) => exercise.id === draftExercise.id)
      const exercise: Exercise = { ...(oldExercise ?? createBase(userId, draftExercise.id)), training_day_id: day.id, name: draftExercise.name.trim(), target_sets: draftExercise.targetSets, order_index: exerciseIndex, deleted_at: null }
      writes.push({ table: 'exercises', record: exercise })
    }
  }
  await saveRecordsAtomically(writes)
  return plan
}

export async function applyTrainingTemplate(userId: string, template: TrainingPlan) {
  const templateDays = (await listRecords('training_days', userId)).filter((day) => day.plan_id === template.id).sort((a, b) => a.order_index - b.order_index)
  const allExercises = await listRecords('exercises', userId)
  const plan: TrainingPlan = { ...createBase(userId), name: template.name, split_size: template.split_size, notes: template.notes, is_active: true, is_template: false }
  const writes: RecordWrite[] = (await listRecords('training_plans', userId)).filter((item) => item.is_active && !item.is_template).map((record) => ({ table: 'training_plans' as const, record: { ...record, is_active: false } }))
  writes.push({ table: 'training_plans', record: plan })
  for (const templateDay of templateDays) {
    const day: TrainingDay = { ...createBase(userId), plan_id: plan.id, name: templateDay.name, order_index: templateDay.order_index }
    writes.push({ table: 'training_days', record: day })
    for (const templateExercise of allExercises.filter((exercise) => exercise.training_day_id === templateDay.id)) {
      writes.push({ table: 'exercises', record: { ...createBase(userId), training_day_id: day.id, name: templateExercise.name, target_sets: templateExercise.target_sets, order_index: templateExercise.order_index } })
    }
  }
  await saveRecordsAtomically(writes)
  return plan
}

export async function startWorkout({ userId, plan, day, exercises, workoutDate }: { userId: string; plan: TrainingPlan; day: TrainingDay; exercises: Exercise[]; workoutDate: string }) {
  const active = (await listRecords('workout_sessions', userId)).find((session) => session.training_day_id === day.id && session.status === 'active')
  if (active) return active
  const completedSessions = (await listRecords('workout_sessions', userId)).filter((session) => session.training_day_id === day.id && session.status === 'completed').sort((a, b) => b.started_at.localeCompare(a.started_at))
  const previousSessionIds = new Set(completedSessions.map((session) => session.id))
  const previousSets = (await listRecords('workout_sets', userId)).filter((set) => previousSessionIds.has(set.session_id))
  const session: WorkoutSession = { ...createBase(userId), training_plan_id: plan.id, training_day_id: day.id, started_at: dateAtNoon(workoutDate), completed_at: null, status: 'active' }
  const writes: RecordWrite[] = [{ table: 'workout_sessions', record: session }]
  for (const exercise of [...exercises].sort((a, b) => a.order_index - b.order_index)) {
    for (let index = 0; index < exercise.target_sets; index += 1) {
      const previous = completedSessions.map((previousSession) => previousSets.find((set) => set.session_id === previousSession.id && set.exercise_id === exercise.id && set.set_number === index + 1)).find(Boolean)
      writes.push({ table: 'workout_sets', record: { ...createBase(userId), session_id: session.id, exercise_id: exercise.id, set_number: index + 1, weight_kg: previous?.weight_kg ?? null, reps: previous?.reps ?? null, is_completed: false } })
    }
  }
  await saveRecordsAtomically(writes)
  return session
}

export async function updateWorkoutSet(set: WorkoutSet, key: 'weight_kg' | 'reps', raw: string) {
  const value = raw === '' ? null : Number(raw)
  if (value !== null && (!Number.isFinite(value) || value < 0 || (key === 'reps' && value > 100) || (key === 'weight_kg' && value > 500))) throw new UserFacingError('Bitte trage einen gültigen Satzwert ein.')
  return saveRecord('workout_sets', { ...set, [key]: value })
}

export async function finishWorkout(session: WorkoutSession) {
  return saveRecord('workout_sessions', { ...session, status: 'completed', completed_at: new Date().toISOString() })
}
