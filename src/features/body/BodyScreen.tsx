import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Activity, CalendarDays, Footprints, Scale, Sparkles, Utensils } from 'lucide-react'
import { Button, Card, Field, InfoNote, Metric, ProgressBar } from '../../components/ui'
import { db, saveRecord } from '../../lib/db'
import { estimateMaintenance, weeklyAverages } from '../../lib/maintenance'
import type { BodyEntry } from '../../types'
import { createBase } from '../../types'

const today = () => new Date().toISOString().slice(0, 10)

export function BodyScreen({ userId, displayName }: { userId: string; displayName: string }) {
  const entries = useLiveQuery(
    async () => (await db.body_entries.where('user_id').equals(userId).toArray()).filter((entry) => !entry.deleted_at).sort((a, b) => a.entry_date.localeCompare(b.entry_date)),
    [userId],
    [],
  )
  const [entryDate, setEntryDate] = useState(today())
  const [weight, setWeight] = useState('')
  const [calories, setCalories] = useState('')
  const [steps, setSteps] = useState('')
  const [saved, setSaved] = useState(false)

  const existing = entries.find((entry) => entry.entry_date === entryDate)
  useEffect(() => {
    setWeight(existing?.weight_kg ? String(existing.weight_kg) : '')
    setCalories(existing?.calories ? String(existing.calories) : '')
    setSteps(existing?.steps ? String(existing.steps) : '')
  }, [existing?.id, existing?.updated_at, entryDate])

  const estimate = useMemo(() => estimateMaintenance(entries), [entries])
  const weeks = useMemo(() => weeklyAverages(entries), [entries])
  const completeDays = entries.filter((entry) => entry.weight_kg > 0 && entry.calories > 0).length
  const progress = Math.min(100, completeDays / 14 * 100)

  async function save() {
    if (!weight || !calories || !steps) return
    const record: BodyEntry = {
      ...(existing ?? createBase(userId)),
      entry_date: entryDate,
      weight_kg: Number(weight),
      calories: Math.round(Number(calories)),
      steps: Math.round(Number(steps)),
      deleted_at: null,
    }
    await saveRecord('body_entries', record)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1400)
  }

  return (
    <main className="content">
      <div className="page-intro"><p className="page-intro__greeting">Dein Trend, {displayName}.</p><h1>Körperanalyse</h1></div>

      <Card className={`stack ${estimate.maintenance ? 'card--accent' : ''}`}>
        <div className="card__row card__row--top">
          <div>
            <span className="eyebrow">Geschätzter Erhaltungsbedarf</span>
            <div className="hero-number">{estimate.maintenance ? `${estimate.maintenance.toLocaleString('de-DE')} kcal` : 'Noch in Kalibrierung'}</div>
          </div>
          <div className="feature-icon feature-icon--transparent"><Sparkles size={21} /></div>
        </div>
        <ProgressBar value={progress} tone={estimate.maintenance ? 'taupe' : 'green'} />
        <p className="muted small" style={{ margin: 0 }}>
          {completeDays < 7
            ? `${7 - completeDays} vollständige ${7 - completeDays === 1 ? 'Tag' : 'Tage'} bis zur ersten Schätzung. Für ein gutes Ergebnis sind 14+ Tage besser.`
            : estimate.reason ?? `${estimate.days} Tage ausgewertet · ${confidenceLabel[estimate.confidence]}`}
        </p>
      </Card>

      <Card className="stack">
        <div className="card__row"><div><span className="eyebrow">Täglicher Check-in</span><h2>Werte eintragen</h2></div><CalendarDays size={20} className="muted" /></div>
        <Field label="Datum" type="date" value={entryDate} max={today()} onChange={(event) => setEntryDate(event.target.value)} />
        <div className="grid-3 body-inputs">
          <Field label="Gewicht (kg)" type="number" inputMode="decimal" min="35" max="300" step="0.1" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="90,0" />
          <Field label="Kalorien" type="number" inputMode="numeric" min="500" max="10000" value={calories} onChange={(event) => setCalories(event.target.value)} placeholder="2500" />
          <Field label="Schritte" type="number" inputMode="numeric" min="0" max="100000" value={steps} onChange={(event) => setSteps(event.target.value)} placeholder="10000" />
        </div>
        <Button full disabled={!weight || !calories || !steps} onClick={() => void save()}>{saved ? 'Gespeichert' : existing ? 'Eintrag aktualisieren' : 'Tag speichern'}</Button>
        <p className="auth-note">Für vergleichbare Werte morgens nach dem Aufstehen, nüchtern und unter ähnlichen Bedingungen wiegen.</p>
      </Card>

      <div className="section-heading"><h2>Wochentrend</h2><span className="pill">7-Tage-Mittel</span></div>
      <div className="grid-3">
        <Metric label="Diese Woche" value={weeks.current === null ? '–' : `${weeks.current.toFixed(1)} kg`} tone="green" />
        <Metric label="Vorwoche" value={weeks.previous === null ? '–' : `${weeks.previous.toFixed(1)} kg`} tone="taupe" />
        <Metric
          label="Veränderung"
          value={weeks.change === null ? '–' : `${weeks.change > 0 ? '+' : ''}${weeks.change.toFixed(2)} kg`}
          detail={weeks.change === null ? '14 Einträge nötig' : weeks.change > 0.05 ? 'Zunahme' : weeks.change < -0.05 ? 'Abnahme' : 'stabil'}
          tone="blue"
        />
      </div>

      {entries.length > 1 && (
        <Card className="stack">
          <div><span className="eyebrow">Letzte 14 Einträge</span><h2>Verlauf</h2></div>
          <TrendRow icon={<Scale size={17} />} label="Körpergewicht" color="green" values={entries.slice(-14).map((entry) => ({ date: entry.entry_date, value: entry.weight_kg }))} unit="kg" />
          <TrendRow icon={<Utensils size={17} />} label="Kalorien" color="taupe" values={entries.slice(-14).filter((entry) => entry.calories > 0).map((entry) => ({ date: entry.entry_date, value: entry.calories }))} unit="kcal" />
          <TrendRow icon={<Footprints size={17} />} label="Schritte" color="blue" values={entries.slice(-14).filter((entry) => entry.steps >= 0).map((entry) => ({ date: entry.entry_date, value: entry.steps }))} unit="" />
        </Card>
      )}

      <Card className="card--soft">
        <InfoNote>
          Bont schätzt den täglichen Gewichtstrend und verrechnet ihn mit deiner durchschnittlichen Kalorienzufuhr. Als Näherung gelten 7.700 kcal pro Kilogramm. Wasser, Glykogen und Verdauungsinhalt können das Ergebnis kurzfristig stark verzerren – deshalb steigt die Verlässlichkeit erst mit mehr Tagen.
        </InfoNote>
      </Card>
    </main>
  )
}

const confidenceLabel = {
  insufficient: 'noch nicht ausreichend',
  preliminary: 'vorläufige Schätzung',
  good: 'gute Datengrundlage',
  strong: 'starke Datengrundlage',
}

function TrendRow({
  icon,
  label,
  values,
  unit,
  color,
}: {
  icon: React.ReactNode
  label: string
  values: { date: string; value: number }[]
  unit: string
  color: 'green' | 'blue' | 'taupe'
}) {
  if (values.length < 2) return null
  const min = Math.min(...values.map((point) => point.value))
  const max = Math.max(...values.map((point) => point.value))
  const range = max - min || 1
  const coords = values.map((point, index) => ({
    x: values.length === 1 ? 50 : (index / (values.length - 1)) * 100,
    y: 34 - ((point.value - min) / range) * 27,
  }))
  const points = coords.map((point) => `${point.x},${point.y}`).join(' ')
  const latest = values.at(-1)!
  return (
    <div className="trend-row">
      <div className="row"><span className={`trend-row__icon tone-${color}`}>{icon}</span><div><strong>{label}</strong><span>{latest.value.toLocaleString('de-DE')} {unit}</span></div></div>
      <svg viewBox="0 0 100 38" preserveAspectRatio="none" aria-label={`${label} Verlauf`}><polyline points={points} className={`spark-line chart-line--${color}`} /></svg>
    </div>
  )
}
