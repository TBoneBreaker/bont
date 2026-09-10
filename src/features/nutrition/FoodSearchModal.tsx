import { useMemo, useState, type FormEvent } from 'react'
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Database,
  LoaderCircle,
  Plus,
  ScanBarcode,
  Search,
  Utensils,
} from 'lucide-react'
import { Button, EmptyState, Field, InfoNote, Modal, SelectField } from '../../components/ui'
import { getUserMessage } from '../../lib/errors'
import { searchFoods, type FoodPortion, type FoodSearchResult } from '../../lib/food-search'
import type { FoodEntry, MealSlot } from '../../types'
import { createBase } from '../../types'
import { nutrientReferences } from '../../lib/nutrients'
import { saveFoodEntry } from './commands'

export function FoodSearchModal({
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
  const [formError, setFormError] = useState('')
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

  const recent = useMemo(
    () =>
      Array.from(
        new Map(
          previousEntries
            .slice()
            .reverse()
            .map((entry) => [entry.name.toLowerCase(), entry]),
        ).values(),
      )
        .filter((entry) => !query || entry.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 5),
    [previousEntries, query],
  )

  function startManual(prefill = query) {
    setFormError('')
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
    setFormError('')
    setName(entry.name)
    setBrand(entry.brand ?? '')
    setAmount(String(entry.amount))
    setUnit(entry.unit)
    setCalories(String(entry.calories))
    setProtein(String(entry.protein_g))
    setCarbs(String(entry.carbs_g))
    setFat(String(entry.fat_g))
    setMicronutrients(entry.micronutrients)
    setPortion(
      entry.portion_grams && entry.unit === 'piece'
        ? {
            label: entry.portion_label || `${entry.amount} Stück`,
            amount: entry.amount,
            unit: 'piece',
            grams: entry.portion_grams,
          }
        : null,
    )
    setShowMicroEditor(false)
    setSelectedProduct(null)
    setManual(true)
  }

  function selectProduct(product: FoodSearchResult) {
    setFormError('')
    setSelectedProduct(product)
    setName(product.name)
    setBrand(product.brand)
    setUnit(product.unit)
    setPortion(null)
    applyProductAmount(product, '100', product.unit, null)
    setShowMicroEditor(false)
    setManual(true)
  }

  function applyProductAmount(
    product: FoodSearchResult,
    rawAmount: string,
    amountUnit = unit,
    activePortion = portion,
  ) {
    setAmount(rawAmount)
    const numericAmount = Number(rawAmount)
    const baseAmount = amountUnit === 'piece' ? numericAmount * (activePortion?.grams ?? 0) : numericAmount
    const factor = Number.isFinite(baseAmount) ? baseAmount / 100 : 0
    setCalories(formatInputNumber(product.caloriesPer100 * factor))
    setProtein(formatInputNumber(product.proteinPer100 * factor))
    setCarbs(formatInputNumber(product.carbsPer100 * factor))
    setFat(formatInputNumber(product.fatPer100 * factor))
    setMicronutrients(
      Object.fromEntries(Object.entries(product.micronutrientsPer100).map(([key, value]) => [key, value * factor])),
    )
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
    if (
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0 ||
      !Number.isFinite(numericCalories) ||
      numericCalories < 0
    )
      return
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
      source_id: selectedProduct?.sourceRecordId,
      food_id: selectedProduct?.id ?? null,
      preparation_state: selectedProduct?.preparationState ?? 'unknown',
      portion_grams: portion?.grams ?? null,
      portion_label: portion?.label ?? null,
      micronutrient_provenance: selectedProduct?.nutrientProvenance ?? {},
    }
    setFormError('')
    try {
      await saveFoodEntry(entry)
    } catch (error) {
      setFormError(getUserMessage(error, 'Das Lebensmittel konnte nicht gespeichert werden.'))
      return
    }
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
    setFormError('')
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
            <input
              autoFocus
              placeholder="z. B. Skyr, Haferflocken …"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setSearchError('')
                setSearchedQuery('')
                setResults([])
              }}
            />
            <button
              className="search-submit"
              type="submit"
              disabled={query.trim().length < 2 || searching}
              aria-label="Lebensmittel suchen"
            >
              {searching ? <LoaderCircle className="spin" size={18} /> : <ChevronRight size={19} />}
            </button>
          </form>
          <Button variant="secondary" full disabled>
            <ScanBarcode size={19} /> Barcode-Scanner folgt in der Handy-App
          </Button>
          {!searchedQuery && recent.length > 0 && (
            <div className="stack stack--tight">
              <span className="eyebrow">Zuletzt verwendet</span>
              {recent.map((entry) => (
                <button className="recent-food" key={entry.id} onClick={() => selectRecent(entry)}>
                  <div>
                    <strong>{entry.name}</strong>
                    <span>
                      {entry.brand ? `${entry.brand} · ` : ''}
                      {entry.amount} {entry.unit} · {Math.round(entry.calories)} kcal
                    </span>
                  </div>
                  <Plus size={18} />
                </button>
              ))}
            </div>
          )}
          {results.length > 0 && (
            <div className="stack stack--tight">
              <div className="food-results-heading">
                <span className="eyebrow">Ergebnisse</span>
                <span>{results.length} Treffer</span>
              </div>
              <div className="food-search-results">
                {results.map((product, index) => {
                  const microCount = Object.keys(product.micronutrientsPer100).length
                  return (
                    <button
                      className="food-result"
                      key={`${product.id}-${index}`}
                      onClick={() => selectProduct(product)}
                    >
                      <span className="food-result__icon">
                        <Utensils size={18} />
                      </span>
                      <span>
                        <strong>{product.name}</strong>
                        <small>
                          {product.brand || 'Marke nicht angegeben'} · {Math.round(product.caloriesPer100)} kcal / 100{' '}
                          {product.unit}
                        </small>
                        <small>
                          {formatPreparationState(product.preparationState)}
                          {product.portions.length ? ` · ${product.portions.length} Portionen` : ''}
                        </small>
                        <small
                          className={
                            microCount ? 'food-result__micros food-result__micros--ready' : 'food-result__micros'
                          }
                        >
                          {product.source === 'usda' ? 'USDA-Analyse · ' : ''}
                          {microCount ? `${microCount} Mikronährstoffe enthalten` : 'Keine Mikronährstoffdaten'}
                        </small>
                      </span>
                      <Plus size={18} />
                    </button>
                  )
                })}
              </div>
              <p className="food-source-note">
                Ergebnisse stammen aus dem kuratierten Bont-Katalog. Die Anzeige bewahrt pro Nährstoff Quelle und
                Ableitung; fehlende Werte werden nicht als Nullwerte ausgegeben.
              </p>
              <Button variant="ghost" full onClick={() => startManual()}>
                Nicht dabei? Selbst eintragen
              </Button>
            </div>
          )}
          {searchError && (
            <>
              <InfoNote>{searchError} Du kannst das Lebensmittel weiterhin selbst eintragen.</InfoNote>
              <Button onClick={() => startManual()}>
                <Plus size={18} /> Selbst eintragen
              </Button>
            </>
          )}
          {searchedQuery && !searching && results.length === 0 && !searchError && (
            <EmptyState
              icon={<Search size={24} />}
              title="Nichts Passendes gefunden"
              text={`Für „${searchedQuery}“ liefert die Datenbank keinen passenden Eintrag. Du kannst die Werte selbst ergänzen.`}
              action={
                <Button onClick={() => startManual()}>
                  <Plus size={18} /> Selbst eintragen
                </Button>
              }
            />
          )}
          {!searchedQuery && recent.length === 0 && (
            <EmptyState
              icon={<Database size={24} />}
              title="Lebensmittel suchen"
              text="Durchsuche den kuratierten Lebensmittelkatalog oder lege ein eigenes Lebensmittel an."
              action={
                <Button onClick={() => startManual('')}>
                  <Plus size={18} /> Eigenes Lebensmittel
                </Button>
              }
            />
          )}
        </>
      ) : (
        <FoodEditor
          selectedProduct={selectedProduct}
          name={name}
          brand={brand}
          amount={amount}
          unit={unit}
          calories={calories}
          protein={protein}
          carbs={carbs}
          fat={fat}
          micronutrients={micronutrients}
          portion={portion}
          showMicroEditor={showMicroEditor}
          onNameChange={setName}
          onBrandChange={setBrand}
          onAmountChange={(value) =>
            selectedProduct ? applyProductAmount(selectedProduct, value, unit, portion) : setAmount(value)
          }
          onUnitChange={changeUnit}
          onCaloriesChange={setCalories}
          onProteinChange={setProtein}
          onCarbsChange={setCarbs}
          onFatChange={setFat}
          onPortionChange={selectPortion}
          onMicronutrientChange={updateMicronutrient}
          onToggleMicros={() => setShowMicroEditor((visible) => !visible)}
          onBack={() => setManual(false)}
          onAdd={() => void addFood()}
          error={formError}
        />
      )}
    </Modal>
  )
}

interface FoodEditorProps {
  selectedProduct: FoodSearchResult | null
  name: string
  brand: string
  amount: string
  unit: FoodEntry['unit']
  calories: string
  protein: string
  carbs: string
  fat: string
  micronutrients: Record<string, number>
  portion: FoodPortion | null
  showMicroEditor: boolean
  onNameChange: (value: string) => void
  onBrandChange: (value: string) => void
  onAmountChange: (value: string) => void
  onUnitChange: (value: FoodEntry['unit']) => void
  onCaloriesChange: (value: string) => void
  onProteinChange: (value: string) => void
  onCarbsChange: (value: string) => void
  onFatChange: (value: string) => void
  onPortionChange: (value: string) => void
  onMicronutrientChange: (key: string, value: string) => void
  onToggleMicros: () => void
  onBack: () => void
  onAdd: () => void
  error: string
}

function FoodEditor({
  selectedProduct,
  name,
  brand,
  amount,
  unit,
  calories,
  protein,
  carbs,
  fat,
  micronutrients,
  portion,
  showMicroEditor,
  onNameChange,
  onBrandChange,
  onAmountChange,
  onUnitChange,
  onCaloriesChange,
  onProteinChange,
  onCarbsChange,
  onFatChange,
  onPortionChange,
  onMicronutrientChange,
  onToggleMicros,
  onBack,
  onAdd,
  error,
}: FoodEditorProps) {
  return (
    <>
      {selectedProduct && (
        <div className="database-selection">
          <Database size={18} />
          <div>
            <strong>{selectedProduct.brand || 'Aus der Lebensmitteldatenbank'}</strong>
            <span>
              {formatPreparationState(selectedProduct.preparationState)} ·{' '}
              {Object.keys(selectedProduct.micronutrientsPer100).length
                ? `${Object.keys(selectedProduct.micronutrientsPer100).length} Mikronährstoffe werden mit der Menge angepasst.`
                : 'Dieser Datensatz enthält nur Kalorien und Makros.'}
            </span>
          </div>
        </div>
      )}
      <Field
        label="Lebensmittel"
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        placeholder="z. B. Skyr"
        autoFocus
      />
      <Field
        label="Marke (optional)"
        value={brand}
        onChange={(event) => onBrandChange(event.target.value)}
        placeholder="z. B. K-Classic"
        maxLength={120}
      />
      {selectedProduct && selectedProduct.portions.length > 0 && (
        <SelectField
          label="Portion"
          value={
            portion ? String(selectedProduct.portions.findIndex((item) => item.label === portion.label)) : 'custom'
          }
          onChange={(event) => onPortionChange(event.target.value)}
        >
          <option value="custom">Eigene Menge</option>
          {selectedProduct.portions.map((item, index) => (
            <option value={index} key={`${item.label}-${index}`}>
              {item.label}
            </option>
          ))}
        </SelectField>
      )}
      <div className="input-row">
        <Field
          label="Menge"
          type="number"
          min="0.1"
          step="0.1"
          value={amount}
          onChange={(event) => onAmountChange(event.target.value)}
        />
        <SelectField
          label="Einheit"
          value={unit}
          onChange={(event) => onUnitChange(event.target.value as FoodEntry['unit'])}
        >
          {selectedProduct ? (
            <>
              <option value={selectedProduct.unit}>{selectedProduct.unit === 'ml' ? 'Milliliter' : 'Gramm'}</option>
              {selectedProduct.portions.some((item) => item.unit === 'piece') && <option value="piece">Stück</option>}
            </>
          ) : (
            <>
              <option value="g">Gramm</option>
              <option value="ml">Milliliter</option>
              <option value="piece">Stück</option>
            </>
          )}
        </SelectField>
      </div>
      {selectedProduct && portion?.unit === 'piece' && portion.grams && Number(amount) > 0 && (
        <p className="field-hint" aria-live="polite">
          {amount} {portion.portionType === 'egg' ? (Number(amount) === 1 ? 'Ei' : 'Eier') : portion.portionType === 'bread_slice' || portion.portionType === 'toast_slice' || portion.portionType === 'cheese_slice' ? 'Scheiben' : 'Stück'}{' '}
          = {formatInputNumber(Number(amount) * portion.grams)} g{portion.exactness === 'estimated' ? ' (Näherungswert)' : ''}
        </p>
      )}
      <Field
        label="Kalorien für diese Menge"
        type="number"
        min="0"
        value={calories}
        onChange={(event) => onCaloriesChange(event.target.value)}
        placeholder="0"
      />
      <div className="grid-3 body-inputs">
        <Field
          label="Eiweiß (g)"
          type="number"
          min="0"
          step="0.1"
          value={protein}
          onChange={(event) => onProteinChange(event.target.value)}
          placeholder="0"
        />
        <Field
          label="Kohlenh. (g)"
          type="number"
          min="0"
          step="0.1"
          value={carbs}
          onChange={(event) => onCarbsChange(event.target.value)}
          placeholder="0"
        />
        <Field
          label="Fett (g)"
          type="number"
          min="0"
          step="0.1"
          value={fat}
          onChange={(event) => onFatChange(event.target.value)}
          placeholder="0"
        />
      </div>
      <button className="micro-editor-toggle" type="button" aria-expanded={showMicroEditor} onClick={onToggleMicros}>
        <span>
          <Database size={17} /> Mikronährstoffe für diese Menge
        </span>
        <span>
          {Object.keys(micronutrients).length} eingetragen{' '}
          {showMicroEditor ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
        </span>
      </button>
      {showMicroEditor && (
        <div className="micro-editor-grid">
          {nutrientReferences.map((nutrient) => (
            <Field
              key={nutrient.key}
              label={`${nutrient.label} (${nutrient.unit})`}
              type="number"
              min="0"
              step="any"
              value={micronutrients[nutrient.key] ?? ''}
              onChange={(event) => onMicronutrientChange(nutrient.key, event.target.value)}
              placeholder="Keine Angabe"
            />
          ))}
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <Button variant="secondary" onClick={onBack}>
          Zurück
        </Button>
        <Button full disabled={!name.trim() || !calories} onClick={onAdd}>
          Hinzufügen
        </Button>
      </div>
    </>
  )
}

function formatPreparationState(state: FoodSearchResult['preparationState']) {
  if (state === 'raw') return 'Roh'
  if (state === 'dry' || state === 'dried') return 'Trocken'
  if (state === 'cooked') return 'Gekocht'
  if (state === 'fried') return 'Gebraten'
  if (state === 'steamed') return 'Gedämpft'
  if (state === 'baked') return 'Gebacken'
  if (state === 'frozen') return 'Tiefgekühlt'
  if (state === 'drained') return 'Abgetropft'
  if (state === 'uncooked') return 'Ungekocht'
  if (state === 'prepared') return 'Zubereitet'
  return 'Zustand nicht angegeben'
}

function formatInputNumber(value: number) {
  return String(Math.round(value * 10) / 10)
}
