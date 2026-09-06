import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardList,
  Library,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RotateCcw,
} from 'lucide-react'
import { Button, Card, EmptyState, Field, IconButton, Modal, NumberStepper, ScreenHeader } from '../../components/ui'
import { db, saveRecord } from '../../lib/db'
import type { Exercise, TrainingDay, TrainingPlan, WorkoutSession, WorkoutSet } from '../../types'
import { createBase } from '../../types'
import { PlanBuilder } from './PlanBuilder'

type TrainingView = 'overview' | 'templates'

const today = () => {
  const date = new Date()
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

const dateAtNoon = (date: string) => `${date}T12:00:00.000Z`

export function TrainingScreen({ userId, displayName }: { userId: string; displayName: string }) {
  const [view, setView] = useState<TrainingView>('overview')
  const [builder, setBuilder] = useState<{ plan?: TrainingPlan; template: boolean } | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null)
  const [workoutDate, setWorkoutDate] = useState(today())
  const [starting, setStarting] = useState(false)

  const plans = useLiveQuery(
    () => db.training_plans.where('user_id').equals(userId).toArray(),
    [userId],
    [],
  ).filter((plan) => !plan.deleted_at)
  const activePlan = plans.find((plan) => plan.is_active && !plan.is_template)
  const templates = plans.filter((plan) => plan.is_template)
  const days = useLiveQuery(
    async () => activePlan
      ? (await db.training_days.where('plan_id').equals(activePlan.id).toArray()).filter((day) => !day.deleted_at).sort((a, b) => a.order_index - b.order_index)
      : [],
    [activePlan?.id],
    [],
  )
  const exercises = useLiveQuery(
    async () => (await db.exercises.where('user_id').equals(userId).toArray()).filter((exercise) => !exercise.deleted_at),
    [userId],
    [],
  )
  const activeSessions = useLiveQuery(
    async () => (await db.workout_sessions.where('user_id').equals(userId).toArray()).filter((session) => !session.deleted_at && session.status === 'active'),
    [userId],
    [],
  )

  useEffect(() => {
    if (!days.length) {
      setSelectedDayId(null)
      return
    }
    if (!selectedDayId || !days.some((day) => day.id === selectedDayId)) setSelectedDayId(days[0].id)
  }, [days, selectedDayId])

  const selectedDay = days.find((day) => day.id === selectedDayId) ?? days[0]
  const selectedDayExercises = selectedDay
    ? exercises.filter((exercise) => exercise.training_day_id === selectedDay.id).sort((a, b) => a.order_index - b.order_index)
    : []
  const selectedActiveSession = activeSessions.find((session) => session.training_day_id === selectedDay?.id)

  async function startWorkout(day: TrainingDay, date: string) {
    const existing = activeSessions.find((session) => session.training_day_id === day.id)
    if (existing) {
      setActiveSessionId(existing.id)
      return
    }
    if (!activePlan) return
    setStarting(true)
    try {
      const session: WorkoutSession = {
        ...createBase(userId),
        training_plan_id: activePlan.id,
        training_day_id: day.id,
        started_at: dateAtNoon(date),
        completed_at: null,
        status: 'active',
      }
      await saveRecord('workout_sessions', session)

      const dayExercises = exercises.filter((exercise) => exercise.training_day_id === day.id).sort((a, b) => a.order_index - b.order_index)
      const completedSessions = (await db.workout_sessions.where('training_day_id').equals(day.id).toArray())
        .filter((item) => item.status === 'completed' && !item.deleted_at)
        .sort((a, b) => b.started_at.localeCompare(a.started_at))
      const previousSessionIds = new Set(completedSessions.map((item) => item.id))
      const previousSets = (await db.workout_sets.where('user_id').equals(userId).toArray())
        .filter((set) => previousSessionIds.has(set.session_id) && !set.deleted_at)

      for (const exercise of dayExercises) {
        for (let index = 0; index < exercise.target_sets; index += 1) {
          const previous = completedSessions
            .map((previousSession) => previousSets.find((set) => set.session_id === previousSession.id && set.exercise_id === exercise.id && set.set_number === index + 1))
            .find(Boolean)
          await saveRecord('workout_sets', {
            ...createBase(userId),
            session_id: session.id,
            exercise_id: exercise.id,
            set_number: index + 1,
            weight_kg: previous?.weight_kg ?? null,
            reps: previous?.reps ?? null,
            is_completed: false,
          })
        }
      }
      setActiveSessionId(session.id)
    } finally {
      setStarting(false)
    }
  }

  async function useTemplate(template: TrainingPlan) {
    const oldActive = plans.filter((plan) => plan.is_active && !plan.is_template)
    for (const plan of oldActive) await saveRecord('training_plans', { ...plan, is_active: false })
    const plan: TrainingPlan = {
      ...createBase(userId),
      name: template.name,
      split_size: template.split_size,
      notes: template.notes,
      is_active: true,
      is_template: false,
    }
    await saveRecord('training_plans', plan)
    const templateDays = (await db.training_days.where('plan_id').equals(template.id).toArray()).filter((day) => !day.deleted_at).sort((a, b) => a.order_index - b.order_index)
    const allExercises = (await db.exercises.where('user_id').equals(userId).toArray()).filter((exercise) => !exercise.deleted_at)
    for (const templateDay of templateDays) {
      const day: TrainingDay = { ...createBase(userId), plan_id: plan.id, name: templateDay.name, order_index: templateDay.order_index }
      await saveRecord('training_days', day)
      for (const templateExercise of allExercises.filter((exercise) => exercise.training_day_id === templateDay.id).sort((a, b) => a.order_index - b.order_index)) {
        await saveRecord('exercises', {
          ...createBase(userId),
          training_day_id: day.id,
          name: templateExercise.name,
          target_sets: templateExercise.target_sets,
          order_index: templateExercise.order_index,
        })
      }
    }
    setView('overview')
  }

  if (builder) {
    return (
      <PlanBuilder
        userId={userId}
        existingPlan={builder.plan}
        templateMode={builder.template}
        onCancel={() => setBuilder(null)}
        onSaved={() => { setBuilder(null); setView(builder.template ? 'templates' : 'overview') }}
      />
    )
  }

  if (activeSessionId) {
    return <WorkoutView userId={userId} sessionId={activeSessionId} onExit={() => setActiveSessionId(null)} />
  }

  if (view === 'templates') {
    return (
      <div className="subview">
        <ScreenHeader title="Planvorlagen" onBack={() => setView('overview')} action={<IconButton label="Vorlage hinzufügen" onClick={() => setBuilder({ template: true })}><Plus size={20} /></IconButton>} />
        <main className="content content--narrow">
          {templates.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Library size={25} />}
                title="Noch keine Vorlagen"
                text="Hier kannst du vor dem Release eigene Standardpläne vorbereiten. Später wird diese Hinzufügen-Funktion entfernt."
                action={<Button onClick={() => setBuilder({ template: true })}><Plus size={18} /> Vorlage hinzufügen</Button>}
              />
            </Card>
          ) : templates.map((template) => (
            <Card key={template.id} className="stack">
              <div className="card__row card__row--top">
                <div><span className="eyebrow">{template.split_size}er-Split</span><h2>{template.name}</h2><p className="muted small">{template.notes || 'Keine Notizen'}</p></div>
                <IconButton label="Vorlage bearbeiten" onClick={() => setBuilder({ plan: template, template: true })}><MoreHorizontal size={20} /></IconButton>
              </div>
              <Button full onClick={() => void useTemplate(template)}>Als Plan verwenden <ChevronRight size={18} /></Button>
            </Card>
          ))}
        </main>
      </div>
    )
  }

  if (!activePlan) {
    return (
      <main className="content">
        <div className="page-heading"><div><span className="eyebrow">Training</span><h1>Ein Plan, der zu dir passt.</h1><p>Starte übersichtlich und passe später jede Übung an, {displayName}.</p></div></div>
        <Card className="stack empty-feature-card">
          <div className="feature-icon"><ClipboardList size={23} /></div>
          <div><h2>Eigenen Plan erstellen</h2><p className="muted">Wähle deinen Split, benenne Trainingstage und lege Übungen, Reihenfolge und Sätze selbst fest.</p></div>
          <Button full onClick={() => setBuilder({ template: false })}><Plus size={18} /> Plan erstellen</Button>
        </Card>
        <Card className="card--soft card--interactive" onClick={() => setView('templates')}>
          <div className="card__row"><div className="row"><Library size={21} /><div><h3>Vorgefertigte Pläne</h3><span className="muted small">Vorlagen ansehen oder hinzufügen</span></div></div><ChevronRight size={19} /></div>
        </Card>
      </main>
    )
  }

  return (
    <main className="content training-dashboard">
      <div className="page-heading">
        <div><span className="eyebrow">Aktiver Trainingsplan</span><h1>{activePlan.name}</h1></div>
        <IconButton label="Trainingsplan bearbeiten" onClick={() => setBuilder({ plan: activePlan, template: false })}><Pencil size={19} /></IconButton>
      </div>

      {activeSessions.length > 0 && (
        <Card className="resume-card">
          <div><span className="eyebrow">Lokal gesichert</span><h2>Training läuft weiter</h2><p>Du kannst es fortsetzen oder erst einen anderen Bereich öffnen.</p></div>
          <Button variant="secondary" onClick={() => setActiveSessionId(activeSessions[0].id)}><RotateCcw size={18} /> Fortsetzen</Button>
        </Card>
      )}

      <div className="split-tabs" role="tablist" aria-label="Trainingstag auswählen">
        {days.map((day) => (
          <button key={day.id} role="tab" aria-selected={selectedDay?.id === day.id} onClick={() => setSelectedDayId(day.id)}>{day.name}</button>
        ))}
      </div>

      {selectedDay && (
        <Card className="day-workspace stack">
          <div className="day-workspace__top">
            <div><span className="eyebrow">Trainingstag</span><h2>{selectedDay.name}</h2><p>{selectedDayExercises.length} Übungen · {selectedDayExercises.reduce((sum, exercise) => sum + exercise.target_sets, 0)} Sätze</p></div>
            <label className="workout-date"><span>Datum</span><input type="date" value={workoutDate} max={today()} onChange={(event) => setWorkoutDate(event.target.value)} /></label>
          </div>
          <div className="plan-exercise-list">
            {selectedDayExercises.map((exercise, index) => (
              <div className="plan-exercise-row" key={exercise.id}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{exercise.name}</strong>
                <small>{exercise.target_sets} {exercise.target_sets === 1 ? 'Satz' : 'Sätze'}</small>
              </div>
            ))}
          </div>
          <Button full disabled={starting || selectedDayExercises.length === 0} onClick={() => void startWorkout(selectedDay, workoutDate)}>
            {selectedActiveSession ? <><RotateCcw size={18} /> Training fortsetzen</> : <><Play size={18} fill="currentColor" /> Training öffnen</>}
          </Button>
        </Card>
      )}

      <div className="row row--between training-footer-actions">
        <Button variant="ghost" onClick={() => setView('templates')}><Library size={17} /> Planvorlagen</Button>
        <Button variant="ghost" onClick={() => setBuilder({ plan: activePlan, template: false })}><Pencil size={17} /> Plan bearbeiten</Button>
      </div>
      {activePlan.notes && <Card className="card--soft"><span className="eyebrow">Notiz zum Plan</span><p className="small" style={{ margin: 0 }}>{activePlan.notes}</p></Card>}
    </main>
  )
}

function WorkoutView({ userId, sessionId, onExit }: { userId: string; sessionId: string; onExit: () => void }) {
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [progressExercise, setProgressExercise] = useState<Exercise | null>(null)
  const session = useLiveQuery(() => db.workout_sessions.get(sessionId), [sessionId])
  const day = useLiveQuery(() => session ? db.training_days.get(session.training_day_id) : undefined, [session?.training_day_id])
  const exercises = useLiveQuery(async () => session
    ? (await db.exercises.where('training_day_id').equals(session.training_day_id).toArray()).filter((item) => !item.deleted_at).sort((a, b) => a.order_index - b.order_index)
    : [], [session?.training_day_id], [])
  const sets = useLiveQuery(async () => (await db.workout_sets.where('session_id').equals(sessionId).toArray()).filter((item) => !item.deleted_at).sort((a, b) => a.set_number - b.set_number), [sessionId], [])

  const completeExerciseIds = useMemo(() => new Set(exercises.filter((exercise) => {
    const exerciseSets = sets.filter((set) => set.exercise_id === exercise.id)
    return exerciseSets.length > 0 && exerciseSets.every((set) => set.is_completed)
  }).map((exercise) => exercise.id)), [exercises, sets])
  const orderedExercises = useMemo(() => [
    ...exercises.filter((exercise) => !completeExerciseIds.has(exercise.id)),
    ...exercises.filter((exercise) => completeExerciseIds.has(exercise.id)),
  ], [exercises, completeExerciseIds])

  useEffect(() => {
    if (exercises.length && (!selectedExerciseId || !exercises.some((exercise) => exercise.id === selectedExerciseId))) {
      setSelectedExerciseId(exercises.find((exercise) => !completeExerciseIds.has(exercise.id))?.id ?? exercises[0].id)
    }
  }, [selectedExerciseId, exercises, completeExerciseIds])

  const allDone = exercises.length > 0 && exercises.every((exercise) => completeExerciseIds.has(exercise.id))

  async function updateSet(set: WorkoutSet, key: 'weight_kg' | 'reps', raw: string) {
    const value = raw === '' ? null : Number(raw)
    await saveRecord('workout_sets', { ...set, [key]: value })
  }

  async function finishExercise(exercise: Exercise) {
    const exerciseSets = sets.filter((set) => set.exercise_id === exercise.id)
    if (exerciseSets.some((set) => set.weight_kg === null || set.reps === null || set.reps <= 0)) {
      setSelectedExerciseId(exercise.id)
      setMessage('Trage für jeden Satz Gewicht und Wiederholungen ein.')
      return
    }
    const next = exercises.find((item) => item.id !== exercise.id && !completeExerciseIds.has(item.id))
    for (const set of exerciseSets) await saveRecord('workout_sets', { ...set, is_completed: true })
    setMessage('')
    setSelectedExerciseId(next?.id ?? exercise.id)
  }

  async function reopenExercise(exercise: Exercise) {
    const exerciseSets = sets.filter((set) => set.exercise_id === exercise.id)
    for (const set of exerciseSets) await saveRecord('workout_sets', { ...set, is_completed: false })
    setSelectedExerciseId(exercise.id)
  }

  async function changeWorkoutDate(value: string) {
    if (!session) return
    await saveRecord('workout_sessions', { ...session, started_at: dateAtNoon(value) })
  }

  async function finishWorkout() {
    if (!session || !allDone) return
    await saveRecord('workout_sessions', { ...session, status: 'completed', completed_at: new Date().toISOString() })
    setMessage(`${day?.name ?? 'Training'} abgeschlossen`)
    window.setTimeout(onExit, 700)
  }

  if (!session || !day) return <div className="center-screen"><p className="muted">Training wird geladen …</p></div>

  return (
    <div className="subview workout-shell">
      <ScreenHeader title={day.name} eyebrow="Laufendes Training" onBack={onExit} action={<span className="pill">{completeExerciseIds.size}/{exercises.length}</span>} />
      <main className="content content--narrow">
        <Card className="workout-date-card">
          <div><CalendarDays size={19} /><div><span>Trainingsdatum</span><strong>{formatLongDate(session.started_at.slice(0, 10))}</strong></div></div>
          <input aria-label="Trainingsdatum ändern" type="date" value={session.started_at.slice(0, 10)} max={today()} onChange={(event) => void changeWorkoutDate(event.target.value)} />
        </Card>

        <div className="workout-progress-copy">
          <div><span className="eyebrow">Übungen</span><h2>{allDone ? 'Alles erledigt.' : 'Wähle deine nächste Übung.'}</h2></div>
          <span>{completeExerciseIds.size} von {exercises.length}</span>
        </div>

        <div className="workout-exercise-list">
          {orderedExercises.map((exercise) => {
            const complete = completeExerciseIds.has(exercise.id)
            const selected = selectedExerciseId === exercise.id
            const exerciseSets = sets.filter((set) => set.exercise_id === exercise.id)
            return (
              <Card key={exercise.id} className={`workout-exercise ${complete ? 'workout-exercise--complete' : 'workout-exercise--pending'} ${selected ? 'workout-exercise--selected' : ''}`}>
                <div className="workout-exercise__head">
                  <button className="workout-exercise__select" onClick={() => setSelectedExerciseId(exercise.id)} aria-expanded={selected}>
                    <span className="workout-exercise__status">{complete ? <CheckCircle2 size={20} /> : <Circle size={20} />}</span>
                    <span><strong>{exercise.name}</strong><small>{exerciseSets.length} {exerciseSets.length === 1 ? 'Satz' : 'Sätze'} · {complete ? 'abgeschlossen' : 'offen'}</small></span>
                  </button>
                  <IconButton label={`Fortschritt für ${exercise.name} anzeigen`} onClick={() => setProgressExercise(exercise)}><BarChart3 size={19} /></IconButton>
                </div>

                {selected && (
                  <div className="workout-exercise__body">
                    <div className="set-cards">
                      {exerciseSets.map((set) => (
                        <div className={`set-card ${set.is_completed ? 'set-card--done' : ''}`} key={set.id}>
                          <div className="set-card__number"><span>Satz</span><strong>{set.set_number}</strong></div>
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
                    {message && !complete && <p className="form-error" role="status">{message}</p>}
                    {complete ? (
                      <Button variant="secondary" full onClick={() => void reopenExercise(exercise)}><RotateCcw size={17} /> Übung wieder öffnen</Button>
                    ) : (
                      <Button full onClick={() => void finishExercise(exercise)}><Check size={18} /> Übung abschließen</Button>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>

        <Button full disabled={!allDone} onClick={() => void finishWorkout()}><CheckCircle2 size={19} /> {allDone ? `${day.name} abschließen` : 'Training abschließen'}</Button>
        <p className="auth-note">Du kannst diese Ansicht jederzeit verlassen. Alle Eingaben und das laufende Training bleiben lokal gespeichert.</p>
      </main>
      <ExerciseProgressModal open={Boolean(progressExercise)} exercise={progressExercise} userId={userId} onClose={() => setProgressExercise(null)} />
      {message && allDone && <div className="toast">{message}</div>}
    </div>
  )
}

function ExerciseProgressModal({ open, exercise, userId, onClose }: { open: boolean; exercise: Exercise | null; userId: string; onClose: () => void }) {
  const sessions = useLiveQuery(async () => (await db.workout_sessions.where('user_id').equals(userId).toArray()).filter((item) => item.status === 'completed' && !item.deleted_at).sort((a, b) => a.started_at.localeCompare(b.started_at)), [userId], [])
  const allSets = useLiveQuery(async () => exercise ? (await db.workout_sets.where('exercise_id').equals(exercise.id).toArray()).filter((item) => !item.deleted_at && item.is_completed) : [], [exercise?.id], [])
  const history = sessions.map((session) => ({
    session,
    sets: allSets.filter((set) => set.session_id === session.id && set.weight_kg !== null),
  })).filter((item) => item.sets.length > 0).slice(-10)

  return (
    <Modal open={open} title={exercise?.name ?? 'Fortschritt'} onClose={onClose}>
      {history.length === 0 ? (
        <EmptyState icon={<BarChart3 size={24} />} title="Noch kein Verlauf" text="Nach deinem ersten abgeschlossenen Training erscheint hier Gewicht pro Satz mit den jeweiligen Wiederholungen." />
      ) : (
        <>
          <ExerciseChart history={history} />
          <div className="stack stack--tight">
            {history.slice().reverse().map(({ session, sets: sessionSets }) => (
              <div className="history-row" key={session.id}>
                <span>{new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(session.started_at))}</span>
                <strong>{sessionSets.map((set) => `${set.weight_kg} kg × ${set.reps}`).join(' · ')}</strong>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}

function ExerciseChart({ history }: { history: { session: WorkoutSession; sets: WorkoutSet[] }[] }) {
  const weights = history.flatMap((item) => item.sets.map((set) => set.weight_kg ?? 0))
  const min = Math.min(...weights)
  const max = Math.max(...weights)
  const range = max - min || 1
  const xFor = (historyIndex: number, setIndex: number, setCount: number) => {
    const base = history.length === 1 ? 180 : 30 + historyIndex * (300 / (history.length - 1))
    return base + (setIndex - (setCount - 1) / 2) * 6
  }
  const yFor = (weight: number) => 140 - ((weight - min) / range) * 100
  const points = history.flatMap((item, historyIndex) => item.sets.map((set, setIndex) => ({
    x: xFor(historyIndex, setIndex, item.sets.length),
    y: yFor(set.weight_kg ?? 0),
    set,
  })))

  return (
    <svg className="chart exercise-chart" viewBox="0 0 360 190" role="img" aria-label="Gewichtsverlauf pro Satz">
      {[40, 90, 140].map((y) => <line className="chart-grid" key={y} x1="24" x2="336" y1={y} y2={y} />)}
      {points.slice(1).map((point, index) => <line key={`${point.x}-${point.y}`} x1={points[index].x} y1={points[index].y} x2={point.x} y2={point.y} className="chart-line--blue" strokeWidth="2" opacity="0.55" />)}
      {points.map((point) => (
        <g key={point.set.id}>
          <circle className="chart-point chart-line--blue" cx={point.x} cy={point.y} r="4" />
          <text x={point.x} y={point.y - 9} textAnchor="middle">{point.set.weight_kg}</text>
          <text x={point.x} y="162" textAnchor="middle">{point.set.reps}</text>
        </g>
      ))}
      <text x="22" y="17">kg</text>
      <text x="338" y="181" textAnchor="end">Wiederholungen unter den Punkten</text>
    </svg>
  )
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: 'short' }).format(new Date(`${value}T12:00:00`))
}
