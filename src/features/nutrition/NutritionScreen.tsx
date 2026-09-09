import { useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown, ChevronRight, ChevronUp, Database, LoaderCircle, Pencil, Plus, ScanBarcode, Search, Trash2, Utensils } from 'lucide-react'
import { Button, Card, EmptyState, Field, IconButton, InfoNote, Metric, Modal, SelectField } from '../../components/ui'
import { db, saveRecord, softDeleteRecord } from '../../lib/db'
import { localDateString } from '../../lib/date'
import { searchFoods, type FoodPortion, type FoodSearchResult } from '../../lib/food-search'
import { estimateMaintenance } from '../../lib/maintenance'
import { getNutrientTarget, nutrientReferences, type NutrientReference } from '../../lib/nutrients'
import type { FoodEntry, GoalMode, MealSlot, Profile } from '../../types'
import { createBase } from '../../types'
import { GoalSettings } from './GoalSettings'
import { MealList } from './MealList'
import { MicronutrientOverview } from './MicronutrientOverview'
import { sumFood } from './nutrition-utils'

const today = localDateString

export function NutritionScreen({ userId, profile }: { userId: string; profile: Profile }) {
  const [date, setDate] = useState(today())
  const [activeMeal, setActiveMeal] = useState<MealSlot | null>(null)
  const [manageMeals, setManageMeals] = useState(false)
  const [microInfo, setMicroInfo] = useState<NutrientReference | null>(null)
  const [showMicronutrients, setShowMicronutrients] = useState(false)

  const settings = useLiveQuery(() => db.user_settings.where('user_id').equals(userId).first(), [userId])
  const entries = useLiveQuery(async () => (await db.food_entries.where('user_id').equals(userId).toArray()).filter((entry) => !entry.deleted_at), [userId], [])
  const bodyEntries = useLiveQuery(async () => (await db.body_entries.where('user_id').equals(userId).toArray()).filter((entry) => !entry.deleted_at), [userId], [])
  const mealSlots = useLiveQuery(async () => (await db.meal_slots.where('user_id').equals(userId).toArray()).filter((meal) => !meal.deleted_at).sort((a, b) => a.order_index - b.order_index), [userId], [])
  const todayEntries = useMemo(() => entries.filter((entry) => entry.entry_date === date), [date, entries])
  const maintenance = useMemo(() => estimateMaintenance(bodyEntries), [bodyEntries])
  const baseTarget = maintenance.maintenance ?? settings?.preliminary_maintenance ?? 0
  const calorieTarget = Math.max(0, baseTarget + (settings?.goal_mode === 'cut' ? -(settings?.calorie_adjustment ?? 0) : settings?.goal_mode === 'bulk' ? settings?.calorie_adjustment ?? 0 : 0))
  const totals = useMemo(() => sumFood(todayEntries), [todayEntries])
  const remainingCalories = Math.round(calorieTarget - totals.calories)
  const calorieProgress = calorieTarget ? totals.calories / calorieTarget * 100 : 0

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

  async function removeFood(entry: FoodEntry) {
    await softDeleteRecord('food_entries', entry)
  }

  const micronutrientTotals = useMemo(() => nutrientReferences.reduce<Record<string, number>>((result, nutrient) => {
    result[nutrient.key] = todayEntries.reduce((sum, entry) => sum + Number(entry.micronutrients?.[nutrient.key] ?? 0), 0)
    return result
  }, {}), [todayEntries])
  const availableMicronutrients = useMemo(() => new Set(todayEntries.flatMap((entry) => Object.keys(entry.micronutrients ?? {}))), [todayEntries])

  return (
    <main className="content">
      <div className="page-intro"><p className="page-intro__greeting">Guten Appetit, {profile.display_name}.</p><h1>Ernährung</h1></div>

      <Card className="card--accent stack nutrition-hero">
        <div className="card__row card__row--top">
          <div><span className="eyebrow">Tagesziel</span><div className="hero-number">{calorieTarget ? calorieTarget.toLocaleString('de-DE') : '–'} kcal</div></div>
          <label className="compact-date"><span>Datum</span><input type="date" value={date} max={today()} onChange={(event) => setDate(event.target.value)} /></label>
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
            <div><span className="calorie-dot calorie-dot--eaten" /><span>Gegessen</span><strong>{Math.round(totals.calories).toLocaleString('de-DE')} kcal</strong></div>
            <div><span className="calorie-dot calorie-dot--target" /><span>Tagesziel</span><strong>{Math.round(calorieTarget).toLocaleString('de-DE')} kcal</strong></div>
            <small>{Math.round(Math.max(0, calorieProgress))} % des Ziels</small>
          </div>
        </div>
        <div className="grid-3">
          <Metric label="Eiweiß" value={`${totals.protein.toFixed(0)} g`} />
          <Metric label="Kohlenhydrate" value={`${totals.carbs.toFixed(0)} g`} />
          <Metric label="Fett" value={`${totals.fat.toFixed(0)} g`} />
        </div>
        <button className="micro-toggle" type="button" aria-expanded={showMicronutrients} onClick={() => setShowMicronutrients((visible) => !visible)}>
          <span><Database size={17} /> Mikronährstoffe</span>
          <span>{showMicronutrients ? 'Ausblenden' : 'Alle anzeigen'} {showMicronutrients ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</span>
        </button>
      </Card>

      {showMicronutrients && <MicronutrientOverview profile={profile} totals={micronutrientTotals} available={availableMicronutrients} onInfo={setMicroInfo} />}

      <GoalSettings settings={settings} onGoalChange={(mode) => void updateGoal(mode)} onAdjustmentChange={(value) => void updateAdjustment(value)} basis={maintenance.maintenance ? 'aus deinem Gewichts- und Kalorienverlauf berechnet' : 'vorläufig aus deinen Profildaten geschätzt'} />

      <div className="section-heading"><h2>Mahlzeiten</h2><Button variant="ghost" onClick={() => setManageMeals(true)}><Pencil size={16} /> Anpassen</Button></div>
      <MealList meals={mealSlots} entries={todayEntries} onAdd={setActiveMeal} onRemove={(entry) => void removeFood(entry)} />

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
}: {
  open: boolean
  meal: MealSlot | null
  userId: string
  date: string
  previousEntries: FoodEntry[]
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState(false)
  const [results, setResults] = useState<FoodSearchResult[]>([])
  const [searchedQuery, setSearchedQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<FoodSearchResult | null>(null)
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [amount, setAmount] = useState('100')
  const [unit, setUnit] = useState<FoodEntry['unit']>('g')
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [micronutrients, setMicronutrients] = useState<Record<string, number>>({})
  const [portion, setPortion] = useState<FoodPortion | null>(null)
  const [showMicroEditor, setShowMicroEditor] = useState(false)

  const recent = useMemo(() => Array.from(new Map(previousEntries.slice().reverse().map((entry) => [entry.name.toLowerCase(), entry])).values())
    .filter((entry) => !query || entry.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 5), [previousEntries, query])

  function startManual(prefill = query) {
    setSelectedProduct(null)
    setName(prefill)
    setBrand('')
    setAmount('100')
    setUnit('g')
    setCalories('')
    setProtein('')
    setCarbs('')
    setFat('')
    setMicronutrients({})
    setPortion(null)
    setShowMicroEditor(false)
    setManual(true)
  }

  function selectRecent(entry: FoodEntry) {
    setName(entry.name)
    setBrand(entry.brand ?? '')
    setAmount(String(entry.amount))
    setUnit(entry.unit)
    setCalories(String(entry.calories))
    setProtein(String(entry.protein_g))
    setCarbs(String(entry.carbs_g))
    setFat(String(entry.fat_g))
    setMicronutrients(entry.micronutrients)
    setPortion(entry.portion_grams && entry.unit === 'piece'
      ? { label: entry.portion_label || `${entry.amount} Stück`, amount: entry.amount, unit: 'piece', grams: entry.portion_grams }
      : null)
    setShowMicroEditor(false)
    setSelectedProduct(null)
    setManual(true)
  }

  function selectProduct(product: FoodSearchResult) {
    setSelectedProduct(product)
    setName(product.name)
    setBrand(product.brand)
    setUnit(product.unit)
    setPortion(null)
    applyProductAmount(product, '100', product.unit, null)
    setShowMicroEditor(false)
    setManual(true)
  }

  function applyProductAmount(product: FoodSearchResult, rawAmount: string, amountUnit = unit, activePortion = portion) {
    setAmount(rawAmount)
    const numericAmount = Number(rawAmount)
    const baseAmount = amountUnit === 'piece' ? numericAmount * (activePortion?.grams ?? 0) : numericAmount
    const factor = Number.isFinite(baseAmount) ? baseAmount / 100 : 0
    setCalories(formatInputNumber(product.caloriesPer100 * factor))
    setProtein(formatInputNumber(product.proteinPer100 * factor))
    setCarbs(formatInputNumber(product.carbsPer100 * factor))
    setFat(formatInputNumber(product.fatPer100 * factor))
    setMicronutrients(Object.fromEntries(Object.entries(product.micronutrientsPer100).map(([key, value]) => [key, value * factor])))
  }

  function selectPortion(value: string) {
    if (!selectedProduct) return
    if (value === 'custom') {
      setPortion(null)
      setUnit(selectedProduct.unit)
      applyProductAmount(selectedProduct, '100', selectedProduct.unit, null)
      return
    }
    const next = selectedProduct.portions[Number(value)]
    if (!next) return
    setPortion(next)
    setUnit(next.unit)
    applyProductAmount(selectedProduct, String(next.amount), next.unit, next)
  }

  function changeUnit(nextUnit: FoodEntry['unit']) {
    setUnit(nextUnit)
    if (!selectedProduct) {
      setPortion(null)
      return
    }
    const nextPortion = nextUnit === 'piece' ? portion : null
    setPortion(nextPortion)
    applyProductAmount(selectedProduct, amount, nextUnit, nextPortion)
  }

  async function submitSearch(event: FormEvent) {
    event.preventDefault()
    const normalizedQuery = query.trim()
    if (normalizedQuery.length < 2 || searching) return
    setSearching(true)
    setSearchError('')
    setSearchedQuery(normalizedQuery)
    try {
      setResults(await searchFoods(normalizedQuery))
    } catch (error) {
      setResults([])
      setSearchError(error instanceof Error ? error.message : 'Die Lebensmittelsuche ist gerade nicht erreichbar.')
    } finally {
      setSearching(false)
    }
  }

  async function addFood() {
    if (!meal || !name.trim() || !calories) return
    const numericAmount = Number(amount)
    const numericCalories = Number(calories)
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !Number.isFinite(numericCalories) || numericCalories < 0) return
    const entry: FoodEntry = {
      ...createBase(userId),
      meal_slot_id: meal.id,
      entry_date: date,
      name: name.trim(),
      brand: brand.trim(),
      amount: numericAmount,
      unit,
      calories: numericCalories,
      protein_g: Number(protein || 0),
      carbs_g: Number(carbs || 0),
      fat_g: Number(fat || 0),
      micronutrients,
      food_source: selectedProduct?.source,
      source_id: selectedProduct?.id,
      preparation_state: selectedProduct?.preparationState ?? 'unknown',
      portion_grams: portion?.grams ?? null,
      portion_label: portion?.label ?? null,
    }
    await saveRecord('food_entries', entry)
    setManual(false)
    setQuery('')
    setResults([])
    setSearchedQuery('')
    setName('')
    setBrand('')
    setSelectedProduct(null)
    setPortion(null)
    onClose()
  }

  function updateMicronutrient(key: string, rawValue: string) {
    setMicronutrients((current) => {
      const next = { ...current }
      if (rawValue === '') delete next[key]
      else {
        const value = Number(rawValue)
        if (Number.isFinite(value) && value >= 0) next[key] = value
      }
      return next
    })
  }

  function closeModal() {
    setManual(false)
    setQuery('')
    setResults([])
    setSearchedQuery('')
    setSearchError('')
    setSelectedProduct(null)
    setPortion(null)
    setShowMicroEditor(false)
    onClose()
  }

  return (
    <Modal open={open} title={meal?.name ?? 'Lebensmittel'} onClose={closeModal}>
      {!manual ? (
        <>
          <form className="search-field" onSubmit={(event) => void submitSearch(event)}>
            <Search size={19} />
            <input autoFocus placeholder="z. B. Skyr, Haferflocken …" value={query} onChange={(event) => { setQuery(event.target.value); setSearchError(''); setSearchedQuery(''); setResults([]) }} />
            <button className="search-submit" type="submit" disabled={query.trim().length < 2 || searching} aria-label="Lebensmittel suchen">{searching ? <LoaderCircle className="spin" size={18} /> : <ChevronRight size={19} />}</button>
          </form>
          <Button variant="secondary" full disabled><ScanBarcode size={19} /> Barcode-Scanner folgt in der Handy-App</Button>
          {!searchedQuery && recent.length > 0 && (
            <div className="stack stack--tight"><span className="eyebrow">Zuletzt verwendet</span>{recent.map((entry) => <button className="recent-food" key={entry.id} onClick={() => selectRecent(entry)}><div><strong>{entry.name}</strong><span>{entry.brand ? `${entry.brand} · ` : ''}{entry.amount} {entry.unit} · {Math.round(entry.calories)} kcal</span></div><Plus size={18} /></button>)}</div>
          )}
          {results.length > 0 && (
            <div className="stack stack--tight">
              <div className="food-results-heading"><span className="eyebrow">Ergebnisse</span><span>{results.length} Treffer</span></div>
              <div className="food-search-results">
                {results.map((product, index) => {
                  const microCount = Object.keys(product.micronutrientsPer100).length
                  return (
                    <button className="food-result" key={`${product.id}-${index}`} onClick={() => selectProduct(product)}>
                      <span className="food-result__icon"><Utensils size={18} /></span>
                      <span><strong>{product.name}</strong><small>{product.brand || 'Marke nicht angegeben'} · {Math.round(product.caloriesPer100)} kcal / 100 {product.unit}</small><small>{formatPreparationState(product.preparationState)}{product.portions.length ? ` · ${product.portions.length} Portionen` : ''}</small><small className={microCount ? 'food-result__micros food-result__micros--ready' : 'food-result__micros'}>{product.source === 'usda' ? 'USDA-Analyse · ' : ''}{microCount ? `${microCount} Mikronährstoffe enthalten` : 'Keine Mikronährstoffdaten'}</small></span>
                      <Plus size={18} />
                    </button>
                  )
                })}
              </div>
              <p className="food-source-note">Produkte und Marken von Open Food Facts. Ergänzende Analysewerte von USDA FoodData Central. Wähle für die Mikronährstoffauswertung möglichst einen Eintrag mit grüner Datenangabe.</p>
              <Button variant="ghost" full onClick={() => startManual()}>Nicht dabei? Selbst eintragen</Button>
            </div>
          )}
          {searchError && <><InfoNote>{searchError} Du kannst das Lebensmittel weiterhin selbst eintragen.</InfoNote><Button onClick={() => startManual()}><Plus size={18} /> Selbst eintragen</Button></>}
          {searchedQuery && !searching && results.length === 0 && !searchError && (
            <EmptyState
              icon={<Search size={24} />}
              title="Nichts Passendes gefunden"
              text={`Für „${searchedQuery}“ liefert die Datenbank keinen passenden Eintrag. Du kannst die Werte selbst ergänzen.`}
              action={<Button onClick={() => startManual()}><Plus size={18} /> Selbst eintragen</Button>}
            />
          )}
          {!searchedQuery && recent.length === 0 && <EmptyState icon={<Database size={24} />} title="Lebensmittel suchen" text="Durchsuche Open Food Facts oder lege ein eigenes Lebensmittel an." action={<Button onClick={() => startManual('')}><Plus size={18} /> Eigenes Lebensmittel</Button>} />}
        </>
      ) : (
        <>
          {selectedProduct && <div className="database-selection"><Database size={18} /><div><strong>{selectedProduct.brand || 'Aus der Lebensmitteldatenbank'}</strong><span>{formatPreparationState(selectedProduct.preparationState)} · {Object.keys(selectedProduct.micronutrientsPer100).length ? `${Object.keys(selectedProduct.micronutrientsPer100).length} Mikronährstoffe werden mit der Menge angepasst.` : 'Dieser Datensatz enthält nur Kalorien und Makros.'}</span></div></div>}
          <Field label="Lebensmittel" value={name} onChange={(event) => setName(event.target.value)} placeholder="z. B. Skyr" autoFocus />
          <Field label="Marke (optional)" value={brand} onChange={(event) => setBrand(event.target.value)} placeholder="z. B. K-Classic" maxLength={120} />
          {selectedProduct && selectedProduct.portions.length > 0 && <SelectField label="Portion" value={portion ? String(selectedProduct.portions.findIndex((item) => item.label === portion.label)) : 'custom'} onChange={(event) => selectPortion(event.target.value)}>
            <option value="custom">Eigene Menge</option>
            {selectedProduct.portions.map((item, index) => <option value={index} key={`${item.label}-${index}`}>{item.label}</option>)}
          </SelectField>}
          <div className="input-row">
            <Field label="Menge" type="number" min="0.1" step="0.1" value={amount} onChange={(event) => selectedProduct ? applyProductAmount(selectedProduct, event.target.value, unit, portion) : setAmount(event.target.value)} />
            <SelectField label="Einheit" value={unit} onChange={(event) => changeUnit(event.target.value as FoodEntry['unit'])}>
              {selectedProduct
                ? <><option value={selectedProduct.unit}>{selectedProduct.unit === 'ml' ? 'Milliliter' : 'Gramm'}</option>{selectedProduct.portions.some((item) => item.unit === 'piece') && <option value="piece">Stück</option>}</>
                : <><option value="g">Gramm</option><option value="ml">Milliliter</option><option value="piece">Stück</option></>}
            </SelectField>
          </div>
          <Field label="Kalorien für diese Menge" type="number" min="0" value={calories} onChange={(event) => setCalories(event.target.value)} placeholder="0" />
          <div className="grid-3 body-inputs">
            <Field label="Eiweiß (g)" type="number" min="0" step="0.1" value={protein} onChange={(event) => setProtein(event.target.value)} placeholder="0" />
            <Field label="Kohlenh. (g)" type="number" min="0" step="0.1" value={carbs} onChange={(event) => setCarbs(event.target.value)} placeholder="0" />
            <Field label="Fett (g)" type="number" min="0" step="0.1" value={fat} onChange={(event) => setFat(event.target.value)} placeholder="0" />
          </div>
          <button className="micro-editor-toggle" type="button" aria-expanded={showMicroEditor} onClick={() => setShowMicroEditor((visible) => !visible)}>
            <span><Database size={17} /> Mikronährstoffe für diese Menge</span>
            <span>{Object.keys(micronutrients).length} eingetragen {showMicroEditor ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</span>
          </button>
          {showMicroEditor && <div className="micro-editor-grid">
            {nutrientReferences.map((nutrient) => <Field
              key={nutrient.key}
              label={`${nutrient.label} (${nutrient.unit})`}
              type="number"
              min="0"
              step="any"
              value={micronutrients[nutrient.key] ?? ''}
              onChange={(event) => updateMicronutrient(nutrient.key, event.target.value)}
              placeholder="Keine Angabe"
            />)}
          </div>}
          <div className="row"><Button variant="secondary" onClick={() => setManual(false)}>Zurück</Button><Button full disabled={!name.trim() || !calories} onClick={() => void addFood()}>Hinzufügen</Button></div>
        </>
      )}
    </Modal>
  )
}

function formatPreparationState(state: FoodSearchResult['preparationState']) {
  if (state === 'raw') return 'Roh'
  if (state === 'dry') return 'Trocken'
  if (state === 'cooked') return 'Gekocht'
  if (state === 'prepared') return 'Zubereitet'
  return 'Zustand nicht angegeben'
}

function formatInputNumber(value: number) {
  return String(Math.round(value * 10) / 10)
}

function MealManager({ open, meals, userId, onClose }: { open: boolean; meals: MealSlot[]; userId: string; onClose: () => void }) {
  async function rename(meal: MealSlot, name: string) {
    const normalized = name.trim()
    if (!normalized || normalized === meal.name) return
    await saveRecord('meal_slots', { ...meal, name: normalized })
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
            <input aria-label="Name der Mahlzeit" defaultValue={meal.name} maxLength={40} onBlur={(event) => { void rename(meal, event.currentTarget.value); event.currentTarget.value = event.currentTarget.value.trim() }} />
            <IconButton label="Mahlzeit entfernen" disabled={meals.length <= 1} onClick={() => void remove(meal)}><Trash2 size={17} /></IconButton>
          </div>
        ))}
      </div>
      <Button variant="secondary" full disabled={meals.length >= 10} onClick={() => void add()}><Plus size={18} /> Mahlzeit hinzufügen ({meals.length}/10)</Button>
      <Button full onClick={onClose}>Fertig</Button>
    </Modal>
  )
}

