import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  BarChart3,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardList,
  Dumbbell,
  Library,
  MoreHorizontal,
  Plus,
  RotateCcw,
} from 'lucide-react'
import { Button, Card, EmptyState, Field, IconButton, Metric, Modal, ScreenHeader } from '../../components/ui'
import { db, saveRecord } from '../../lib/db'
import type { Exercise, TrainingDay, TrainingPlan, WorkoutSession, WorkoutSet } from '../../types'
import { createBase, newId } from '../../types'
import { PlanBuilder } from './PlanBuilder'

type TrainingView = 'overview' | 'templates'

export function TrainingScreen({ userId, displayName }: { userId: string; displayName: string }) {
  const [view, setView] = useState<TrainingView>('overview')
  const [builder, setBuilder] = useState<{ plan?: TrainingPlan; template: boolean } | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
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
    if (!activeSessionId && activeSessions[0]) setActiveSessionId(activeSessions[0].id)
  }, [activeSessionId, activeSessions])

  async function startWorkout(day: TrainingDay) {
    const existing = activeSessions.find((session) => session.training_day_id === day.id)
    if (existing) {
      setActiveSessionId(existing.id)
      return
    }
    if (!activePlan) return
    setStarting(true)
    const session: WorkoutSession = {
      ...createBase(userId),
      training_plan_id: activePlan.id,
      training_day_id: day.id,
      started_at: new Date().toISOString(),
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
        const set: WorkoutSet = {
          ...createBase(userId),
          session_id: session.id,
          exercise_id: exercise.id,
          set_number: index + 1,
          weight_kg: previous?.weight_kg ?? null,
          reps: previous?.reps ?? null,
          is_completed: false,
        }
        await saveRecord('workout_sets', set)
      }
    }
    setStarting(false)
    setActiveSessionId(session.id)
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
        <div className="page-intro"><p className="page-intro__greeting">Schön, dass du da bist, {displayName}.</p><h1>Dein Training beginnt mit einem guten Plan.</h1></div>
        <Card className="stack">
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
    <main className="content">
      <div className="page-intro"><p className="page-intro__greeting">Bereit, {displayName}?</p><h1>{activePlan.name}</h1></div>

      {activeSessions.length > 0 && (
        <Card className="card--accent stack">
          <div><span className="eyebrow">Läuft auf diesem Gerät weiter</span><h2>Training fortsetzen</h2></div>
          <p className="muted small">Deine bisherigen Eingaben sind lokal gesichert – auch ohne Verbindung.</p>
          <Button variant="secondary" full onClick={() => setActiveSessionId(activeSessions[0].id)}><RotateCcw size={18} /> Fortsetzen</Button>
        </Card>
      )}

      <div className="section-heading"><h2>Trainingstage</h2><Button variant="ghost" onClick={() => setBuilder({ plan: activePlan, template: false })}>Plan bearbeiten</Button></div>
      <div className="stack">
        {days.map((day, index) => {
          const dayExercises = exercises.filter((exercise) => exercise.training_day_id === day.id)
          const sets = dayExercises.reduce((sum, exercise) => sum + exercise.target_sets, 0)
          return (
            <Card key={day.id} className="training-day-card">
              <div className="training-day-card__number">{String(index + 1).padStart(2, '0')}</div>
              <div className="training-day-card__copy"><h2>{day.name}</h2><p>{dayExercises.length} Übungen · {sets} Sätze</p></div>
              <Button disabled={starting} onClick={() => void startWorkout(day)}>Start <ChevronRight size={17} /></Button>
            </Card>
          )
        })}
      </div>

      <Card className="card--soft card--interactive" onClick={() => setView('templates')}>
        <div className="card__row"><div className="row"><Library size={20} /><div><h3>Planvorlagen</h3><span className="muted small">Weitere Pläne vorbereiten</span></div></div><ChevronRight size={19} /></div>
      </Card>
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

  useEffect(() => {
    if (!selectedExerciseId && exercises.length) {
      setSelectedExerciseId(exercises.find((exercise) => !completeExerciseIds.has(exercise.id))?.id ?? exercises[0].id)
    }
  }, [selectedExerciseId, exercises, completeExerciseIds])

  const selectedExercise = exercises.find((exercise) => exercise.id === selectedExerciseId)
  const selectedSets = sets.filter((set) => set.exercise_id === selectedExerciseId)
  const allDone = exercises.length > 0 && exercises.every((exercise) => completeExerciseIds.has(exercise.id))

  async function updateSet(set: WorkoutSet, key: 'weight_kg' | 'reps', raw: string) {
    const value = raw === '' ? null : Number(raw)
    await saveRecord('workout_sets', { ...set, [key]: value })
  }

  async function finishExercise() {
    if (!selectedExercise) return
    if (selectedSets.some((set) => set.weight_kg === null || set.reps === null || set.reps <= 0)) {
      setMessage('Trage für jeden Satz Gewicht und Wiederholungen ein.')
      return
    }
    for (const set of selectedSets) await saveRecord('workout_sets', { ...set, is_completed: true })
    setMessage('')
    const next = exercises.find((exercise) => exercise.id !== selectedExercise.id && !completeExerciseIds.has(exercise.id))
    if (next) setSelectedExerciseId(next.id)
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
        <div className="exercise-tabs" aria-label="Übung auswählen">
          {exercises.map((exercise, index) => (
            <button key={exercise.id} aria-pressed={exercise.id === selectedExerciseId} onClick={() => setSelectedExerciseId(exercise.id)}>
              {completeExerciseIds.has(exercise.id) ? <CheckCircle2 size={17} /> : <span>{index + 1}</span>}
              <small>{exercise.name}</small>
            </button>
          ))}
        </div>

        {selectedExercise && (
          <Card className="stack workout-card">
            <div className="card__row card__row--top">
              <div><span className="eyebrow">Übung {exercises.findIndex((item) => item.id === selectedExercise.id) + 1} von {exercises.length}</span><h1>{selectedExercise.name}</h1></div>
              <IconButton label="Fortschritt anzeigen" onClick={() => setProgressExercise(selectedExercise)}><BarChart3 size={20} /></IconButton>
            </div>
            <div className="set-table">
              <div className="set-table__head"><span>Satz</span><span>Gewicht</span><span>Wdh.</span><span>Status</span></div>
              {selectedSets.map((set) => (
                <div className={`set-row ${set.is_completed ? 'set-row--done' : ''}`} key={set.id}>
                  <strong>{set.set_number}</strong>
                  <label><input aria-label={`Gewicht Satz ${set.set_number}`} type="number" min="0" step="0.25" inputMode="decimal" value={set.weight_kg ?? ''} onChange={(event) => void updateSet(set, 'weight_kg', event.target.value)} /><span>kg</span></label>
                  <label><input aria-label={`Wiederholungen Satz ${set.set_number}`} type="number" min="1" max="100" inputMode="numeric" value={set.reps ?? ''} onChange={(event) => void updateSet(set, 'reps', event.target.value)} /><span>Wdh.</span></label>
                  {set.is_completed ? <CheckCircle2 size={21} className="done-icon" /> : <Circle size={21} className="muted" />}
                </div>
              ))}
            </div>
            {message && <p className="small" role="status" style={{ color: allDone ? 'var(--green)' : 'var(--danger)', margin: 0 }}>{message}</p>}
            {completeExerciseIds.has(selectedExercise.id) ? (
              <Button variant="secondary" full disabled><Check size={18} /> Übung erledigt</Button>
            ) : (
              <Button full onClick={() => void finishExercise()}><Check size={18} /> Übung abschließen</Button>
            )}
          </Card>
        )}

        <Button full disabled={!allDone} onClick={() => void finishWorkout()}><CheckCircle2 size={19} /> {allDone ? `${day.name} abschließen` : 'Erst alle Übungen abschließen'}</Button>
        <p className="auth-note">Du kannst jederzeit zurückgehen. Das laufende Training bleibt auf diesem Gerät gespeichert.</p>
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
