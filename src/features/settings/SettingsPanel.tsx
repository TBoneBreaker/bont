import { useEffect, useState } from 'react'
import { Cloud, LogOut, Moon, RefreshCw, Sun, UserRound } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Button, Card, Field, InfoNote, Modal, SelectField } from '../../components/ui'
import { db, saveRecord, syncUser } from '../../lib/db'
import { preliminaryMaintenance } from '../../lib/maintenance'
import { supabase } from '../../lib/supabase'
import type { Profile, Sex, ThemeMode } from '../../types'

export function SettingsPanel({
  open,
  profile,
  online,
  demo = false,
  onClose,
  onSignedOut,
}: {
  open: boolean
  profile: Profile
  online: boolean
  demo?: boolean
  onClose: () => void
  onSignedOut: () => void
}) {
  const settings = useLiveQuery(() => db.user_settings.where('user_id').equals(profile.user_id).first(), [profile.user_id])
  const pending = useLiveQuery(async () => (await db.outbox.toArray())
    .filter((item) => item.payload.user_id === profile.user_id).length, [profile.user_id], 0)
  const [editingProfile, setEditingProfile] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [status, setStatus] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)

  async function setTheme(theme: ThemeMode) {
    if (settings) await saveRecord('user_settings', { ...settings, theme })
  }

  async function sync() {
    setSyncing(true)
    const result = await syncUser(profile.user_id)
    setSyncing(false)
    setStatus(result.error ? 'Synchronisierung nicht möglich.' : 'Alles ist synchronisiert.')
  }

  async function logout() {
    if (demo) {
      window.location.assign('/')
      return
    }
    setLoggingOut(true)
    if (online) {
      const result = await syncUser(profile.user_id)
      if (result.error || result.pending > 0) {
        setStatus('Es gibt noch nicht synchronisierte Daten. Bitte später erneut versuchen.')
        setLoggingOut(false)
        return
      }
    } else if (pending > 0) {
      setStatus('Offline-Änderungen würden verloren gehen. Verbinde dich vor dem Abmelden mit dem Internet.')
      setLoggingOut(false)
      return
    }
    const { error } = await supabase.auth.signOut()
    setLoggingOut(false)
    if (error) {
      setStatus(error.message)
      return
    }
    onSignedOut()
  }

  return (
    <>
      <Modal open={open && !editingProfile} title="Einstellungen" onClose={onClose}>
        {!demo && <Card className="stack">
          <div className="row"><div className="feature-icon"><UserRound size={21} /></div><div><strong>{profile.display_name}</strong><span className="small muted" style={{ display: 'block' }}>Persönliches Profil</span></div></div>
          <Button variant="secondary" full onClick={() => setEditingProfile(true)}>Profildaten bearbeiten</Button>
        </Card>}

        <Card className="stack">
          <div><span className="eyebrow">Darstellung</span><h2>Designmodus</h2></div>
          <div className="segmented">
            <button aria-pressed={settings?.theme === 'light'} onClick={() => void setTheme('light')}><Sun size={16} /> Hell</button>
            <button aria-pressed={settings?.theme === 'system'} onClick={() => void setTheme('system')}>Auto</button>
            <button aria-pressed={settings?.theme === 'dark'} onClick={() => void setTheme('dark')}><Moon size={16} /> Dunkel</button>
          </div>
        </Card>

        {!demo && <Card className="stack">
          <div className="card__row"><div className="row"><Cloud size={20} /><div><strong>Datensynchronisierung</strong><span className="small muted" style={{ display: 'block' }}>{online ? pending ? `${pending} Änderungen warten` : 'Aktuell' : 'Offline · lokal gesichert'}</span></div></div><span className={`connection-dot ${online ? '' : 'connection-dot--offline'}`} /></div>
          <Button variant="secondary" full disabled={!online || syncing} onClick={() => void sync()}><RefreshCw size={17} className={syncing ? 'spin' : ''} /> {syncing ? 'Synchronisiert …' : 'Jetzt synchronisieren'}</Button>
        </Card>}
        {status && <InfoNote>{status}</InfoNote>}
        <Button variant={demo ? 'secondary' : 'danger'} full disabled={loggingOut} onClick={() => void logout()}><LogOut size={18} /> {demo ? 'Zur Anmeldung' : loggingOut ? 'Wird abgemeldet …' : 'Abmelden'}</Button>
        <p className="auth-note">{demo ? 'Änderungen in der Demo bleiben ausschließlich auf diesem Gerät.' : 'Bont speichert laufende Trainings und Änderungen zuerst lokal. Cloud-Daten werden pro Nutzer durch Zugriffsregeln getrennt.'}</p>
      </Modal>
      <ProfileEditor open={open && editingProfile} profile={profile} onClose={() => setEditingProfile(false)} />
    </>
  )
}

function ProfileEditor({ open, profile, onClose }: { open: boolean; profile: Profile; onClose: () => void }) {
  const settings = useLiveQuery(() => db.user_settings.where('user_id').equals(profile.user_id).first(), [profile.user_id])
  const [name, setName] = useState(profile.display_name)
  const [birthDate, setBirthDate] = useState(profile.birth_date)
  const [sex, setSex] = useState<Sex>(profile.sex)
  const [height, setHeight] = useState(String(profile.height_cm))
  const [weight, setWeight] = useState(String(profile.initial_weight_kg))
  const [activity, setActivity] = useState(profile.activity_level)
  const [bodyFat, setBodyFat] = useState(profile.body_fat_category)

  useEffect(() => {
    setName(profile.display_name)
    setBirthDate(profile.birth_date)
    setSex(profile.sex)
    setHeight(String(profile.height_cm))
    setWeight(String(profile.initial_weight_kg))
    setActivity(profile.activity_level)
    setBodyFat(profile.body_fat_category)
  }, [profile])

  async function save() {
    const nextProfile: Profile = {
      ...profile,
      display_name: name.trim(),
      birth_date: birthDate,
      sex,
      height_cm: Number(height),
      initial_weight_kg: Number(weight),
      activity_level: activity,
      body_fat_category: bodyFat,
    }
    await saveRecord('profiles', nextProfile)
    if (settings) {
      await saveRecord('user_settings', {
        ...settings,
        preliminary_maintenance: preliminaryMaintenance({ sex, birthDate, heightCm: Number(height), weightKg: Number(weight), activityLevel: activity }),
      })
    }
    onClose()
  }

  return (
    <Modal open={open} title="Profildaten" onClose={onClose}>
      <Field label="Name" value={name} onChange={(event) => setName(event.target.value)} />
      <Field label="Geburtsdatum" type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} />
      <SelectField label="Biologisches Geschlecht für Berechnung" value={sex} onChange={(event) => setSex(event.target.value as Sex)}><option value="male">Männlich</option><option value="female">Weiblich</option></SelectField>
      <div className="input-row"><Field label="Größe (cm)" type="number" value={height} onChange={(event) => setHeight(event.target.value)} /><Field label="Startgewicht (kg)" type="number" step="0.1" value={weight} onChange={(event) => setWeight(event.target.value)} /></div>
      <SelectField label="Alltagsaktivität" value={activity} onChange={(event) => setActivity(event.target.value)}><option value="low">Überwiegend sitzend</option><option value="light">Leicht aktiv</option><option value="moderate">Aktiv</option><option value="high">Sehr aktiv</option><option value="athlete">Extrem aktiv</option></SelectField>
      <SelectField label="Körperfett-Kategorie" value={bodyFat} onChange={(event) => setBodyFat(event.target.value)}><option value="very_low">Sehr niedrig</option><option value="athletic">Athletisch</option><option value="fit">Fit</option><option value="average">Durchschnitt</option><option value="high">Erhöht</option></SelectField>
      <InfoNote>Änderungen aktualisieren nur die vorläufige Kalorienschätzung. Sobald genügend Verlaufsdaten vorhanden sind, hat die datenbasierte Schätzung Vorrang.</InfoNote>
      <Button full disabled={!name.trim() || !birthDate || !height || !weight} onClick={() => void save()}>Änderungen speichern</Button>
    </Modal>
  )
}
