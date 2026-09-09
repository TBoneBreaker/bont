import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Dumbbell, Minus, Plus, Save, Trash2 } from 'lucide-react'
import { Button, Card, Field, IconButton, ScreenHeader, SelectField, TextareaField } from '../../components/ui'
import type { TrainingPlan } from '../../types'
import { newId } from '../../types'
import { saveTrainingPlan } from './commands'
import { usePlanBuilderData } from './use-plan-builder-data'

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

interface PlanBuilderProps {
  userId: string
  existingPlan?: TrainingPlan
  templateMode?: boolean
  onCancel: () => void
  onSaved: (plan: TrainingPlan) => void
}

export function PlanBuilder(props: PlanBuilderProps) {
  const planData = usePlanBuilderData(props.userId, props.existingPlan?.id)
  if (props.existingPlan && !planData) return <div className="center-screen"><p className="muted">Plan wird geladen …</p></div>
  return <PlanBuilderEditor {...props} initialDays={planData ?? undefined} />
}

function PlanBuilderEditor({
  userId,
  existingPlan,
  templateMode = false,
  onCancel,
  onSaved,
  initialDays,
}: {
  userId: string
  existingPlan?: TrainingPlan
  templateMode?: boolean
  onCancel: () => void
  onSaved: (plan: TrainingPlan) => void
  initialDays?: DayDraft[]
}) {
  const [name, setName] = useState(existingPlan?.name ?? (templateMode ? 'Neue Vorlage' : 'Mein Trainingsplan'))
  const [notes, setNotes] = useState(existingPlan?.notes ?? '')
  const [split, setSplit] = useState(existingPlan?.split_size ?? 3)
  const [days, setDays] = useState<DayDraft[]>(() => initialDays ??
    Array.from({ length: existingPlan?.split_size ?? 3 }, (_, index) => ({
      id: newId(),
      name: defaultDayName(index, existingPlan?.split_size ?? 3),
      exercises: [],
    })),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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

  function changeTargetSets(dayIndex: number, exerciseIndex: number, change: -1 | 1) {
    updateDay(dayIndex, (day) => ({
      ...day,
      exercises: day.exercises.map((exercise, index) => index === exerciseIndex
        ? { ...exercise, targetSets: Math.min(10, Math.max(1, exercise.targetSets + change)) }
        : exercise),
    }))
  }

  async function save() {
    if (!valid) {
      setError('Benenne jeden Trainingstag und füge mindestens eine benannte Übung hinzu.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const plan = await saveTrainingPlan({ userId, existingPlan, templateMode, name, notes, split, days })
      onSaved(plan)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Der Trainingsplan konnte nicht gespeichert werden.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="subview">
      <ScreenHeader title={templateMode ? 'Vorlage erstellen' : existingPlan ? 'Plan bearbeiten' : 'Plan erstellen'} onBack={onCancel} />
      <main className="content content--narrow">
        <Card className="stack">
          <Field label="Name des Plans" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
          <SelectField label="Split" value={split} onChange={(event) => changeSplit(Number(event.target.value))}>
            {Array.from({ length: 7 }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1}er-Split</option>)}
          </SelectField>
          <div className="row row--between"><span className="muted small">Sätze im gesamten Plan</span><strong>{totalSets} Sätze</strong></div>
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
                    <div className="set-counter">
                      <span>Sätze</span>
                      <button type="button" aria-label={`Sätze für ${exercise.name || `Übung ${exerciseIndex + 1}`} verringern`} disabled={exercise.targetSets <= 1} onClick={() => changeTargetSets(dayIndex, exerciseIndex, -1)}><Minus size={16} /></button>
                      <strong>{exercise.targetSets}</strong>
                      <button type="button" aria-label={`Sätze für ${exercise.name || `Übung ${exerciseIndex + 1}`} erhöhen`} disabled={exercise.targetSets >= 10} onClick={() => changeTargetSets(dayIndex, exerciseIndex, 1)}><Plus size={16} /></button>
                    </div>
                    <div className="row">
                      <IconButton label="Nach oben" disabled={exerciseIndex === 0} onClick={() => moveExercise(dayIndex, exerciseIndex, -1)}><ChevronUp size={17} /></IconButton>
                      <IconButton label="Nach unten" disabled={exerciseIndex === day.exercises.length - 1} onClick={() => moveExercise(dayIndex, exerciseIndex, 1)}><ChevronDown size={17} /></IconButton>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="secondary" full onClick={() => addExercise(dayIndex)}><Plus size={18} /> Übung hinzufügen</Button>
            <div className="day-volume-summary">
              <div><span>Gesamtvolumen</span><small>{day.name.trim() || `Training ${dayIndex + 1}`}</small></div>
              <strong>{day.exercises.reduce((sum, exercise) => sum + exercise.targetSets, 0)} Sätze</strong>
            </div>
          </Card>
        ))}

        <Card><TextareaField label="Notizen zum Plan" value={notes} onChange={setNotes} placeholder="Optional: Fokus, Pausenzeiten oder Hinweise …" /></Card>
        {error && <p className="small" role="alert" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
        <Button full disabled={saving} onClick={() => void save()}><Save size={18} /> {saving ? 'Wird gespeichert …' : templateMode ? 'Vorlage speichern' : 'Trainingsplan speichern'}</Button>
      </main>
    </div>
  )
}
