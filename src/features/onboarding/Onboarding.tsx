import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { Button, Field, InfoNote, SelectField } from '../../components/ui'
import { saveRecord } from '../../lib/db'
import { preliminaryMaintenance } from '../../lib/maintenance'
import type { Profile, Sex, UserSettings } from '../../types'
import { createBase, newId } from '../../types'

const activityOptions = [
  { id: 'low', title: 'Überwiegend sitzend', text: 'Wenig Bewegung, kein regelmäßiger Sport' },
  { id: 'light', title: 'Leicht aktiv', text: 'Viel Alltag oder 1–3 Trainings pro Woche' },
  { id: 'moderate', title: 'Aktiv', text: '3–5 Trainings pro Woche' },
  { id: 'high', title: 'Sehr aktiv', text: 'Harter Sport an 6–7 Tagen pro Woche' },
  { id: 'athlete', title: 'Extrem aktiv', text: 'Leistungssport oder körperliche Arbeit plus Training' },
]

const bodyFatOptions = {
  male: [
    ['very_low', 'Sehr niedrig', '2–5 % · essenzieller Bereich'],
    ['athletic', 'Athletisch', '6–13 % · deutliche Definition'],
    ['fit', 'Fit', '14–17 % · sportliche Erscheinung'],
    ['average', 'Durchschnitt', '18–24 % · normale Spanne'],
    ['high', 'Erhöht', 'ab 25 %'],
  ],
  female: [
    ['very_low', 'Sehr niedrig', '10–12 % · essenzieller Bereich'],
    ['athletic', 'Athletisch', '13–17 % · deutliche Definition'],
    ['fit', 'Fit', '18–24 % · sportliche Erscheinung'],
    ['average', 'Durchschnitt', '25–31 % · normale Spanne'],
    ['high', 'Erhöht', 'ab 32 %'],
  ],
}

export function Onboarding({ userId, onComplete }: { userId: string; onComplete: (profile: Profile) => void }) {
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [birthDate, setBirthDate] = useState('2000-01-01')
  const [sex, setSex] = useState<Sex>('male')
  const [height, setHeight] = useState('180')
  const [weight, setWeight] = useState('80')
  const [activity, setActivity] = useState('moderate')
  const [bodyFat, setBodyFat] = useState('athletic')

  const canContinue = useMemo(() => {
    if (step === 0) return displayName.trim().length >= 2
    if (step === 1) return Boolean(birthDate) && Number(height) >= 120 && Number(height) <= 230 && Number(weight) >= 35 && Number(weight) <= 300
    if (step === 2) return Boolean(activity)
    return Boolean(bodyFat)
  }, [step, displayName, birthDate, height, weight, activity, bodyFat])

  async function finish() {
    setSaving(true)
    const estimate = preliminaryMaintenance({
      sex,
      birthDate,
      heightCm: Number(height),
      weightKg: Number(weight),
      activityLevel: activity,
    })
    const profile: Profile = {
      ...createBase(userId),
      display_name: displayName.trim(),
      birth_date: birthDate,
      sex,
      height_cm: Number(height),
      initial_weight_kg: Number(weight),
      activity_level: activity,
      body_fat_category: bodyFat,
      onboarding_completed: true,
    }
    const settings: UserSettings = {
      ...createBase(userId),
      theme: 'system',
      goal_mode: 'maintain',
      calorie_adjustment: 0,
      preliminary_maintenance: estimate,
    }
    await saveRecord('profiles', profile)
    await saveRecord('user_settings', settings)
    for (const [index, name] of ['Frühstück', 'Mittagessen', 'Abendessen', 'Snack'].entries()) {
      await saveRecord('meal_slots', {
        ...createBase(userId, newId()),
        name,
        order_index: index,
      })
    }
    const today = new Date().toISOString().slice(0, 10)
    await saveRecord('body_entries', {
      ...createBase(userId),
      entry_date: today,
      weight_kg: Number(weight),
      calories: null,
      steps: null,
    })
    setSaving(false)
    onComplete(profile)
  }

  return (
    <main className="onboarding">
      <div className="onboarding__progress" aria-label={`Schritt ${step + 1} von 4`}>
        {[0, 1, 2, 3].map((item) => <span key={item} className={item <= step ? 'is-active' : ''} />)}
      </div>

      <section className="onboarding__body">
        {step === 0 && (
          <>
            <div>
              <span className="eyebrow">Willkommen bei Bont</span>
              <h1>Wie dürfen wir dich nennen?</h1>
            </div>
            <p>Dein Name wird nur für eine persönliche, unaufdringliche Begrüßung verwendet.</p>
            <Field label="Dein Name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoFocus placeholder="Thomas" maxLength={40} />
          </>
        )}

        {step === 1 && (
          <>
            <div><span className="eyebrow">Deine Basis</span><h1>Ein paar Werte für den Start.</h1></div>
            <p>Damit schätzen wir dein erstes Kalorienziel. Mit deinen echten Verlaufsdaten wird Bont später genauer.</p>
            <Field label="Geburtsdatum" type="date" value={birthDate} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setBirthDate(event.target.value)} />
            <SelectField label="Biologisches Geschlecht für die Berechnung" value={sex} onChange={(event) => { setSex(event.target.value as Sex); setBodyFat('athletic') }}>
              <option value="male">Männlich</option>
              <option value="female">Weiblich</option>
            </SelectField>
            <div className="input-row">
              <Field label="Größe in cm" type="number" inputMode="decimal" min="120" max="230" value={height} onChange={(event) => setHeight(event.target.value)} />
              <Field label="Gewicht in kg" type="number" inputMode="decimal" min="35" max="300" step="0.1" value={weight} onChange={(event) => setWeight(event.target.value)} />
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div><span className="eyebrow">Dein Alltag</span><h1>Wie aktiv bist du wirklich?</h1></div>
            <p>Wähle eher konservativ. Das ist nur der Startwert – dein Gewichtsverlauf korrigiert ihn später.</p>
            <div className="choice-list">
              {activityOptions.map((option) => (
                <button className="choice" key={option.id} aria-pressed={activity === option.id} onClick={() => setActivity(option.id)}>
                  <div><strong>{option.title}</strong><span>{option.text}</span></div>
                  {activity === option.id && <Check size={19} />}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div><span className="eyebrow">Körperzusammensetzung</span><h1>Welche Kategorie passt am ehesten?</h1></div>
            <div className="choice-list">
              {bodyFatOptions[sex].map(([id, title, text]) => (
                <button className="choice" key={id} aria-pressed={bodyFat === id} onClick={() => setBodyFat(id)}>
                  <div><strong>{title}</strong><span>{text}</span></div>
                  {bodyFat === id && <Check size={19} />}
                </button>
              ))}
            </div>
            <InfoNote>Die Werte liefern nur eine vorläufige Schätzung und keine medizinische Beurteilung. Du kannst alle Angaben später in den Einstellungen ändern.</InfoNote>
          </>
        )}
      </section>

      <div className="row">
        {step > 0 && <Button variant="secondary" onClick={() => setStep((value) => value - 1)} aria-label="Zurück"><ArrowLeft size={18} /></Button>}
        <Button full disabled={!canContinue || saving} onClick={() => step < 3 ? setStep((value) => value + 1) : void finish()}>
          {saving ? 'Wird gespeichert …' : step < 3 ? <>Weiter <ArrowRight size={18} /></> : <>Bont starten <Check size={18} /></>}
        </Button>
      </div>
    </main>
  )
}
