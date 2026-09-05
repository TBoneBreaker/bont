import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, Info, Pencil, Plus, ScanBarcode, Search, Trash2, Utensils } from 'lucide-react'
import { Button, Card, EmptyState, Field, IconButton, InfoNote, Metric, Modal, ProgressBar, SelectField } from '../../components/ui'
import { db, saveRecord, softDeleteRecord } from '../../lib/db'
import { estimateMaintenance } from '../../lib/maintenance'
import { getNutrientTarget, nutrientReferences, type NutrientReference } from '../../lib/nutrients'
import type { FoodEntry, GoalMode, MealSlot, Profile, UserSettings } from '../../types'
import { createBase } from '../../types'

const today = () => new Date().toISOString().slice(0, 10)

export function NutritionScreen({ userId, profile }: { userId: string; profile: Profile }) {
  const [date, setDate] = useState(today())
  const [activeMeal, setActiveMeal] = useState<MealSlot | null>(null)
  const [manageMeals, setManageMeals] = useState(false)
  const [microInfo, setMicroInfo] = useState<NutrientReference | null>(null)

  const settings = useLiveQuery(() => db.user_settings.where('user_id').equals(userId).first(), [userId])
  const entries = useLiveQuery(async () => (await db.food_entries.where('user_id').equals(userId).toArray()).filter((entry) => !entry.deleted_at), [userId], [])
  const bodyEntries = useLiveQuery(async () => (await db.body_entries.where('user_id').equals(userId).toArray()).filter((entry) => !entry.deleted_at), [userId], [])
  const mealSlots = useLiveQuery(async () => (await db.meal_slots.where('user_id').equals(userId).toArray()).filter((meal) => !meal.deleted_at).sort((a, b) => a.order_index - b.order_index), [userId], [])
  const todayEntries = entries.filter((entry) => entry.entry_date === date)
  const maintenance = useMemo(() => estimateMaintenance(bodyEntries), [bodyEntries])
  const baseTarget = maintenance.maintenance ?? settings?.preliminary_maintenance ?? 0
  const calorieTarget = Math.max(0, baseTarget + (settings?.goal_mode === 'cut' ? -(settings?.calorie_adjustment ?? 0) : settings?.goal_mode === 'bulk' ? settings?.calorie_adjustment ?? 0 : 0))
  const totals = sumFood(todayEntries)

  async function updateGoal(mode: GoalMode) {
    if (!settings) return
    await saveRecord('user_settings', {
      ...settings,
      goal_mode: mode,
      calorie_adjustment: mode === 'maintain' ? 0 : settings.calorie_adjustment || (mode === 'cut' ? 300 : 200),
    })
  }

  async function updateAdjustment(value: number) {
    if (!settings) return
    await saveRecord('user_settings', { ...settings, calorie_adjustment: Math.max(0, Math.min(1500, value)) })
  }

  async function recalculateBodyCalories() {
    const bodyEntry = bodyEntries.find((entry) => entry.entry_date === date)
    if (!bodyEntry) return
    const freshFood = (await db.food_entries.where('entry_date').equals(date).toArray()).filter((entry) => entry.user_id === userId && !entry.deleted_at)
    await saveRecord('body_entries', { ...bodyEntry, calories: Math.round(sumFood(freshFood).calories) })
  }

  async function removeFood(entry: FoodEntry) {
    await softDeleteRecord('food_entries', entry)
    await recalculateBodyCalories()
  }

  const micronutrientTotals = nutrientReferences.reduce<Record<string, number>>((result, nutrient) => {
    result[nutrient.key] = todayEntries.reduce((sum, entry) => sum + (entry.micronutrients[nutrient.key] ?? 0), 0)
    return result
  }, {})

  return (
    <main className="content">
      <div className="page-intro"><p className="page-intro__greeting">Guten Appetit, {profile.display_name}.</p><h1>Ernährung</h1></div>

      <Card className="card--accent stack nutrition-hero">
        <div className="card__row card__row--top">
          <div><span className="eyebrow">Tagesziel</span><div className="hero-number">{calorieTarget ? calorieTarget.toLocaleString('de-DE') : '–'} kcal</div></div>
          <label className="compact-date"><span>Datum</span><input type="date" value={date} max={today()} onChange={(event) => setDate(event.target.value)} /></label>
        </div>
        <div>
          <div className="row row--between small"><span>{Math.round(totals.calories).toLocaleString('de-DE')} gegessen</span><span>{Math.max(0, Math.round(calorieTarget - totals.calories)).toLocaleString('de-DE')} übrig</span></div>
          <ProgressBar value={calorieTarget ? totals.calories / calorieTarget * 100 : 0} tone="taupe" />
        </div>
        <div className="grid-3">
          <Metric label="Eiweiß" value={`${totals.protein.toFixed(0)} g`} />
          <Metric label="Kohlenhydrate" value={`${totals.carbs.toFixed(0)} g`} />
          <Metric label="Fett" value={`${totals.fat.toFixed(0)} g`} />
        </div>
      </Card>

      <Card className="stack">
        <div><span className="eyebrow">Zielrichtung</span><h2>Was ist dein aktuelles Ziel?</h2></div>
        <div className="segmented">
          <button aria-pressed={settings?.goal_mode === 'maintain'} onClick={() => void updateGoal('maintain')}>Halten</button>
          <button aria-pressed={settings?.goal_mode === 'cut'} onClick={() => void updateGoal('cut')}>Defizit</button>
          <button aria-pressed={settings?.goal_mode === 'bulk'} onClick={() => void updateGoal('bulk')}>Aufbau</button>
        </div>
        {settings?.goal_mode !== 'maintain' && (
          <Field
            label={`${settings?.goal_mode === 'cut' ? 'Defizit' : 'Überschuss'} in kcal`}
            type="number"
            min="0"
            max="1500"
            step="50"
            value={settings?.calorie_adjustment ?? 0}
            onChange={(event) => void updateAdjustment(Number(event.target.value))}
          />
        )}
        <p className="auth-note">Basis: {maintenance.maintenance ? 'aus deinem Gewichts- und Kalorienverlauf berechnet' : 'vorläufig aus deinen Profildaten geschätzt'}.</p>
      </Card>

      <div className="section-heading"><h2>Mahlzeiten</h2><Button variant="ghost" onClick={() => setManageMeals(true)}><Pencil size={16} /> Anpassen</Button></div>
      <div className="stack">
        {mealSlots.map((meal) => {
          const foods = todayEntries.filter((entry) => entry.meal_slot_id === meal.id)
          const mealTotal = sumFood(foods)
          return (
            <Card key={meal.id} className="meal-card stack">
              <div className="card__row">
                <div><h2>{meal.name}</h2><span className="muted small">{foods.length ? `${Math.round(mealTotal.calories)} kcal · ${mealTotal.protein.toFixed(0)} g Eiweiß` : 'Noch nichts eingetragen'}</span></div>
                <IconButton label={`${meal.name}: Lebensmittel hinzufügen`} onClick={() => setActiveMeal(meal)}><Plus size={20} /></IconButton>
              </div>
              {foods.length > 0 && <div className="food-list">
                {foods.map((food) => (
                  <div className="food-row" key={food.id}>
                    <div><strong>{food.name}</strong><span>{food.amount} {food.unit === 'piece' ? 'Stück' : food.unit} · {Math.round(food.calories)} kcal</span></div>
                    <IconButton label={`${food.name} entfernen`} onClick={() => void removeFood(food)}><Trash2 size={16} /></IconButton>
                  </div>
                ))}
              </div>}
              <button className="add-row" onClick={() => setActiveMeal(meal)}><Plus size={17} /> Lebensmittel hinzufügen</button>
            </Card>
          )
        })}
      </div>

      <div className="section-heading"><h2>Mikronährstoffe</h2><span className="pill">DGE-Orientierung</span></div>
      <Card className="stack">
        <InfoNote>Die Werte sind Referenzwerte für gesunde Erwachsene, kein individuell gemessener Bedarf. Ohne Lebensmitteldatenbank bleiben die Mengen zunächst bei null; die Ansicht ist bereits vorbereitet.</InfoNote>
        <div className="nutrient-list">
          {nutrientReferences.map((nutrient) => {
            const target = getNutrientTarget(nutrient, profile)
            const consumed = micronutrientTotals[nutrient.key]
            const percent = target ? consumed / target * 100 : 0
            return (
              <div className="nutrient-row" key={nutrient.key}>
                <button className="nutrient-row__info" onClick={() => setMicroInfo(nutrient)} aria-label={`Information zu ${nutrient.label}`}><Info size={16} /></button>
                <div><div className="row row--between"><strong>{nutrient.label}</strong><span>{Math.round(percent)} %</span></div><ProgressBar value={percent} tone="green" /><span className="tiny muted">{consumed.toFixed(consumed < 10 ? 1 : 0)} von {target} {nutrient.unit}</span></div>
              </div>
            )
          })}
        </div>
        <a className="source-link" href="https://www.dge.de/wissenschaft/referenzwerte/" target="_blank" rel="noreferrer">DGE-Referenzwerte ansehen <ChevronRight size={15} /></a>
      </Card>

      <FoodSearchModal
        open={Boolean(activeMeal)}
        meal={activeMeal}
        userId={userId}
        date={date}
        previousEntries={entries}
        onClose={() => setActiveMeal(null)}
        onSaved={recalculateBodyCalories}
      />
      <MealManager open={manageMeals} meals={mealSlots} userId={userId} onClose={() => setManageMeals(false)} />
      <Modal open={Boolean(microInfo)} title={microInfo?.label ?? 'Nährstoff'} onClose={() => setMicroInfo(null)}>
        <p>{microInfo?.description}</p>
        {microInfo && <Card className="card--soft"><strong>Dein Referenzwert: {getNutrientTarget(microInfo, profile)} {microInfo.unit}/Tag</strong>{microInfo.note && <p className="small muted" style={{ margin: '6px 0 0' }}>{microInfo.note}</p>}</Card>}
        <p className="small muted">Referenzwerte eignen sich zur Orientierung über längere Zeiträume. Eine tägliche Unterschreitung beweist keinen Mangel.</p>
      </Modal>
    </main>
  )
}

function FoodSearchModal({
  open,
  meal,
  userId,
  date,
  previousEntries,
  onClose,
  onSaved,
}: {
  open: boolean
  meal: MealSlot | null
  userId: string
  date: string
  previousEntries: FoodEntry[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState(false)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('100')
  const [unit, setUnit] = useState<FoodEntry['unit']>('g')
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')

  const recent = Array.from(new Map(previousEntries.slice().reverse().map((entry) => [entry.name.toLowerCase(), entry])).values())
    .filter((entry) => !query || entry.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 5)

  function startManual(prefill = query) {
    setName(prefill)
    setManual(true)
  }

  function useRecent(entry: FoodEntry) {
    setName(entry.name)
    setAmount(String(entry.amount))
    setUnit(entry.unit)
    setCalories(String(entry.calories))
    setProtein(String(entry.protein_g))
    setCarbs(String(entry.carbs_g))
    setFat(String(entry.fat_g))
    setManual(true)
  }

  async function addFood() {
    if (!meal || !name.trim() || !calories) return
    const entry: FoodEntry = {
      ...createBase(userId),
      meal_slot_id: meal.id,
      entry_date: date,
      name: name.trim(),
      amount: Number(amount),
      unit,
      calories: Number(calories),
      protein_g: Number(protein || 0),
      carbs_g: Number(carbs || 0),
      fat_g: Number(fat || 0),
      micronutrients: {},
    }
    await saveRecord('food_entries', entry)
    await onSaved()
    setManual(false)
    setQuery('')
    setName('')
    onClose()
  }

  return (
    <Modal open={open} title={meal?.name ?? 'Lebensmittel'} onClose={onClose}>
      {!manual ? (
        <>
          <div className="search-field"><Search size={19} /><input autoFocus placeholder="Lebensmittel suchen" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
          <Button variant="secondary" full disabled><ScanBarcode size={19} /> Barcode-Scanner folgt in der Handy-App</Button>
          {recent.length > 0 && (
            <div className="stack stack--tight"><span className="eyebrow">Zuletzt verwendet</span>{recent.map((entry) => <button className="recent-food" key={entry.id} onClick={() => useRecent(entry)}><div><strong>{entry.name}</strong><span>{entry.amount} {entry.unit} · {Math.round(entry.calories)} kcal</span></div><Plus size={18} /></button>)}</div>
          )}
          {query && (
            <EmptyState
              icon={<Search size={24} />}
              title="Keine Datenbank-Ergebnisse"
              text="Die externe Lebensmitteldatenbank wird später angebunden. Du kannst den Eintrag bis dahin selbst anlegen."
              action={<Button onClick={() => startManual()}><Plus size={18} /> Selbst eintragen</Button>}
            />
          )}
          {!query && recent.length === 0 && <EmptyState icon={<Utensils size={24} />} title="Noch keine Lebensmittel" text="Die Suche ist vorbereitet. Bis zur Datenbank-Anbindung kannst du eigene Werte schnell eintragen." action={<Button onClick={() => startManual('')}><Plus size={18} /> Eigenes Lebensmittel</Button>} />}
        </>
      ) : (
        <>
          <Field label="Lebensmittel" value={name} onChange={(event) => setName(event.target.value)} placeholder="z. B. Skyr" autoFocus />
          <div className="input-row">
            <Field label="Menge" type="number" min="0.1" step="0.1" value={amount} onChange={(event) => setAmount(event.target.value)} />
            <SelectField label="Einheit" value={unit} onChange={(event) => setUnit(event.target.value as FoodEntry['unit'])}><option value="g">Gramm</option><option value="ml">Milliliter</option><option value="piece">Stück</option></SelectField>
          </div>
          <Field label="Kalorien für diese Menge" type="number" min="0" value={calories} onChange={(event) => setCalories(event.target.value)} placeholder="0" />
          <div className="grid-3 body-inputs">
            <Field label="Eiweiß (g)" type="number" min="0" step="0.1" value={protein} onChange={(event) => setProtein(event.target.value)} placeholder="0" />
            <Field label="Kohlenh. (g)" type="number" min="0" step="0.1" value={carbs} onChange={(event) => setCarbs(event.target.value)} placeholder="0" />
            <Field label="Fett (g)" type="number" min="0" step="0.1" value={fat} onChange={(event) => setFat(event.target.value)} placeholder="0" />
          </div>
          <div className="row"><Button variant="secondary" onClick={() => setManual(false)}>Zurück</Button><Button full disabled={!name.trim() || !calories} onClick={() => void addFood()}>Hinzufügen</Button></div>
        </>
      )}
    </Modal>
  )
}

function MealManager({ open, meals, userId, onClose }: { open: boolean; meals: MealSlot[]; userId: string; onClose: () => void }) {
  async function rename(meal: MealSlot, name: string) {
    await saveRecord('meal_slots', { ...meal, name })
  }
  async function add() {
    if (meals.length >= 10) return
    await saveRecord('meal_slots', { ...createBase(userId), name: `Mahlzeit ${meals.length + 1}`, order_index: meals.length })
  }
  async function remove(meal: MealSlot) {
    if (meals.length <= 1) return
    await softDeleteRecord('meal_slots', meal)
  }
  return (
    <Modal open={open} title="Mahlzeiten anpassen" onClose={onClose}>
      <p className="small muted">Bis zu zehn Mahlzeiten. Änderungen werden direkt gespeichert.</p>
      <div className="stack stack--tight">
        {meals.map((meal) => (
          <div className="meal-edit-row" key={meal.id}>
            <input aria-label="Name der Mahlzeit" value={meal.name} maxLength={40} onChange={(event) => void rename(meal, event.target.value)} />
            <IconButton label="Mahlzeit entfernen" disabled={meals.length <= 1} onClick={() => void remove(meal)}><Trash2 size={17} /></IconButton>
          </div>
        ))}
      </div>
      <Button variant="secondary" full disabled={meals.length >= 10} onClick={() => void add()}><Plus size={18} /> Mahlzeit hinzufügen ({meals.length}/10)</Button>
      <Button full onClick={onClose}>Fertig</Button>
    </Modal>
  )
}

function sumFood(entries: FoodEntry[]) {
  return entries.reduce((sum, entry) => ({
    calories: sum.calories + entry.calories,
    protein: sum.protein + entry.protein_g,
    carbs: sum.carbs + entry.carbs_g,
    fat: sum.fat + entry.fat_g,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 })
}
