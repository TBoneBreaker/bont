import { useMemo, useState } from 'react'
import { BarChart3, CalendarDays, Check, CheckCircle2, Circle, RotateCcw } from 'lucide-react'
import { Button, Card, IconButton, NumberStepper, ScreenHeader } from '../../components/ui'
import { localDateString } from '../../lib/date'
import { getUserMessage } from '../../lib/errors'
import type { Exercise, WorkoutSet } from '../../types'
import { changeWorkoutDate, completeExercise, finishWorkout, updateWorkoutSet } from './commands'
import { ExerciseProgressModal } from './ExerciseProgressModal'
import { useWorkoutData } from './use-workout-data'

const today = localDateString

export function WorkoutView({ userId, sessionId, onExit }: { userId: string; sessionId: string; onExit: () => void }) {
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [progressExercise, setProgressExercise] = useState<Exercise | null>(null)
  const { session, day, exercises, sets } = useWorkoutData(userId, sessionId)

  const completeExerciseIds = useMemo(
    () =>
      new Set(
        exercises
          .filter((exercise) => {
            const exerciseSets = sets.filter((set) => set.exercise_id === exercise.id)
            return exerciseSets.length > 0 && exerciseSets.every((set) => set.is_completed)
          })
          .map((exercise) => exercise.id),
      ),
    [exercises, sets],
  )
  const orderedExercises = useMemo(
    () => [
      ...exercises.filter((exercise) => !completeExerciseIds.has(exercise.id)),
      ...exercises.filter((exercise) => completeExerciseIds.has(exercise.id)),
    ],
    [exercises, completeExerciseIds],
  )

  const resolvedSelectedExerciseId =
    selectedExerciseId && exercises.some((exercise) => exercise.id === selectedExerciseId)
      ? selectedExerciseId
      : (exercises.find((exercise) => !completeExerciseIds.has(exercise.id))?.id ?? exercises[0]?.id)

  const allDone = exercises.length > 0 && exercises.every((exercise) => completeExerciseIds.has(exercise.id))

  async function updateSet(set: WorkoutSet, key: 'weight_kg' | 'reps', raw: string) {
    try {
      await updateWorkoutSet(userId, set, key, raw)
    } catch (error) {
      setMessage(getUserMessage(error, 'Der Satzwert konnte nicht gespeichert werden.'))
    }
  }

  async function finishExercise(exercise: Exercise) {
    const exerciseSets = sets.filter((set) => set.exercise_id === exercise.id)
    if (exerciseSets.some((set) => set.weight_kg === null || set.reps === null || set.reps <= 0)) {
      setSelectedExerciseId(exercise.id)
      setMessage('Trage für jeden Satz Gewicht und Wiederholungen ein.')
      return
    }
    const next = exercises.find((item) => item.id !== exercise.id && !completeExerciseIds.has(item.id))
    try {
      await completeExercise(userId, exerciseSets, true)
      setMessage('')
      setSelectedExerciseId(next?.id ?? exercise.id)
    } catch (error) {
      setMessage(getUserMessage(error, 'Die Übung konnte nicht abgeschlossen werden.'))
    }
  }

  async function reopenExercise(exercise: Exercise) {
    const exerciseSets = sets.filter((set) => set.exercise_id === exercise.id)
    try {
      await completeExercise(userId, exerciseSets, false)
      setSelectedExerciseId(exercise.id)
      setMessage('')
    } catch (error) {
      setMessage(getUserMessage(error, 'Die Übung konnte nicht wieder geöffnet werden.'))
    }
  }

  async function changeDate(value: string) {
    if (!session) return
    try {
      await changeWorkoutDate(userId, session, value)
    } catch (error) {
      setMessage(getUserMessage(error, 'Das Trainingsdatum konnte nicht gespeichert werden.'))
    }
  }

  async function completeWorkout() {
    if (!session || !allDone) return
    try {
      await finishWorkout(userId, session)
      setMessage(`${day?.name ?? 'Training'} abgeschlossen`)
      window.setTimeout(onExit, 700)
    } catch (error) {
      setMessage(getUserMessage(error, 'Das Training konnte nicht abgeschlossen werden.'))
    }
  }

  if (!session || !day)
    return (
      <div className="center-screen">
        <p className="muted">Training wird geladen …</p>
      </div>
    )

  return (
    <div className="subview workout-shell">
      <ScreenHeader
        title={day.name}
        eyebrow="Laufendes Training"
        onBack={onExit}
        action={
          <span className="pill">
            {completeExerciseIds.size}/{exercises.length}
          </span>
        }
      />
      <main className="content content--narrow">
        <Card className="workout-date-card">
          <div>
            <CalendarDays size={19} />
            <div>
              <span>Trainingsdatum</span>
              <strong>{formatLongDate(session.started_at.slice(0, 10))}</strong>
            </div>
          </div>
          <input
            aria-label="Trainingsdatum ändern"
            type="date"
            value={session.started_at.slice(0, 10)}
            max={today()}
            onChange={(event) => void changeDate(event.target.value)}
          />
        </Card>

        <div className="workout-progress-copy">
          <div>
            <span className="eyebrow">Übungen</span>
            <h2>{allDone ? 'Alles erledigt.' : 'Wähle deine nächste Übung.'}</h2>
          </div>
          <span>
            {completeExerciseIds.size} von {exercises.length}
          </span>
        </div>

        <div className="workout-exercise-list">
          {orderedExercises.map((exercise) => {
            const complete = completeExerciseIds.has(exercise.id)
            const selected = resolvedSelectedExerciseId === exercise.id
            const exerciseSets = sets.filter((set) => set.exercise_id === exercise.id)
            return (
              <Card
                key={exercise.id}
                className={`workout-exercise ${complete ? 'workout-exercise--complete' : 'workout-exercise--pending'} ${selected ? 'workout-exercise--selected' : ''}`}
              >
                <div className="workout-exercise__head">
                  <button
                    className="workout-exercise__select"
                    onClick={() => setSelectedExerciseId(exercise.id)}
                    aria-expanded={selected}
                  >
                    <span className="workout-exercise__status">
                      {complete ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                    </span>
                    <span>
                      <strong>{exercise.name}</strong>
                      <small>
                        {exerciseSets.length} {exerciseSets.length === 1 ? 'Satz' : 'Sätze'} ·{' '}
                        {complete ? 'abgeschlossen' : 'offen'}
                      </small>
                    </span>
                  </button>
                  <IconButton
                    label={`Fortschritt für ${exercise.name} anzeigen`}
                    onClick={() => setProgressExercise(exercise)}
                  >
                    <BarChart3 size={19} />
                  </IconButton>
                </div>

                {selected && (
                  <div className="workout-exercise__body">
                    <div className="set-cards">
                      {exerciseSets.map((set) => (
                        <div className={`set-card ${set.is_completed ? 'set-card--done' : ''}`} key={set.id}>
                          <div className="set-card__number">
                            <span>Satz</span>
                            <strong>{set.set_number}</strong>
                          </div>
                          <div className="set-input-grid">
                            <NumberStepper
                              label="Gewicht"
                              inputLabel={`Gewicht Satz ${set.set_number}`}
                              value={set.weight_kg === null ? '' : String(set.weight_kg)}
                              onChange={(value) => void updateSet(set, 'weight_kg', value)}
                              step={0.5}
                              min={0}
                              max={500}
                              unit="kg"
                            />
                            <NumberStepper
                              label="Wiederholungen"
                              inputLabel={`Wiederholungen Satz ${set.set_number}`}
                              value={set.reps === null ? '' : String(set.reps)}
                              onChange={(value) => void updateSet(set, 'reps', value)}
                              step={1}
                              min={1}
                              max={100}
                              unit="Wdh."
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    {message && !complete && (
                      <p className="form-error" role="status">
                        {message}
                      </p>
                    )}
                    {complete ? (
                      <Button variant="secondary" full onClick={() => void reopenExercise(exercise)}>
                        <RotateCcw size={17} /> Übung wieder öffnen
                      </Button>
                    ) : (
                      <Button full onClick={() => void finishExercise(exercise)}>
                        <Check size={18} /> Übung abschließen
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>

        <Button full disabled={!allDone} onClick={() => void completeWorkout()}>
          <CheckCircle2 size={19} /> {allDone ? `${day.name} abschließen` : 'Training abschließen'}
        </Button>
        <p className="auth-note">
          Du kannst diese Ansicht jederzeit verlassen. Alle Eingaben und das laufende Training bleiben lokal
          gespeichert.
        </p>
      </main>
      <ExerciseProgressModal
        open={Boolean(progressExercise)}
        exercise={progressExercise}
        userId={userId}
        onClose={() => setProgressExercise(null)}
      />
      {message && allDone && <div className="toast">{message}</div>}
    </div>
  )
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: 'short' }).format(
    new Date(`${value}T12:00:00`),
  )
}
