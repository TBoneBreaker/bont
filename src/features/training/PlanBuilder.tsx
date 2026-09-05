import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Dumbbell, Plus, Save, Trash2 } from 'lucide-react'
import { Button, Card, Field, IconButton, ScreenHeader, SelectField, TextareaField } from '../../components/ui'
import { db, saveRecord, softDeleteRecord } from '../../lib/db'
import type { Exercise, TrainingDay, TrainingPlan } from '../../types'
import { createBase, newId } from '../../types'

interface ExerciseDraft {
  id: string
  name: string
  targetSets: number
}

interface DayDraft {
  id: string
  name: string
  exercises: ExerciseDraft[]
}

const defaultDayName = (index: number, split: number) => {
  if (split === 3) return ['Push', 'Pull', 'Beine'][index]
  return `Training ${index + 1}`
}

export function PlanBuilder({
  userId,
  existingPlan,
  templateMode = false,
  onCancel,
  onSaved,
}: {
  userId: string
  existingPlan?: TrainingPlan
  templateMode?: boolean
  onCancel: () => void
  onSaved: (plan: TrainingPlan) => void
}) {
  const [name, setName] = useState(existingPlan?.name ?? (templateMode ? 'Neue Vorlage' : 'Mein Trainingsplan'))
  const [notes, setNotes] = useState(existingPlan?.notes ?? '')
  const [split, setSplit] = useState(existingPlan?.split_size ?? 3)
  const [days, setDays] = useState<DayDraft[]>(() =>
    Array.from({ length: existingPlan?.split_size ?? 3 }, (_, index) => ({
      id: newId(),
      name: defaultDayName(index, existingPlan?.split_size ?? 3),
      exercises: [],
    })),
  )
  const [loading, setLoading] = useState(Boolean(existingPlan))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!existingPlan) return
    let active = true
    async function load() {
      const storedDays = (await db.training_days.where('plan_id').equals(existingPlan!.id).toArray())
        .filter((day) => !day.deleted_at)
        .sort((a, b) => a.order_index - b.order_index)
      const storedExercises = (await db.exercises.where('user_id').equals(userId).toArray()).filter((exercise) => !exercise.deleted_at)
      if (!active) return
      setDays(storedDays.map((day) => ({
        id: day.id,
        name: day.name,
        exercises: storedExercises
          .filter((exercise) => exercise.training_day_id === day.id)
          .sort((a, b) => a.order_index - b.order_index)
          .map((exercise) => ({ id: exercise.id, name: exercise.name, targetSets: exercise.target_sets })),
      })))
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [existingPlan, userId])

  const totalSets = useMemo(() => days.reduce((sum, day) => sum + day.exercises.reduce((daySum, exercise) => daySum + exercise.targetSets, 0), 0), [days])
  const valid = name.trim().length >= 2 && days.every((day) => day.name.trim() && day.exercises.length > 0 && day.exercises.every((exercise) => exercise.name.trim()))

  function changeSplit(next: number) {
    setSplit(next)
    setDays((current) => {
      if (next <= current.length) return current.slice(0, next)
      return [
        ...current,
        ...Array.from({ length: next - current.length }, (_, offset) => ({
          id: newId(),
          name: defaultDayName(current.length + offset, next),
          exercises: [],
        })),
      ]
    })
  }

  function updateDay(dayIndex: number, update: (day: DayDraft) => DayDraft) {
    setDays((current) => current.map((day, index) => index === dayIndex ? update(day) : day))
  }

  function addExercise(dayIndex: number) {
    updateDay(dayIndex, (day) => ({
      ...day,
      exercises: [...day.exercises, { id: newId(), name: '', targetSets: 2 }],
    }))
  }

  function moveExercise(dayIndex: number, exerciseIndex: number, direction: -1 | 1) {
    updateDay(dayIndex, (day) => {
      const target = exerciseIndex + direction
      if (target < 0 || target >= day.exercises.length) return day
      const exercises = [...day.exercises]
      ;[exercises[exerciseIndex], exercises[target]] = [exercises[target], exercises[exerciseIndex]]
      return { ...day, exercises }
    })
  }

  async function save() {
    if (!valid) {
      setError('Benenne jeden Trainingstag und füge mindestens eine benannte Übung hinzu.')
      return
    }
    setSaving(true)
    setError('')
    const base = existingPlan ?? createBase(userId)
    const plan: TrainingPlan = {
      ...base,
      name: name.trim(),
      split_size: split,
      notes: notes.trim(),
      is_active: !templateMode,
      is_template: templateMode,
      deleted_at: null,
    }

    if (!templateMode) {
      const otherPlans = (await db.training_plans.where('user_id').equals(userId).toArray())
        .filter((item) => item.id !== plan.id && item.is_active && !item.deleted_at)
      for (const item of otherPlans) await saveRecord('training_plans', { ...item, is_active: false })
    }

    await saveRecord('training_plans', plan)

    const oldDays = existingPlan ? (await db.training_days.where('plan_id').equals(plan.id).toArray()).filter((item) => !item.deleted_at) : []
    const oldExercises = existingPlan ? (await db.exercises.where('user_id').equals(userId).toArray()).filter((item) => oldDays.some((day) => day.id === item.training_day_id) && !item.deleted_at) : []
    const retainedDayIds = new Set(days.map((day) => day.id))
    const retainedExerciseIds = new Set(days.flatMap((day) => day.exercises.map((exercise) => exercise.id)))

    for (const old of oldExercises.filter((exercise) => !retainedExerciseIds.has(exercise.id))) await softDeleteRecord('exercises', old)
    for (const old of oldDays.filter((day) => !retainedDayIds.has(day.id))) await softDeleteRecord('training_days', old)

    for (const [dayIndex, draftDay] of days.entries()) {
      const oldDay = oldDays.find((item) => item.id === draftDay.id)
      const day: TrainingDay = {
        ...(oldDay ?? createBase(userId, draftDay.id)),
        plan_id: plan.id,
        name: draftDay.name.trim(),
        order_index: dayIndex,
        deleted_at: null,
      }
      await saveRecord('training_days', day)
      for (const [exerciseIndex, draftExercise] of draftDay.exercises.entries()) {
        const oldExercise = oldExercises.find((item) => item.id === draftExercise.id)
        const exercise: Exercise = {
          ...(oldExercise ?? createBase(userId, draftExercise.id)),
          training_day_id: day.id,
          name: draftExercise.name.trim(),
          target_sets: draftExercise.targetSets,
          order_index: exerciseIndex,
          deleted_at: null,
        }
        await saveRecord('exercises', exercise)
      }
    }
    setSaving(false)
    onSaved(plan)
  }

  if (loading) return <div className="center-screen"><p className="muted">Plan wird geladen …</p></div>

  return (
    <div className="subview">
      <ScreenHeader title={templateMode ? 'Vorlage erstellen' : existingPlan ? 'Plan bearbeiten' : 'Plan erstellen'} onBack={onCancel} />
      <main className="content content--narrow">
        <Card className="stack">
          <Field label="Name des Plans" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
          <SelectField label="Split" value={split} onChange={(event) => changeSplit(Number(event.target.value))}>
            {Array.from({ length: 7 }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1}er-Split</option>)}
          </SelectField>
          <div className="row row--between"><span className="muted small">Gesamtvolumen</span><strong>{totalSets} Sätze</strong></div>
        </Card>

        {days.map((day, dayIndex) => (
          <Card className="stack" key={day.id}>
            <div className="card__row">
              <div className="row"><span className="day-number">{dayIndex + 1}</span><h2 style={{ margin: 0 }}>Trainingstag</h2></div>
              <span className="pill">{day.exercises.reduce((sum, exercise) => sum + exercise.targetSets, 0)} Sätze</span>
            </div>
            <Field label="Name" placeholder={defaultDayName(dayIndex, split)} value={day.name} onChange={(event) => updateDay(dayIndex, (current) => ({ ...current, name: event.target.value }))} />

            <div className="stack stack--tight">
              {day.exercises.map((exercise, exerciseIndex) => (
                <div className="exercise-draft" key={exercise.id}>
                  <div className="exercise-draft__top">
                    <Dumbbell size={17} />
                    <input
                      className="exercise-name-input"
                      aria-label={`Übung ${exerciseIndex + 1}`}
                      placeholder="z. B. Trizeps Extension"
                      value={exercise.name}
                      onChange={(event) => updateDay(dayIndex, (current) => ({
                        ...current,
                        exercises: current.exercises.map((item, index) => index === exerciseIndex ? { ...item, name: event.target.value } : item),
                      }))}
                    />
                    <IconButton label="Übung entfernen" onClick={() => updateDay(dayIndex, (current) => ({ ...current, exercises: current.exercises.filter((_, index) => index !== exerciseIndex) }))}><Trash2 size={17} /></IconButton>
                  </div>
                  <div className="exercise-draft__bottom">
                    <label><span>Sätze</span><input className="mini-input" type="number" min="1" max="10" value={exercise.targetSets} onChange={(event) => updateDay(dayIndex, (current) => ({ ...current, exercises: current.exercises.map((item, index) => index === exerciseIndex ? { ...item, targetSets: Math.min(10, Math.max(1, Number(event.target.value))) } : item) }))} /></label>
                    <div className="row">
                      <IconButton label="Nach oben" disabled={exerciseIndex === 0} onClick={() => moveExercise(dayIndex, exerciseIndex, -1)}><ChevronUp size={17} /></IconButton>
                      <IconButton label="Nach unten" disabled={exerciseIndex === day.exercises.length - 1} onClick={() => moveExercise(dayIndex, exerciseIndex, 1)}><ChevronDown size={17} /></IconButton>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="secondary" full onClick={() => addExercise(dayIndex)}><Plus size={18} /> Übung hinzufügen</Button>
          </Card>
        ))}

        <Card><TextareaField label="Notizen zum Plan" value={notes} onChange={setNotes} placeholder="Optional: Fokus, Pausenzeiten oder Hinweise …" /></Card>
        {error && <p className="small" role="alert" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
        <Button full disabled={saving} onClick={() => void save()}><Save size={18} /> {saving ? 'Wird gespeichert …' : templateMode ? 'Vorlage speichern' : 'Trainingsplan speichern'}</Button>
      </main>
    </div>
  )
}
