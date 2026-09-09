import { BarChart3 } from 'lucide-react'
import { EmptyState, Modal } from '../../components/ui'
import type { Exercise, WorkoutSession, WorkoutSet } from '../../types'
import { useExerciseProgressData } from './use-workout-data'

export function ExerciseProgressModal({
  open,
  exercise,
  userId,
  onClose,
}: {
  open: boolean
  exercise: Exercise | null
  userId: string
  onClose: () => void
}) {
  const history = useExerciseProgressData(userId, exercise?.id)

  return (
    <Modal open={open} title={exercise?.name ?? 'Fortschritt'} onClose={onClose}>
      {history.length === 0 ? (
        <EmptyState
          icon={<BarChart3 size={24} />}
          title="Noch kein Verlauf"
          text="Nach deinem ersten abgeschlossenen Training erscheint hier Gewicht pro Satz mit den jeweiligen Wiederholungen."
        />
      ) : (
        <>
          <ExerciseChart history={history} />
          <div className="stack stack--tight">
            {history
              .slice()
              .reverse()
              .map(({ session, sets: sessionSets }) => (
                <div className="history-row" key={session.id}>
                  <span>
                    {new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(
                      new Date(session.started_at),
                    )}
                  </span>
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
  const points = history.flatMap((item, historyIndex) =>
    item.sets.map((set, setIndex) => ({
      x: xFor(historyIndex, setIndex, item.sets.length),
      y: yFor(set.weight_kg ?? 0),
      set,
    })),
  )

  return (
    <svg className="chart exercise-chart" viewBox="0 0 360 190" role="img" aria-label="Gewichtsverlauf pro Satz">
      {[40, 90, 140].map((y) => (
        <line className="chart-grid" key={y} x1="24" x2="336" y1={y} y2={y} />
      ))}
      {points.slice(1).map((point, index) => (
        <line
          key={`${point.x}-${point.y}`}
          x1={points[index].x}
          y1={points[index].y}
          x2={point.x}
          y2={point.y}
          className="chart-line--blue"
          strokeWidth="2"
          opacity="0.55"
        />
      ))}
      {points.map((point) => (
        <g key={point.set.id}>
          <circle className="chart-point chart-line--blue" cx={point.x} cy={point.y} r="4" />
          <text x={point.x} y={point.y - 9} textAnchor="middle">
            {point.set.weight_kg}
          </text>
          <text x={point.x} y="162" textAnchor="middle">
            {point.set.reps}
          </text>
        </g>
      ))}
      <text x="22" y="17">
        kg
      </text>
      <text x="338" y="181" textAnchor="end">
        Wiederholungen unter den Punkten
      </text>
    </svg>
  )
}
