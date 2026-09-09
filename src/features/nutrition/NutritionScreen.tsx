import { useMemo, useState, type CSSProperties } from 'react'
import { ChevronDown, ChevronUp, Database, Pencil } from 'lucide-react'
import { Button, Card, Metric, Modal } from '../../components/ui'
import { localDateString } from '../../lib/date'
import { getUserMessage } from '../../lib/errors'
import { estimateMaintenance } from '../../lib/maintenance'
import { getNutrientTarget, nutrientReferences, type NutrientReference } from '../../lib/nutrients'
import type { FoodEntry, GoalMode, MealSlot, Profile } from '../../types'
import { FoodSearchModal } from './FoodSearchModal'
import { GoalSettings } from './GoalSettings'
import { MealList } from './MealList'
import { MealManager } from './MealManager'
import { MicronutrientOverview } from './MicronutrientOverview'
import { sumFood } from './nutrition-utils'
import { deleteFoodEntry, updateCalorieAdjustment, updateGoal as updateGoalCommand } from './commands'
import { useNutritionData } from './use-nutrition-data'

const today = localDateString

export function NutritionScreen({ userId, profile }: { userId: string; profile: Profile }) {
  const [date, setDate] = useState(today())
  const [activeMeal, setActiveMeal] = useState<MealSlot | null>(null)
  const [manageMeals, setManageMeals] = useState(false)
  const [microInfo, setMicroInfo] = useState<NutrientReference | null>(null)
  const [showMicronutrients, setShowMicronutrients] = useState(false)
  const [actionError, setActionError] = useState('')

  const { settings, entries, bodyEntries, mealSlots } = useNutritionData(userId)
  const todayEntries = useMemo(() => entries.filter((entry) => entry.entry_date === date), [date, entries])
  const maintenance = useMemo(() => estimateMaintenance(bodyEntries), [bodyEntries])
  const baseTarget = maintenance.maintenance ?? settings?.preliminary_maintenance ?? 0
  const calorieTarget = Math.max(
    0,
    baseTarget +
      (settings?.goal_mode === 'cut'
        ? -(settings?.calorie_adjustment ?? 0)
        : settings?.goal_mode === 'bulk'
          ? (settings?.calorie_adjustment ?? 0)
          : 0),
  )
  const totals = useMemo(() => sumFood(todayEntries), [todayEntries])
  const remainingCalories = Math.round(calorieTarget - totals.calories)
  const calorieProgress = calorieTarget ? (totals.calories / calorieTarget) * 100 : 0

  async function updateGoal(mode: GoalMode) {
    if (!settings) return
    try {
      setActionError('')
      await updateGoalCommand(settings, mode)
    } catch (error) {
      setActionError(getUserMessage(error, 'Das Ziel konnte nicht gespeichert werden.'))
    }
  }

  async function updateAdjustment(value: number) {
    if (!settings) return
    try {
      setActionError('')
      await updateCalorieAdjustment(settings, value)
    } catch (error) {
      setActionError(getUserMessage(error, 'Die Kalorienanpassung konnte nicht gespeichert werden.'))
    }
  }

  async function removeFood(entry: FoodEntry) {
    try {
      setActionError('')
      await deleteFoodEntry(userId, entry)
    } catch (error) {
      setActionError(getUserMessage(error, 'Das Lebensmittel konnte nicht gelöscht werden.'))
    }
  }

  const micronutrientTotals = useMemo(
    () =>
      nutrientReferences.reduce<Record<string, number>>((result, nutrient) => {
        result[nutrient.key] = todayEntries.reduce(
          (sum, entry) => sum + Number(entry.micronutrients?.[nutrient.key] ?? 0),
          0,
        )
        return result
      }, {}),
    [todayEntries],
  )
  const availableMicronutrients = useMemo(
    () => new Set(todayEntries.flatMap((entry) => Object.keys(entry.micronutrients ?? {}))),
    [todayEntries],
  )

  return (
    <main className="content">
      <div className="page-intro">
        <p className="page-intro__greeting">Guten Appetit, {profile.display_name}.</p>
        <h1>Ernährung</h1>
      </div>

      <Card className="card--accent stack nutrition-hero">
        <div className="card__row card__row--top">
          <div>
            <span className="eyebrow">Tagesziel</span>
            <div className="hero-number">{calorieTarget ? calorieTarget.toLocaleString('de-DE') : '–'} kcal</div>
          </div>
          <label className="compact-date">
            <span>Datum</span>
            <input type="date" value={date} max={today()} onChange={(event) => setDate(event.target.value)} />
          </label>
        </div>
        <div className="calorie-budget">
          <div
            className={`calorie-ring ${remainingCalories < 0 ? 'calorie-ring--over' : ''}`}
            style={{ '--calorie-progress': `${Math.min(100, Math.max(0, calorieProgress)) * 3.6}deg` } as CSSProperties}
            role="img"
            aria-label={`${Math.round(totals.calories)} von ${Math.round(calorieTarget)} Kilokalorien gegessen`}
          >
            <div className="calorie-ring__inside">
              <strong>{Math.abs(remainingCalories).toLocaleString('de-DE')}</strong>
              <span>{remainingCalories < 0 ? 'kcal darüber' : 'kcal übrig'}</span>
            </div>
          </div>
          <div className="calorie-budget__legend">
            <div>
              <span className="calorie-dot calorie-dot--eaten" />
              <span>Gegessen</span>
              <strong>{Math.round(totals.calories).toLocaleString('de-DE')} kcal</strong>
            </div>
            <div>
              <span className="calorie-dot calorie-dot--target" />
              <span>Tagesziel</span>
              <strong>{Math.round(calorieTarget).toLocaleString('de-DE')} kcal</strong>
            </div>
            <small>{Math.round(Math.max(0, calorieProgress))} % des Ziels</small>
          </div>
        </div>
        <div className="grid-3">
          <Metric label="Eiweiß" value={`${totals.protein.toFixed(0)} g`} />
          <Metric label="Kohlenhydrate" value={`${totals.carbs.toFixed(0)} g`} />
          <Metric label="Fett" value={`${totals.fat.toFixed(0)} g`} />
        </div>
        <button
          className="micro-toggle"
          type="button"
          aria-expanded={showMicronutrients}
          onClick={() => setShowMicronutrients((visible) => !visible)}
        >
          <span>
            <Database size={17} /> Mikronährstoffe
          </span>
          <span>
            {showMicronutrients ? 'Ausblenden' : 'Alle anzeigen'}{' '}
            {showMicronutrients ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </span>
        </button>
      </Card>

      {showMicronutrients && (
        <MicronutrientOverview
          profile={profile}
          totals={micronutrientTotals}
          available={availableMicronutrients}
          onInfo={setMicroInfo}
        />
      )}

      <GoalSettings
        settings={settings}
        onGoalChange={(mode) => void updateGoal(mode)}
        onAdjustmentChange={(value) => void updateAdjustment(value)}
        basis={
          maintenance.maintenance
            ? 'aus deinem Gewichts- und Kalorienverlauf berechnet'
            : 'vorläufig aus deinen Profildaten geschätzt'
        }
      />

      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}
      <div className="section-heading">
        <h2>Mahlzeiten</h2>
        <Button variant="ghost" onClick={() => setManageMeals(true)}>
          <Pencil size={16} /> Anpassen
        </Button>
      </div>
      <MealList
        meals={mealSlots}
        entries={todayEntries}
        onAdd={setActiveMeal}
        onRemove={(entry) => void removeFood(entry)}
      />

      <FoodSearchModal
        open={Boolean(activeMeal)}
        meal={activeMeal}
        userId={userId}
        date={date}
        previousEntries={entries}
        onClose={() => setActiveMeal(null)}
      />
      <MealManager open={manageMeals} meals={mealSlots} userId={userId} onClose={() => setManageMeals(false)} />
      <Modal open={Boolean(microInfo)} title={microInfo?.label ?? 'Nährstoff'} onClose={() => setMicroInfo(null)}>
        <p>{microInfo?.description}</p>
        {microInfo && (
          <Card className="card--soft">
            <strong>
              Dein Referenzwert: {getNutrientTarget(microInfo, profile)} {microInfo.unit}/Tag
            </strong>
            {microInfo.note && (
              <p className="small muted" style={{ margin: '6px 0 0' }}>
                {microInfo.note}
              </p>
            )}
          </Card>
        )}
        <p className="small muted">
          Referenzwerte eignen sich zur Orientierung über längere Zeiträume. Eine tägliche Unterschreitung beweist
          keinen Mangel.
        </p>
      </Modal>
    </main>
  )
}
