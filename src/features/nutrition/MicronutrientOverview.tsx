import { ChevronRight, Info } from 'lucide-react'
import { Card, InfoNote, ProgressBar } from '../../components/ui'
import { getNutrientTarget, nutrientReferences, type NutrientReference } from '../../lib/nutrients'
import type { Profile } from '../../types'

export function MicronutrientOverview({
  profile,
  totals,
  available,
  onInfo,
}: {
  profile: Profile
  totals: Record<string, number>
  available: Set<string>
  onInfo: (nutrient: NutrientReference) => void
}) {
  const availableCount = nutrientReferences.filter((nutrient) => available.has(nutrient.key)).length
  return (
    <Card className="stack micronutrient-card">
      <div className="section-heading section-heading--inside">
        <div>
          <span className="eyebrow">Tagesübersicht</span>
          <h2>Mikronährstoffe</h2>
        </div>
        <span className="pill">
          {availableCount}/{nutrientReferences.length} mit Daten
        </span>
      </div>
      <InfoNote>
        „Keine Daten“ bedeutet, dass der gewählte Produkteintrag diesen Nährstoff nicht enthält – nicht, dass du 0 %
        aufgenommen hast.
      </InfoNote>
      <div className="nutrient-list">
        {nutrientReferences.map((nutrient) => {
          const target = getNutrientTarget(nutrient, profile)
          const consumed = totals[nutrient.key]
          const isAvailable = available.has(nutrient.key)
          const percent = target ? (consumed / target) * 100 : 0
          return (
            <div className={`nutrient-row ${isAvailable ? '' : 'nutrient-row--unknown'}`} key={nutrient.key}>
              <button
                className="nutrient-row__info"
                onClick={() => onInfo(nutrient)}
                aria-label={`Information zu ${nutrient.label}`}
              >
                <Info size={16} />
              </button>
              <div>
                <div className="row row--between">
                  <strong>{nutrient.label}</strong>
                  <span>{isAvailable ? `${Math.round(percent)} %` : 'Keine Daten'}</span>
                </div>
                <ProgressBar value={isAvailable ? percent : 0} tone="green" />
                <span className="tiny muted">
                  {isAvailable
                    ? `${consumed.toFixed(consumed < 10 ? 1 : 0)} von ${target} ${nutrient.unit}`
                    : 'Nicht in den gewählten Produktdaten enthalten'}
                </span>
              </div>
            </div>
          )
        })}
      </div>
      <a className="source-link" href="https://www.dge.de/wissenschaft/referenzwerte/" target="_blank" rel="noreferrer">
        DGE-Referenzwerte ansehen <ChevronRight size={15} />
      </a>
    </Card>
  )
}
