import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarDays, Check, ChevronLeft, ChevronRight, Footprints, Gauge, Plus, Scale, Sparkles, Utensils } from 'lucide-react'
import { Button, Card, Field, Metric, Modal, NumberStepper, ProgressBar } from '../../components/ui'
import { db, saveRecord } from '../../lib/db'
import { estimateMaintenance, weeklyAverages } from '../../lib/maintenance'
import type { BodyEntry } from '../../types'
import { createBase } from '../../types'

type BodyMetric = 'weight_kg' | 'calories' | 'steps'

const today = () => {
  const date = new Date()
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

export function BodyScreen({ userId }: { userId: string }) {
  const entries = useLiveQuery(
    async () => (await db.body_entries.where('user_id').equals(userId).toArray())
      .filter((entry) => !entry.deleted_at)
      .sort((a, b) => a.entry_date.localeCompare(b.entry_date)),
    [userId],
    [],
  )
  const settings = useLiveQuery(() => db.user_settings.where('user_id').equals(userId).first(), [userId])
  const [entryOpen, setEntryOpen] = useState(false)
  const [entryDate, setEntryDate] = useState(today())
  const [weight, setWeight] = useState('')
  const [calories, setCalories] = useState('')
  const [steps, setSteps] = useState('')
  const [savedMetric, setSavedMetric] = useState<BodyMetric | null>(null)

  const existing = entries.find((entry) => entry.entry_date === entryDate)

  useEffect(() => {
    if (!entryOpen) return
    const previous = entries.filter((entry) => entry.entry_date < entryDate).slice().reverse()
    const previousWeight = previous.find((entry) => entry.weight_kg !== null)?.weight_kg
    const previousCalories = previous.find((entry) => entry.calories !== null)?.calories
    const previousSteps = previous.find((entry) => entry.steps !== null)?.steps
    setWeight(String(existing?.weight_kg ?? previousWeight ?? ''))
    setCalories(String(existing?.calories ?? previousCalories ?? ''))
    setSteps(String(existing?.steps ?? previousSteps ?? ''))
  }, [entryDate, entryOpen, entries, existing?.id, existing?.updated_at])

  const estimate = useMemo(() => estimateMaintenance(entries), [entries])
  const weeks = useMemo(() => weeklyAverages(entries), [entries])
  const completeDays = entries.filter((entry) =>
    entry.weight_kg !== null && entry.weight_kg > 0 && entry.calories !== null && entry.calories > 0,
  ).length
  const maintenance = estimate.maintenance ?? settings?.preliminary_maintenance ?? null
  const todayCalories = entries.find((entry) => entry.entry_date === today())?.calories ?? null
  const balance = maintenance !== null && todayCalories !== null ? Math.round(todayCalories - maintenance) : null

  const chartData = useMemo(() => ({
    calories: entries.filter((entry): entry is BodyEntry & { calories: number } => entry.calories !== null).map((entry) => ({ date: entry.entry_date, value: entry.calories! })),
    steps: entries.filter((entry): entry is BodyEntry & { steps: number } => entry.steps !== null).map((entry) => ({ date: entry.entry_date, value: entry.steps! })),
    weight: entries.filter((entry): entry is BodyEntry & { weight_kg: number } => entry.weight_kg !== null).map((entry) => ({ date: entry.entry_date, value: entry.weight_kg! })),
  }), [entries])

  function openEntry() {
    setEntryDate(today())
    setSavedMetric(null)
    setEntryOpen(true)
  }

  async function saveMetric(metric: BodyMetric) {
    const raw = metric === 'weight_kg' ? weight : metric === 'calories' ? calories : steps
    if (raw === '' || Number.isNaN(Number(raw))) return
    const value = metric === 'weight_kg' ? Number(raw) : Math.round(Number(raw))
    if ((metric === 'weight_kg' && (value < 35 || value > 300)) ||
      (metric === 'calories' && (value < 0 || value > 10_000)) ||
      (metric === 'steps' && (value < 0 || value > 100_000))) return
    const latest = (await db.body_entries.where('entry_date').equals(entryDate).toArray())
      .find((entry) => entry.user_id === userId && !entry.deleted_at)
    const record: BodyEntry = {
      ...(latest ?? createBase(userId)),
      entry_date: entryDate,
      weight_kg: metric === 'weight_kg' ? value : latest?.weight_kg ?? null,
      calories: metric === 'calories' ? value : latest?.calories ?? null,
      steps: metric === 'steps' ? value : latest?.steps ?? null,
      deleted_at: null,
    }
    await saveRecord('body_entries', record)
    setSavedMetric(metric)
    window.setTimeout(() => setSavedMetric((current) => current === metric ? null : current), 1500)
  }

  return (
    <main className="content body-dashboard">
      <div className="page-heading">
        <div><span className="eyebrow">Körperanalyse</span><h1>Deine Entwicklung auf einen Blick.</h1></div>
        <button className="quick-add" onClick={openEntry} aria-label="Körperwerte eintragen"><Plus size={22} /></button>
      </div>

      <div className="chart-grid-cards">
        <MetricChart
          icon={<Utensils size={18} />}
          label="Kalorien"
          values={chartData.calories}
          tone="orange"
          format={(value) => `${Math.round(value).toLocaleString('de-DE')} kcal`}
          formatAxis={(value) => compactNumber(value)}
        />
        <MetricChart
          icon={<Footprints size={18} />}
          label="Schritte"
          values={chartData.steps}
          tone="cyan"
          format={(value) => Math.round(value).toLocaleString('de-DE')}
          formatAxis={(value) => compactNumber(value)}
        />
        <MetricChart
          icon={<Scale size={18} />}
          label="Gewicht"
          values={chartData.weight}
          tone="violet"
          format={(value) => `${value.toLocaleString('de-DE', { maximumFractionDigits: 1 })} kg`}
          formatAxis={(value) => value.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
        />
      </div>

      <div className="section-heading"><div><span className="eyebrow">7-Tage-Mittel</span><h2>Wochentrend</h2></div><span className="pill">Gewicht</span></div>
      <div className="grid-3 weekly-metrics">
        <Metric label="Diese Woche" value={weeks.current === null ? '–' : `${weeks.current.toFixed(1)} kg`} tone="green" />
        <Metric label="Vorwoche" value={weeks.previous === null ? '–' : `${weeks.previous.toFixed(1)} kg`} tone="taupe" />
        <Metric
          label="Veränderung"
          value={weeks.change === null ? '–' : `${weeks.change > 0 ? '+' : ''}${weeks.change.toFixed(2)} kg`}
          detail={weeks.change === null ? '14 Messungen nötig' : weeks.change > 0.05 ? 'Zunahme' : weeks.change < -0.05 ? 'Abnahme' : 'Stabil'}
          tone="blue"
        />
      </div>

      <Card className="maintenance-card stack">
        <div className="card__row card__row--top">
          <div>
            <span className="eyebrow">{estimate.maintenance ? 'Aus deinen Daten berechnet' : 'Vorläufig geschätzt'}</span>
            <div className="maintenance-card__number">{maintenance ? maintenance.toLocaleString('de-DE') : '–'} <small>kcal</small></div>
            <p>Dein täglicher Erhaltungsbedarf</p>
          </div>
          <span className="maintenance-card__icon"><Gauge size={22} /></span>
        </div>
        <div className={`energy-balance ${balance === null ? '' : balance > 0 ? 'energy-balance--surplus' : balance < 0 ? 'energy-balance--deficit' : 'energy-balance--even'}`}>
          <Sparkles size={17} />
          <span>{balanceLabel(balance)}</span>
        </div>
        {!estimate.maintenance && (
          <div className="stack stack--tight">
            <div className="row row--between tiny"><span>{Math.min(completeDays, 7)} von 7 kombinierten Tagen</span><span>{Math.round(Math.min(100, completeDays / 7 * 100))} %</span></div>
            <ProgressBar value={completeDays / 7 * 100} tone="blue" />
            <p className="tiny muted">Sobald an sieben Tagen Gewicht und Kalorien vorliegen, ersetzt Bont die Startschätzung automatisch.</p>
          </div>
        )}
      </Card>

      <Modal open={entryOpen} title="Werte eintragen" onClose={() => setEntryOpen(false)}>
        <div className="entry-date-card">
          <CalendarDays size={19} />
          <Field label="Datum" type="date" value={entryDate} max={today()} onChange={(event) => { setEntryDate(event.target.value); setSavedMetric(null) }} />
        </div>
        <p className="tiny muted entry-prefill-note">Die letzten Werte sind für schnelleres Eintragen vorbelegt. Gespeichert wird immer nur der Wert, dessen Button du drückst.</p>

        <section className="metric-entry metric-entry--violet">
          <div className="metric-entry__title"><Scale size={19} /><div><strong>Gewicht</strong><span>{existing?.weight_kg !== null && existing?.weight_kg !== undefined ? 'Für dieses Datum gespeichert' : 'Am besten morgens nüchtern'}</span></div></div>
          <NumberStepper label="Kilogramm" value={weight} onChange={setWeight} step={0.1} min={35} max={300} unit="kg" />
          <Button variant="secondary" full disabled={!weight} onClick={() => void saveMetric('weight_kg')}>{savedMetric === 'weight_kg' ? <><Check size={18} /> Gespeichert</> : 'Gewicht speichern'}</Button>
        </section>

        <section className="metric-entry metric-entry--orange">
          <div className="metric-entry__title"><Utensils size={19} /><div><strong>Kalorien</strong><span>{existing?.calories !== null && existing?.calories !== undefined ? 'Für dieses Datum gespeichert' : 'Kannst du abends ergänzen'}</span></div></div>
          <Field label="Kilokalorien" type="number" inputMode="numeric" min="0" max="10000" value={calories} onChange={(event) => setCalories(event.target.value)} placeholder="2500" />
          <Button variant="secondary" full disabled={calories === ''} onClick={() => void saveMetric('calories')}>{savedMetric === 'calories' ? <><Check size={18} /> Gespeichert</> : 'Kalorien speichern'}</Button>
        </section>

        <section className="metric-entry metric-entry--cyan">
          <div className="metric-entry__title"><Footprints size={19} /><div><strong>Schritte</strong><span>{existing?.steps !== null && existing?.steps !== undefined ? 'Für dieses Datum gespeichert' : 'Jederzeit nachtragen'}</span></div></div>
          <Field label="Anzahl Schritte" type="number" inputMode="numeric" min="0" max="100000" value={steps} onChange={(event) => setSteps(event.target.value)} placeholder="10000" />
          <Button variant="secondary" full disabled={steps === ''} onClick={() => void saveMetric('steps')}>{savedMetric === 'steps' ? <><Check size={18} /> Gespeichert</> : 'Schritte speichern'}</Button>
        </section>
      </Modal>
    </main>
  )
}

function balanceLabel(balance: number | null) {
  if (balance === null) return 'Heute noch keine Kalorien eingetragen'
  if (balance > 0) return `Heute ${balance.toLocaleString('de-DE')} kcal im Überschuss`
  if (balance < 0) return `Heute ${Math.abs(balance).toLocaleString('de-DE')} kcal im Defizit`
  return 'Heute kein Überschuss und kein Defizit'
}

function MetricChart({
  icon,
  label,
  values,
  tone,
  format,
  formatAxis,
}: {
  icon: ReactNode
  label: string
  values: { date: string; value: number }[]
  tone: 'orange' | 'cyan' | 'violet'
  format: (value: number) => string
  formatAxis: (value: number) => string
}) {
  const pageSize = 7
  const pageCount = Math.max(1, Math.ceil(values.length / pageSize))
  const [page, setPage] = useState(0)
  const pointerStart = useRef<number | null>(null)

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1))
  }, [pageCount])

  const end = Math.max(0, values.length - page * pageSize)
  const start = Math.max(0, end - pageSize)
  const visibleValues = values.slice(start, end)
  const latest = visibleValues.at(-1)
  const rawMin = visibleValues.length ? Math.min(...visibleValues.map((point) => point.value)) : 0
  const rawMax = visibleValues.length ? Math.max(...visibleValues.map((point) => point.value)) : 1
  const rawRange = rawMax - rawMin
  const padding = rawRange ? rawRange * 0.14 : Math.max(Math.abs(rawMax) * 0.025, 0.5)
  const yMin = rawMin - padding
  const yMax = rawMax + padding
  const range = yMax - yMin || 1
  const plotLeft = 54
  const plotRight = 344
  const plotTop = 20
  const plotBottom = 138
  const points = visibleValues.map((point, index) => ({
    x: visibleValues.length === 1 ? (plotLeft + plotRight) / 2 : plotLeft + index * ((plotRight - plotLeft) / (visibleValues.length - 1)),
    y: plotBottom - ((point.value - yMin) / range) * (plotBottom - plotTop),
  }))
  const line = points.map((point) => `${point.x},${point.y}`).join(' ')
  const yTicks = [yMax, (yMax + yMin) / 2, yMin]
  const firstDate = visibleValues[0]?.date
  const showOlder = page < pageCount - 1
  const showNewer = page > 0

  function changePage(next: number) {
    setPage(Math.max(0, Math.min(pageCount - 1, next)))
  }

  function finishSwipe(clientX: number) {
    if (pointerStart.current === null) return
    const distance = clientX - pointerStart.current
    pointerStart.current = null
    if (Math.abs(distance) < 42) return
    changePage(distance > 0 ? page + 1 : page - 1)
  }

  return (
    <Card className={`metric-chart metric-chart--${tone}`}>
      <div className="metric-chart__head">
        <span className="metric-chart__icon">{icon}</span>
        <div><span>{label}</span><strong>{latest ? format(latest.value) : 'Noch kein Wert'}</strong></div>
        {values.length > pageSize && <span className="metric-chart__range">{page === 0 ? 'Neueste 7' : `${start + 1}–${end} von ${values.length}`}</span>}
      </div>
      <div
        className="metric-chart__plot"
        onPointerDown={(event) => { pointerStart.current = event.clientX }}
        onPointerUp={(event) => finishSwipe(event.clientX)}
        onPointerCancel={() => { pointerStart.current = null }}
      >
        {visibleValues.length ? (
          <svg viewBox="0 0 360 174" role="img" aria-label={`${label}: ${visibleValues.length} Einträge von ${formatDate(firstDate!)} bis ${formatDate(latest!.date)}`}>
            <title>{`${label} von ${formatDate(firstDate!)} bis ${formatDate(latest!.date)}`}</title>
            {yTicks.map((tick, index) => {
              const y = plotTop + index * ((plotBottom - plotTop) / 2)
              return (
                <g key={tick}>
                  <line x1={plotLeft} x2={plotRight} y1={y} y2={y} className="metric-chart__grid" />
                  <text x={plotLeft - 8} y={y + 3} textAnchor="end" className="metric-chart__axis-label">{formatAxis(tick)}</text>
                </g>
              )
            })}
            <line x1={plotLeft} x2={plotLeft} y1={plotTop} y2={plotBottom} className="metric-chart__axis" />
            <line x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} className="metric-chart__axis" />
            {visibleValues.length > 1 && <polyline points={line} className="metric-chart__line" />}
            {points.map((point, index) => (
              <g key={`${visibleValues[index].date}-${index}`}>
                <circle cx={point.x} cy={point.y} r={index === points.length - 1 ? 4.5 : 3} className="metric-chart__point">
                  <title>{`${formatDate(visibleValues[index].date)}: ${format(visibleValues[index].value)}`}</title>
                </circle>
                <text x={point.x} y="158" textAnchor="middle" className="metric-chart__date-label">{formatDate(visibleValues[index].date)}</text>
              </g>
            ))}
          </svg>
        ) : <div className="metric-chart__empty">Mit deinem ersten Eintrag entsteht hier der Verlauf.</div>}
      </div>
      {values.length > pageSize && (
        <div className="metric-chart__pager">
          <button type="button" disabled={!showOlder} onClick={() => changePage(page + 1)} aria-label={`${label}: ältere Einträge zeigen`}><ChevronLeft size={17} /> Älter</button>
          <span>7 Werte pro Ansicht</span>
          <button type="button" disabled={!showNewer} onClick={() => changePage(page - 1)} aria-label={`${label}: neuere Einträge zeigen`}>Neuer <ChevronRight size={17} /></button>
        </div>
      )}
    </Card>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' }).format(new Date(`${value}T12:00:00`))
}

function compactNumber(value: number) {
  return new Intl.NumberFormat('de-DE', {
    notation: Math.abs(value) >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: Math.abs(value) >= 1000 ? 1 : 0,
  }).format(Math.max(0, value))
}
