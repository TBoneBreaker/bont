import { useState } from 'react'
import { Cloud, KeyRound, LogOut, Moon, RefreshCw, Sun, UserRound } from 'lucide-react'
import { Button, Card, Field, InfoNote, Modal, SelectField } from '../../components/ui'
import { syncUser } from '../../lib/db'
import { getUserMessage } from '../../lib/errors'
import { authService } from '../auth/auth-service'
import { saveProfile, saveTheme } from './commands'
import { useAppState } from '../app/use-app-state'
import type { ActivityLevel, BodyFatCategory, Profile, Sex, ThemeMode } from '../../types'

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
  const { settings, sync: syncState } = useAppState(profile.user_id)
  const pending = syncState.pending + syncState.failed + syncState.deadLetter
  const [editingProfile, setEditingProfile] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [status, setStatus] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  async function setTheme(theme: ThemeMode) {
    if (settings) await saveTheme(settings, theme)
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
    const { error } = await authService.signOut()
    setLoggingOut(false)
    if (error) {
      setStatus(getUserMessage(error, 'Die Abmeldung konnte nicht abgeschlossen werden.'))
      return
    }
    onSignedOut()
  }

  async function savePassword() {
    setStatus('')
    if (password.length < 8) {
      setStatus('Das Passwort muss mindestens 8 Zeichen haben.')
      return
    }
    if (password !== passwordConfirmation) {
      setStatus('Die beiden Passwörter stimmen nicht überein.')
      return
    }
    setSavingPassword(true)
    const { error } = await authService.updatePassword(password)
    setSavingPassword(false)
    if (error) {
      setStatus(getUserMessage(error, 'Passwort konnte nicht gespeichert werden. Bitte versuche es später erneut.'))
      return
    }
    setPassword('')
    setPasswordConfirmation('')
    setStatus('Dein Passwort wurde gespeichert. Du kannst dich künftig per Link oder Passwort anmelden.')
  }

  return (
    <>
      <Modal open={open && !editingProfile} title="Einstellungen" onClose={onClose}>
        {!demo && <Card className="stack">
          <div className="row"><div className="feature-icon"><UserRound size={21} /></div><div><strong>{profile.display_name}</strong><span className="small muted" style={{ display: 'block' }}>Persönliches Profil</span></div></div>
          <Button variant="secondary" full onClick={() => setEditingProfile(true)}>Profildaten bearbeiten</Button>
        </Card>}

        {!demo && <Card className="stack">
          <div className="row"><div className="feature-icon"><KeyRound size={21} /></div><div><strong>Passwort festlegen</strong><span className="small muted" style={{ display: 'block' }}>Optional für eine zweite Anmeldemöglichkeit</span></div></div>
          <Field label="Neues Passwort" type="password" autoComplete="new-password" minLength={8} placeholder="Mindestens 8 Zeichen" value={password} onChange={(event) => setPassword(event.target.value)} />
          <Field label="Passwort wiederholen" type="password" autoComplete="new-password" minLength={8} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} />
          <Button variant="secondary" full disabled={savingPassword || password.length < 8 || passwordConfirmation.length < 8} onClick={() => void savePassword()}>{savingPassword ? 'Wird gespeichert …' : 'Passwort speichern'}</Button>
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
      <ProfileEditor key={editingProfile ? 'profile-open' : 'profile-closed'} open={open && editingProfile} profile={profile} settings={settings} onClose={() => setEditingProfile(false)} />
    </>
  )
}

function ProfileEditor({ open, profile, settings, onClose }: { open: boolean; profile: Profile; settings?: import('../../types').UserSettings; onClose: () => void }) {
  const [name, setName] = useState(profile.display_name)
  const [birthDate, setBirthDate] = useState(profile.birth_date)
  const [sex, setSex] = useState<Sex>(profile.sex)
  const [height, setHeight] = useState(String(profile.height_cm))
  const [weight, setWeight] = useState(String(profile.initial_weight_kg))
  const [activity, setActivity] = useState<ActivityLevel>(profile.activity_level)
  const [bodyFat, setBodyFat] = useState<BodyFatCategory>(profile.body_fat_category)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true)
    setError('')
    try {
      await saveProfile(profile.user_id, profile, { displayName: name, birthDate, sex, heightCm: Number(height), weightKg: Number(weight), activityLevel: activity, bodyFatCategory: bodyFat }, settings)
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Die Profildaten konnten nicht gespeichert werden.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} title="Profildaten" onClose={onClose}>
      <Field label="Name" value={name} onChange={(event) => setName(event.target.value)} />
      <Field label="Geburtsdatum" type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} />
      <SelectField label="Biologisches Geschlecht für Berechnung" value={sex} onChange={(event) => setSex(event.target.value as Sex)}><option value="male">Männlich</option><option value="female">Weiblich</option></SelectField>
      <div className="input-row"><Field label="Größe (cm)" type="number" value={height} onChange={(event) => setHeight(event.target.value)} /><Field label="Startgewicht (kg)" type="number" step="0.1" value={weight} onChange={(event) => setWeight(event.target.value)} /></div>
      <SelectField label="Alltagsaktivität" value={activity} onChange={(event) => setActivity(event.target.value as ActivityLevel)}><option value="low">Überwiegend sitzend</option><option value="light">Leicht aktiv</option><option value="moderate">Aktiv</option><option value="high">Sehr aktiv</option><option value="athlete">Extrem aktiv</option></SelectField>
      <SelectField label="Körperfett-Kategorie" value={bodyFat} onChange={(event) => setBodyFat(event.target.value as BodyFatCategory)}><option value="very_low">Sehr niedrig</option><option value="athletic">Athletisch</option><option value="fit">Fit</option><option value="average">Durchschnitt</option><option value="high">Erhöht</option></SelectField>
      <InfoNote>Änderungen aktualisieren nur die vorläufige Kalorienschätzung. Sobald genügend Verlaufsdaten vorhanden sind, hat die datenbasierte Schätzung Vorrang.</InfoNote>
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button full disabled={saving || !name.trim() || !birthDate || !height || !weight} onClick={() => void save()}>{saving ? 'Wird gespeichert …' : 'Änderungen speichern'}</Button>
    </Modal>
  )
}
