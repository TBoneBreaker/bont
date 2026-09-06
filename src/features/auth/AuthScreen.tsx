import { useState, type FormEvent } from 'react'
import { ArrowRight, Check, Link2, LockKeyhole, LogIn, UserPlus } from 'lucide-react'
import { Button, Field } from '../../components/ui'
import { supabase } from '../../lib/supabase'

type AuthMode = 'login' | 'register'
type SentMessage = 'registration' | 'magic-link' | null

export function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [sent, setSent] = useState<SentMessage>(null)
  const [loading, setLoading] = useState<'password' | 'magic-link' | null>(null)
  const [error, setError] = useState('')

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode)
    setPassword('')
    setPasswordConfirmation('')
    setError('')
    setSent(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Das Passwort muss mindestens 8 Zeichen haben.')
      return
    }
    if (mode === 'register' && password !== passwordConfirmation) {
      setError('Die beiden Passwörter stimmen nicht überein.')
      return
    }

    setLoading('password')
    if (mode === 'login') {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      setLoading(null)
      if (authError) setError(authMessage(authError.message))
      return
    }

    const { data, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: window.location.origin },
    })
    setLoading(null)
    if (authError) {
      setError(authMessage(authError.message))
      return
    }
    if (!data.session) setSent('registration')
  }

  async function sendMagicLink() {
    if (!email.trim()) {
      setError('Gib zuerst deine E-Mail-Adresse ein.')
      return
    }
    setError('')
    setLoading('magic-link')
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    })
    setLoading(null)
    if (authError) {
      setError(authMessage(authError.message))
      return
    }
    setSent('magic-link')
  }

  return (
    <main className="auth-layout">
      <section className="auth-hero">
        <div className="brand-mark">B</div>
        <div>
          <span className="eyebrow">Ein Konto. Alle Geräte.</span>
          <h1>Dein Fortschritt bleibt bei dir.</h1>
        </div>
        <p>Bont speichert Änderungen sofort lokal und gleicht sie sicher mit deinem Konto ab, sobald Internet verfügbar ist.</p>
      </section>

      {sent ? (
        <section className="auth-panel card">
          <div className="empty-state__icon"><Check size={25} /></div>
          <div>
            <h2>{sent === 'registration' ? 'E-Mail bestätigen' : 'Login-Link ist unterwegs'}</h2>
            <p className="muted">
              {sent === 'registration'
                ? <>Bestätige die Registrierung über die Nachricht an <strong>{email}</strong>. Danach kannst du dich mit deinem Passwort anmelden.</>
                : <>Öffne den einmaligen Login-Link an <strong>{email}</strong>.</>}
            </p>
          </div>
          <Button variant="secondary" full onClick={() => setSent(null)}>Zurück</Button>
          <Button type="button" variant="ghost" full onClick={() => window.location.assign('/demo')}>Ohne Konto testen</Button>
        </section>
      ) : (
        <form className="auth-panel" onSubmit={submit}>
          <div className="segmented auth-mode" role="tablist" aria-label="Zugang auswählen">
            <button type="button" role="tab" aria-selected={mode === 'login'} aria-pressed={mode === 'login'} onClick={() => changeMode('login')}><LogIn size={16} /> Anmelden</button>
            <button type="button" role="tab" aria-selected={mode === 'register'} aria-pressed={mode === 'register'} onClick={() => changeMode('register')}><UserPlus size={16} /> Registrieren</button>
          </div>

          <div className="auth-panel__heading">
            <h2>{mode === 'login' ? 'Willkommen zurück' : 'Konto erstellen'}</h2>
            <p>{mode === 'login' ? 'Deine Cloud-Daten werden nach dem Login auf dieses Gerät geladen.' : 'Deine Einträge werden deinem persönlichen Konto zugeordnet.'}</p>
          </div>

          <Field label="E-Mail-Adresse" type="email" autoComplete="email" inputMode="email" placeholder="name@beispiel.de" value={email} onChange={(event) => setEmail(event.target.value)} required />
          <Field label="Passwort" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="Mindestens 8 Zeichen" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required />
          {mode === 'register' && (
            <Field label="Passwort wiederholen" type="password" autoComplete="new-password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} minLength={8} required />
          )}

          {error && <p className="form-error" role="alert">{error}</p>}
          <Button type="submit" full disabled={Boolean(loading) || !email.trim() || password.length < 8}>
            {mode === 'login' ? <LockKeyhole size={18} /> : <UserPlus size={18} />}
            {loading === 'password' ? 'Bitte warten …' : mode === 'login' ? 'Sicher anmelden' : 'Konto erstellen'}
            {!loading && <ArrowRight size={18} />}
          </Button>

          {mode === 'login' && (
            <Button type="button" variant="secondary" full disabled={Boolean(loading)} onClick={() => void sendMagicLink()}>
              <Link2 size={18} /> {loading === 'magic-link' ? 'Link wird gesendet …' : 'Stattdessen E-Mail-Link senden'}
            </Button>
          )}
          <Button type="button" variant="ghost" full onClick={() => window.location.assign('/demo')}>Ohne Anmeldung fortfahren</Button>
          <p className="auth-note">Du bleibst auf diesem Gerät angemeldet, bis du dich in den Einstellungen abmeldest.</p>
        </form>
      )}
    </main>
  )
}

function authMessage(message: string) {
  if (/invalid login credentials/i.test(message)) return 'E-Mail-Adresse oder Passwort ist nicht korrekt.'
  if (/email not confirmed/i.test(message)) return 'Bestätige zuerst deine E-Mail-Adresse.'
  if (/rate limit/i.test(message)) return 'Zu viele E-Mails angefordert. Warte kurz oder melde dich mit deinem Passwort an.'
  if (/already registered/i.test(message)) return 'Für diese E-Mail-Adresse gibt es bereits ein Konto. Wechsle zu „Anmelden“.'
  return message
}
