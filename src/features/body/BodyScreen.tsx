import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CalendarDays, Check, Footprints, Gauge, Pencil, Plus, Scale, Sparkles, Trash2, Utensils } from 'lucide-react'
import { Button, Card, Field, Metric, Modal, NumberStepper, ProgressBar } from '../../components/ui'
import { useBodyData } from './use-body-data'
import { getUserMessage } from '../../lib/errors'
import { localDateString } from '../../lib/date'
import { estimateMaintenance, weeklyAverages } from '../../lib/maintenance'
import { calorieTargetForDate } from '../../lib/calorie-target'
import { saveBodyMetric, type BodyMetric } from './commands'
import { calculateNiceAxis, formatAxisTick } from './nice-axis'

const today = localDateString

export function BodyScreen({ userId }: { userId: string }) {
  const { entries, settings, goalHistory } = useBodyData(userId)
  const [entryOpen, setEntryOpen] = useState(false)
  const [entryDate, setEntryDate] = useState(today())
  const [weight, setWeight] = useState('')
  const [calories, setCalories] = useState('')
  const [steps, setSteps] = useState('')
  const [savedMetric, setSavedMetric] = useState<BodyMetric | null>(null)
  const [metricError, setMetricError] = useState('')
  const [savingMetric, setSavingMetric] = useState<BodyMetric | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<{ metric: BodyMetric; date: string; value: number } | null>(null)

  const existing = entries.find((entry) => entry.entry_date === entryDate)

  function hydrateEntry(nextDate: string) {
    const selected = entries.find((entry) => entry.entry_date === nextDate)
    const previous = entries
      .filter((entry) => entry.entry_date < nextDate)
      .slice()
      .reverse()
    const previousWeight = previous.find((entry) => entry.weight_kg !== null)?.weight_kg
    const previousCalories = previous.find((entry) => entry.calories !== null)?.calories
    const previousSteps = previous.find((entry) => entry.steps !== null)?.steps
    setWeight(String(selected?.weight_kg ?? previousWeight ?? ''))
    setCalories(String(selected?.calories ?? previousCalories ?? ''))
    setSteps(String(selected?.steps ?? previousSteps ?? ''))
  }

  const todayDate = today()
  const analysisEntries = useMemo(() => entries.filter((entry) => entry.entry_date <= todayDate), [entries, todayDate])
  const estimate = useMemo(() => estimateMaintenance(analysisEntries, todayDate), [analysisEntries, todayDate])
  const weeks = useMemo(() => weeklyAverages(analysisEntries, todayDate), [analysisEntries, todayDate])
  const completeDays = analysisEntries.filter(
    (entry) => entry.weight_kg !== null && entry.weight_kg > 0 && entry.calories !== null && entry.calories > 0,
  ).length
  const maintenance = estimate.maintenance ?? settings?.preliminary_maintenance ?? null
  const todayCalories = entries.find((entry) => entry.entry_date === todayDate)?.calories ?? null
  const balance = maintenance !== null && todayCalories !== null ? Math.round(todayCalories - maintenance) : null

  const chartData = useMemo(
    () => ({
      calories: entries
        .filter((entry) => entry.calories !== null)
        .map((entry) => ({
          date: entry.entry_date,
          value: entry.calories!,
          target: calorieTargetForDate({ date: entry.entry_date, entries, settings, history: goalHistory }),
        })),
      steps: entries
        .filter((entry) => entry.steps !== null)
        .map((entry) => ({ date: entry.entry_date, value: entry.steps! })),
      weight: entries
        .filter((entry) => entry.weight_kg !== null)
        .map((entry) => ({ date: entry.entry_date, value: entry.weight_kg! })),
    }),
    [entries, goalHistory, settings],
  )

  function openEntry(date = todayDate) {
    const nextDate = date
    setEntryDate(nextDate)
    hydrateEntry(nextDate)
    setSavedMetric(null)
    setEntryOpen(true)
  }

  async function saveMetric(metric: BodyMetric) {
    const raw = metric === 'weight_kg' ? weight : metric === 'calories' ? calories : steps
    if (raw === '' || Number.isNaN(Number(raw))) return
    const value = metric === 'weight_kg' ? Number(raw) : Math.round(Number(raw))
    if (
      (metric === 'weight_kg' && (value < 35 || value > 300)) ||
      (metric === 'calories' && (value < 0 || value > 10_000)) ||
      (metric === 'steps' && (value < 0 || value > 100_000))
    )
      return
    setSavingMetric(metric)
    setMetricError('')
    try {
      await saveBodyMetric({ userId, entryDate, metric, value })
      setSavedMetric(metric)
      window.setTimeout(() => setSavedMetric((current) => (current === metric ? null : current)), 1500)
    } catch (error) {
      setMetricError(getUserMessage(error, 'Der Körperwert konnte nicht gespeichert werden.'))
    } finally {
      setSavingMetric(null)
    }
  }

  async function clearMetric(metric: BodyMetric, date = entryDate) {
    setSavingMetric(metric)
    setMetricError('')
    let success = false
    try {
      await saveBodyMetric({ userId, entryDate: date, metric, value: null })
      if (date === entryDate) {
        if (metric === 'weight_kg') setWeight('')
        if (metric === 'calories') setCalories('')
        if (metric === 'steps') setSteps('')
      }
      success = true
    } catch (error) {
      setMetricError(getUserMessage(error, 'Der Körperwert konnte nicht gelöscht werden.'))
    } finally {
      setSavingMetric(null)
    }
    return success
  }

  async function deleteSelectedPoint() {
    if (!selectedPoint) return
    try {
      if (await clearMetric(selectedPoint.metric, selectedPoint.date)) setSelectedPoint(null)
    } catch {
      // The detailed error is shown in the editor, where it can be acted on.
    }
  }

  function editSelectedPoint() {
    if (!selectedPoint) return
    openEntry(selectedPoint.date)
    setSelectedPoint(null)
  }

  return (
    <main className="content body-dashboard">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Körperanalyse</span>
          <h1>Deine Entwicklung auf einen Blick.</h1>
        </div>
        <button className="quick-add" onClick={() => openEntry()} aria-label="Körperwerte eintragen">
          <Plus size={22} />
        </button>
      </div>

      <div className="chart-grid-cards">
        <MetricChart
          icon={<Utensils size={18} />}
          label="Kalorien"
          values={chartData.calories.map(({ date, value }) => ({ date, value }))}
          secondaryValues={chartData.calories
            .filter((point): point is { date: string; value: number; target: number } => point.target !== null)
            .map(({ date, target }) => ({ date, value: target }))}
          secondaryLabel="Soll"
          metric="calories"
          tone="orange"
          format={(value) => `${Math.round(value).toLocaleString('de-DE')} kcal`}
          onPointSelect={(point) => setSelectedPoint({ metric: 'calories', ...point })}
        />
        <MetricChart
          icon={<Footprints size={18} />}
          label="Schritte"
          values={chartData.steps}
          metric="steps"
          tone="cyan"
          format={(value) => Math.round(value).toLocaleString('de-DE')}
          onPointSelect={(point) => setSelectedPoint({ metric: 'steps', ...point })}
        />
        <MetricChart
          icon={<Scale size={18} />}
          label="Gewicht"
          values={chartData.weight}
          metric="weight"
          tone="violet"
          format={(value) => `${value.toLocaleString('de-DE', { maximumFractionDigits: 1 })} kg`}
          onPointSelect={(point) => setSelectedPoint({ metric: 'weight_kg', ...point })}
        />
      </div>

      <div className="section-heading">
        <div>
          <span className="eyebrow">7-Tage-Mittel</span>
          <h2>Wochentrend</h2>
        </div>
        <span className="pill">Gewicht</span>
      </div>
      <div className="grid-3 weekly-metrics">
        <Metric
          label="Diese Woche"
          value={weeks.current === null ? '–' : `${weeks.current.toFixed(1)} kg`}
          tone="green"
        />
        <Metric
          label="Vorwoche"
          value={weeks.previous === null ? '–' : `${weeks.previous.toFixed(1)} kg`}
          tone="taupe"
        />
        <Metric
          label="Veränderung"
          value={weeks.change === null ? '–' : `${weeks.change > 0 ? '+' : ''}${weeks.change.toFixed(2)} kg`}
          detail={
            weeks.change === null
              ? '14 Messungen nötig'
              : weeks.change > 0.05
                ? 'Zunahme'
                : weeks.change < -0.05
                  ? 'Abnahme'
                  : 'Stabil'
          }
          tone="blue"
        />
      </div>

      <Card className="maintenance-card stack">
        <div className="card__row card__row--top">
          <div>
            <span className="eyebrow">
              {estimate.maintenance ? 'Aus deinen Daten berechnet' : 'Vorläufig geschätzt'}
            </span>
            <div className="maintenance-card__number">
              {maintenance ? maintenance.toLocaleString('de-DE') : '–'} <small>kcal</small>
            </div>
            <p>Dein täglicher Erhaltungsbedarf</p>
          </div>
          <span className="maintenance-card__icon">
            <Gauge size={22} />
          </span>
        </div>
        <div
          className={`energy-balance ${balance === null ? '' : balance > 0 ? 'energy-balance--surplus' : balance < 0 ? 'energy-balance--deficit' : 'energy-balance--even'}`}
        >
          <Sparkles size={17} />
          <span>{balanceLabel(balance)}</span>
        </div>
        {!estimate.maintenance && (
          <div className="stack stack--tight">
            <div className="row row--between tiny">
              <span>{Math.min(completeDays, 7)} von 7 kombinierten Tagen</span>
              <span>{Math.round(Math.min(100, (completeDays / 7) * 100))} %</span>
            </div>
            <ProgressBar value={(completeDays / 7) * 100} tone="blue" />
            <p className="tiny muted">
              Sobald an sieben Tagen Gewicht und Kalorien vorliegen, ersetzt Bont die Startschätzung automatisch.
            </p>
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(selectedPoint)}
        title={
          selectedPoint ? `${metricLabel(selectedPoint.metric)} am ${formatFullDate(selectedPoint.date)}` : 'Messwert'
        }
        onClose={() => setSelectedPoint(null)}
      >
        {selectedPoint && (
          <div className="stack">
            <Card className="card--soft stack stack--tight">
              <span className="eyebrow">Gespeicherter Wert</span>
              <strong>{formatMetricValue(selectedPoint.metric, selectedPoint.value)}</strong>
            </Card>
            <Button variant="secondary" full onClick={editSelectedPoint}>
              <Pencil size={17} /> Bearbeiten
            </Button>
            <Button variant="danger" full onClick={() => void deleteSelectedPoint()} disabled={Boolean(savingMetric)}>
              <Trash2 size={17} /> Löschen
            </Button>
            {metricError && (
              <p className="form-error" role="alert">
                {metricError}
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal open={entryOpen} title="Werte eintragen" onClose={() => setEntryOpen(false)}>
        <div className="entry-date-card">
          <CalendarDays size={19} />
          <Field
            label="Datum"
            type="date"
            value={entryDate}
            onChange={(event) => {
              setEntryDate(event.target.value)
              hydrateEntry(event.target.value)
              setSavedMetric(null)
            }}
          />
        </div>
        <p className="tiny muted entry-prefill-note">
          Die letzten Werte sind für schnelleres Eintragen vorbelegt. Gespeichert wird immer nur der Wert, dessen Button
          du drückst.
        </p>

        <section className="metric-entry metric-entry--violet">
          <div className="metric-entry__title">
            <Scale size={19} />
            <div>
              <strong>Gewicht</strong>
              <span>
                {existing?.weight_kg !== null && existing?.weight_kg !== undefined
                  ? 'Für dieses Datum gespeichert'
                  : 'Am besten morgens nüchtern'}
              </span>
            </div>
          </div>
          <NumberStepper
            label="Kilogramm"
            value={weight}
            onChange={setWeight}
            step={0.1}
            min={35}
            max={300}
            unit="kg"
          />
          <Button
            variant="secondary"
            full
            disabled={!weight || Boolean(savingMetric)}
            onClick={() => void saveMetric('weight_kg')}
          >
            {savedMetric === 'weight_kg' ? (
              <>
                <Check size={18} /> Gespeichert
              </>
            ) : (
              'Gewicht speichern'
            )}
          </Button>
          <Button
            variant="ghost"
            full
            disabled={existing?.weight_kg === null || existing?.weight_kg === undefined || Boolean(savingMetric)}
            onClick={() => void clearMetric('weight_kg')}
          >
            Gewicht löschen
          </Button>
        </section>

        <section className="metric-entry metric-entry--orange">
          <div className="metric-entry__title">
            <Utensils size={19} />
            <div>
              <strong>Kalorien</strong>
              <span>
                {existing?.calories !== null && existing?.calories !== undefined
                  ? 'Für dieses Datum gespeichert'
                  : 'Kannst du abends ergänzen'}
              </span>
            </div>
          </div>
          <Field
            label="Kilokalorien"
            type="number"
            inputMode="numeric"
            min="0"
            max="10000"
            value={calories}
            onChange={(event) => setCalories(event.target.value)}
            placeholder="2500"
          />
          <Button
            variant="secondary"
            full
            disabled={calories === '' || Boolean(savingMetric)}
            onClick={() => void saveMetric('calories')}
          >
            {savedMetric === 'calories' ? (
              <>
                <Check size={18} /> Gespeichert
              </>
            ) : (
              'Kalorien speichern'
            )}
          </Button>
          <Button
            variant="ghost"
            full
            disabled={existing?.calories === null || existing?.calories === undefined || Boolean(savingMetric)}
            onClick={() => void clearMetric('calories')}
          >
            Kalorien löschen
          </Button>
        </section>

        <section className="metric-entry metric-entry--cyan">
          <div className="metric-entry__title">
            <Footprints size={19} />
            <div>
              <strong>Schritte</strong>
              <span>
                {existing?.steps !== null && existing?.steps !== undefined
                  ? 'Für dieses Datum gespeichert'
                  : 'Jederzeit nachtragen'}
              </span>
            </div>
          </div>
          <Field
            label="Anzahl Schritte"
            type="number"
            inputMode="numeric"
            min="0"
            max="100000"
            value={steps}
            onChange={(event) => setSteps(event.target.value)}
            placeholder="10000"
          />
          <Button
            variant="secondary"
            full
            disabled={steps === '' || Boolean(savingMetric)}
            onClick={() => void saveMetric('steps')}
          >
            {savedMetric === 'steps' ? (
              <>
                <Check size={18} /> Gespeichert
              </>
            ) : (
              'Schritte speichern'
            )}
          </Button>
          <Button
            variant="ghost"
            full
            disabled={existing?.steps === null || existing?.steps === undefined || Boolean(savingMetric)}
            onClick={() => void clearMetric('steps')}
          >
            Schritte löschen
          </Button>
        </section>
        {metricError && (
          <p className="form-error" role="alert">
            {metricError}
          </p>
        )}
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
  secondaryValues = [],
  secondaryLabel,
  metric,
  tone,
  format,
  onPointSelect,
}: {
  icon: ReactNode
  label: string
  values: { date: string; value: number }[]
  secondaryValues?: { date: string; value: number }[]
  secondaryLabel?: string
  metric: 'weight' | 'calories' | 'steps'
  tone: 'orange' | 'cyan' | 'violet'
  format: (value: number) => string
  onPointSelect?: (point: { date: string; value: number }) => void
}) {
  const pageSize = 7
  const pageCount = Math.max(1, Math.ceil(values.length / pageSize))
  const storageKey = `bont-chart-page:${label}`
  const [page, setPage] = useState(() => {
    if (typeof sessionStorage === 'undefined') return 0
    try {
      const stored = Number(sessionStorage.getItem(storageKey))
      return Number.isInteger(stored) && stored >= 0 ? stored : 0
    } catch {
      return 0
    }
  })
  const pointerStart = useRef<number | null>(null)

  useEffect(() => {
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(storageKey, String(page))
    } catch {
      // Persisting the chart viewport is optional.
    }
  }, [page, storageKey])

  const currentPage = Math.min(page, pageCount - 1)
  const end = Math.max(0, values.length - currentPage * pageSize)
  const start = Math.max(0, end - pageSize)
  const visibleValues = values.slice(start, end)
  const visibleSecondaryValues = secondaryValues.filter((point) =>
    visibleValues.some((value) => value.date === point.date),
  )
  const latest = visibleValues.at(-1)
  const axisValues = [...visibleValues, ...visibleSecondaryValues]
  const axis = calculateNiceAxis({
    min: axisValues.length ? Math.min(...axisValues.map((point) => point.value)) : 0,
    max: axisValues.length ? Math.max(...axisValues.map((point) => point.value)) : 1,
    targetTickCount: 4,
    metric,
  })
  const range = axis.max - axis.min || 1
  const plotLeft = 54
  const plotRight = 344
  const plotTop = 20
  const plotBottom = 138
  const points = visibleValues.map((point, index) => ({
    x:
      visibleValues.length === 1
        ? (plotLeft + plotRight) / 2
        : plotLeft + index * ((plotRight - plotLeft) / (visibleValues.length - 1)),
    y: plotBottom - ((point.value - axis.min) / range) * (plotBottom - plotTop),
  }))
  const line = points.map((point) => `${point.x},${point.y}`).join(' ')
  const targetPoints = visibleSecondaryValues.map((point) => {
    const index = visibleValues.findIndex((value) => value.date === point.date)
    const x =
      visibleValues.length === 1
        ? (plotLeft + plotRight) / 2
        : plotLeft + index * ((plotRight - plotLeft) / (visibleValues.length - 1))
    return { ...point, x, y: plotBottom - ((point.value - axis.min) / range) * (plotBottom - plotTop) }
  })
  const targetLine = targetPoints.map((point) => `${point.x},${point.y}`).join(' ')
  const firstDate = visibleValues[0]?.date
  function changePage(next: number) {
    setPage(Math.max(0, Math.min(pageCount - 1, next)))
  }

  function finishSwipe(clientX: number) {
    if (pointerStart.current === null) return
    const distance = clientX - pointerStart.current
    pointerStart.current = null
    if (Math.abs(distance) < 42) return
    changePage(distance > 0 ? currentPage + 1 : currentPage - 1)
  }

  return (
    <Card className={`metric-chart metric-chart--${tone}`}>
      <div className="metric-chart__head">
        <span className="metric-chart__icon">{icon}</span>
        <div>
          <span>{label}</span>
          <strong>{latest ? format(latest.value) : 'Noch kein Wert'}</strong>
        </div>
        {secondaryValues.length > 0 && (
          <div className="metric-chart__legend" aria-label="Legende">
            <span>
              <i className="metric-chart__legend-line" /> Ist
            </span>
            <span>
              <i className="metric-chart__legend-line metric-chart__legend-line--target" />{' '}
              {secondaryLabel ?? 'Vergleich'}
            </span>
          </div>
        )}
        {values.length > pageSize && (
          <span className="metric-chart__range">
            {currentPage === 0 ? 'Neueste 7' : `${start + 1}–${end} von ${values.length}`}
          </span>
        )}
      </div>
      <div
        className="metric-chart__plot"
        onPointerDown={(event) => {
          pointerStart.current = event.clientX
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerUp={(event) => finishSwipe(event.clientX)}
        onPointerCancel={() => {
          pointerStart.current = null
        }}
      >
        {visibleValues.length ? (
          <svg
            viewBox="0 0 360 174"
            role="img"
            aria-label={`${label}: ${visibleValues.length} Einträge von ${formatDate(firstDate!)} bis ${formatDate(latest!.date)}`}
          >
            <title>{`${label} von ${formatDate(firstDate!)} bis ${formatDate(latest!.date)}`}</title>
            {axis.ticks.map((tick) => {
              const y = plotBottom - ((tick - axis.min) / range) * (plotBottom - plotTop)
              return (
                <g key={tick}>
                  <line x1={plotLeft} x2={plotRight} y1={y} y2={y} className="metric-chart__grid" />
                  <text x={plotLeft - 8} y={y + 3} textAnchor="end" className="metric-chart__axis-label">
                    {formatAxisTick(tick, metric, axis.step)}
                  </text>
                </g>
              )
            })}
            <line x1={plotLeft} x2={plotLeft} y1={plotTop} y2={plotBottom} className="metric-chart__axis" />
            <line x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} className="metric-chart__axis" />
            {visibleValues.length > 1 && <polyline points={line} className="metric-chart__line" />}
            {targetPoints.length > 1 && <polyline points={targetLine} className="metric-chart__target-line" />}
            {points.map((point, index) => (
              <g key={`${visibleValues[index].date}-${index}`}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={index === points.length - 1 ? 4.5 : 3}
                  className={`metric-chart__point ${onPointSelect ? 'metric-chart__point--interactive' : ''}`}
                  role={onPointSelect ? 'button' : undefined}
                  tabIndex={onPointSelect ? 0 : undefined}
                  aria-label={
                    onPointSelect
                      ? `${formatDate(visibleValues[index].date)}: ${format(visibleValues[index].value)}`
                      : undefined
                  }
                  onClick={() => onPointSelect?.(visibleValues[index])}
                  onKeyDown={(event) => {
                    if (onPointSelect && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault()
                      onPointSelect(visibleValues[index])
                    }
                  }}
                >
                  <title>{`${formatDate(visibleValues[index].date)}: ${format(visibleValues[index].value)}`}</title>
                </circle>
                <text x={point.x} y="158" textAnchor="middle" className="metric-chart__date-label">
                  {formatDate(visibleValues[index].date)}
                </text>
              </g>
            ))}
          </svg>
        ) : (
          <div className="metric-chart__empty">Mit deinem ersten Eintrag entsteht hier der Verlauf.</div>
        )}
      </div>
      {values.length > pageSize && (
        <div className="metric-chart__pager">
          <span>Horizontal wischen oder mit der Maus ziehen · 7 Werte pro Ansicht</span>
        </div>
      )}
    </Card>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' }).format(new Date(`${value}T12:00:00`))
}

function formatFullDate(value: string) {
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(`${value}T12:00:00`),
  )
}

function metricLabel(metric: BodyMetric) {
  return metric === 'weight_kg' ? 'Gewicht' : metric === 'calories' ? 'Kalorien' : 'Schritte'
}

function formatMetricValue(metric: BodyMetric, value: number) {
  if (metric === 'weight_kg') return `${value.toLocaleString('de-DE', { maximumFractionDigits: 1 })} kg`
  return `${Math.round(value).toLocaleString('de-DE')}${metric === 'calories' ? ' kcal' : ''}`
}
