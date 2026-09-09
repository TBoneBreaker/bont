import { useState } from 'react'
import { ChevronRight, ClipboardList, Library, MoreHorizontal, Pencil, Play, Plus, RotateCcw } from 'lucide-react'
import { Button, Card, EmptyState, IconButton, ScreenHeader } from '../../components/ui'
import { localDateString } from '../../lib/date'
import { getUserMessage } from '../../lib/errors'
import type { TrainingDay, TrainingPlan } from '../../types'
import { PlanBuilder } from './PlanBuilder'
import { applyTrainingTemplate, startWorkout as startWorkoutCommand } from './commands'
import { useTrainingData } from './use-training-data'
import { WorkoutView } from './WorkoutView'

type TrainingView = 'overview' | 'templates'
const today = localDateString

export function TrainingScreen({ userId, displayName }: { userId: string; displayName: string }) {
  const [view, setView] = useState<TrainingView>('overview')
  const [builder, setBuilder] = useState<{ plan?: TrainingPlan; template: boolean } | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null)
  const [workoutDate, setWorkoutDate] = useState(today())
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const { activePlan, templates, days, exercises, activeSessions } = useTrainingData(userId)

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
    setError('')
    try {
      const dayExercises = exercises.filter((exercise) => exercise.training_day_id === day.id).sort((a, b) => a.order_index - b.order_index)
      const session = await startWorkoutCommand({ userId, plan: activePlan, day, exercises: dayExercises, workoutDate: date })
      setActiveSessionId(session.id)
    } catch (startError) {
      setError(getUserMessage(startError, 'Das Training konnte nicht gestartet werden.'))
    } finally {
      setStarting(false)
    }
  }

  async function applyTemplate(template: TrainingPlan) {
    setError('')
    try {
      await applyTrainingTemplate(userId, template)
      setView('overview')
    } catch (applyError) {
      setError(getUserMessage(applyError, 'Die Vorlage konnte nicht übernommen werden.'))
    }
  }

  if (builder) {
    return <PlanBuilder userId={userId} existingPlan={builder.plan} templateMode={builder.template} onCancel={() => setBuilder(null)} onSaved={() => { setBuilder(null); setView(builder.template ? 'templates' : 'overview') }} />
  }

  if (activeSessionId) return <WorkoutView userId={userId} sessionId={activeSessionId} onExit={() => setActiveSessionId(null)} />

  if (view === 'templates') {
    return (
      <div className="subview">
        <ScreenHeader title="Planvorlagen" onBack={() => setView('overview')} action={<IconButton label="Vorlage hinzufügen" onClick={() => setBuilder({ template: true })}><Plus size={20} /></IconButton>} />
        <main className="content content--narrow">
          {templates.length === 0 ? (
            <Card>
              <EmptyState icon={<Library size={25} />} title="Noch keine Vorlagen" text="Hier kannst du vor dem Release eigene Standardpläne vorbereiten. Später wird diese Hinzufügen-Funktion entfernt." action={<Button onClick={() => setBuilder({ template: true })}><Plus size={18} /> Vorlage hinzufügen</Button>} />
            </Card>
          ) : templates.map((template) => (
            <Card key={template.id} className="stack">
              <div className="card__row card__row--top"><div><span className="eyebrow">{template.split_size}er-Split</span><h2>{template.name}</h2><p className="muted small">{template.notes || 'Keine Notizen'}</p></div><IconButton label="Vorlage bearbeiten" onClick={() => setBuilder({ plan: template, template: true })}><MoreHorizontal size={20} /></IconButton></div>
              <Button full onClick={() => void applyTemplate(template)}>Als Plan verwenden <ChevronRight size={18} /></Button>
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
        {error && <p className="form-error" role="alert">{error}</p>}
        <Card className="stack empty-feature-card"><div className="feature-icon"><ClipboardList size={23} /></div><div><h2>Eigenen Plan erstellen</h2><p className="muted">Wähle deinen Split, benenne Trainingstage und lege Übungen, Reihenfolge und Sätze selbst fest.</p></div><Button full onClick={() => setBuilder({ template: false })}><Plus size={18} /> Plan erstellen</Button></Card>
        <Card className="card--soft card--interactive" onClick={() => setView('templates')}><div className="card__row"><div className="row"><Library size={21} /><div><h3>Vorgefertigte Pläne</h3><span className="muted small">Vorlagen ansehen oder hinzufügen</span></div></div><ChevronRight size={19} /></div></Card>
      </main>
    )
  }

  return (
    <main className="content training-dashboard">
      <div className="page-heading"><div><span className="eyebrow">Aktiver Trainingsplan</span><h1>{activePlan.name}</h1></div><IconButton label="Trainingsplan bearbeiten" onClick={() => setBuilder({ plan: activePlan, template: false })}><Pencil size={19} /></IconButton></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {activeSessions.length > 0 && <Card className="resume-card"><div><span className="eyebrow">Lokal gesichert</span><h2>Training läuft weiter</h2><p>Du kannst es fortsetzen oder erst einen anderen Bereich öffnen.</p></div><Button variant="secondary" onClick={() => setActiveSessionId(activeSessions[0].id)}><RotateCcw size={18} /> Fortsetzen</Button></Card>}
      <div className="split-tabs" role="tablist" aria-label="Trainingstag auswählen">{days.map((day) => <button key={day.id} role="tab" aria-selected={selectedDay?.id === day.id} onClick={() => setSelectedDayId(day.id)}>{day.name}</button>)}</div>
      {selectedDay && <Card className="day-workspace stack"><div className="day-workspace__top"><div><span className="eyebrow">Trainingstag</span><h2>{selectedDay.name}</h2><p>{selectedDayExercises.length} Übungen · {selectedDayExercises.reduce((sum, exercise) => sum + exercise.target_sets, 0)} Sätze</p></div><label className="workout-date"><span>Datum</span><input type="date" value={workoutDate} max={today()} onChange={(event) => setWorkoutDate(event.target.value)} /></label></div><div className="plan-exercise-list">{selectedDayExercises.map((exercise, index) => <div className="plan-exercise-row" key={exercise.id}><span>{String(index + 1).padStart(2, '0')}</span><strong>{exercise.name}</strong><small>{exercise.target_sets} {exercise.target_sets === 1 ? 'Satz' : 'Sätze'}</small></div>)}</div><Button full disabled={starting || selectedDayExercises.length === 0} onClick={() => void startWorkout(selectedDay, workoutDate)}>{selectedActiveSession ? <><RotateCcw size={18} /> Training fortsetzen</> : <><Play size={18} fill="currentColor" /> Training öffnen</>}</Button></Card>}
      <div className="row row--between training-footer-actions"><Button variant="ghost" onClick={() => setView('templates')}><Library size={17} /> Planvorlagen</Button><Button variant="ghost" onClick={() => setBuilder({ plan: activePlan, template: false })}><Pencil size={17} /> Plan bearbeiten</Button></div>
      {activePlan.notes && <Card className="card--soft"><span className="eyebrow">Notiz zum Plan</span><p className="small" style={{ margin: 0 }}>{activePlan.notes}</p></Card>}
    </main>
  )
}
