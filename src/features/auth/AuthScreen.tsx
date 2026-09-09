import { useState, type FormEvent } from 'react'
import { ArrowRight, Check, Link2, LockKeyhole, LogIn, UserPlus } from 'lucide-react'
import { Button, Field } from '../../components/ui'
import { getUserMessage } from '../../lib/errors'
import { authService } from './auth-service'

type AuthMode = 'login' | 'register' | 'reset'
type LoginMethod = 'magic-link' | 'password'
type SentMessage = 'registration' | 'magic-link' | 'password-reset' | null

export function AuthScreen({ initialError = '' }: { initialError?: string }) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [sent, setSent] = useState<SentMessage>(null)
  const [loading, setLoading] = useState<'password' | 'magic-link' | 'reset' | null>(null)
  const [error, setError] = useState(initialError)

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode)
    setPassword('')
    setPasswordConfirmation('')
    setError('')
    setSent(null)
    if (nextMode === 'login') setLoginMethod('password')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!email.trim()) {
      setError('Gib zuerst deine E-Mail-Adresse ein.')
      return
    }
    if (mode === 'reset') {
      setLoading('reset')
      const { error: authError } = await authService.sendPasswordReset(email.trim(), `${window.location.origin}/?reset=1`)
      setLoading(null)
      if (authError) setError(getUserMessage(authError, 'Die E-Mail zum Zurücksetzen konnte nicht gesendet werden.'))
      else setSent('password-reset')
      return
    }
    if (mode === 'login' && loginMethod === 'magic-link') {
      await sendMagicLink()
      return
    }
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
      const { error: authError } = await authService.signIn(email.trim(), password)
      setLoading(null)
      if (authError) setError(getUserMessage(authError, 'Die Anmeldung konnte nicht durchgeführt werden.'))
      return
    }

    const { data, error: authError } = await authService.signUp(email.trim(), password, window.location.origin)
    setLoading(null)
    if (authError) {
      setError(getUserMessage(authError, 'Das Konto konnte nicht erstellt werden.'))
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
    const { error: authError } = await authService.sendMagicLink(email.trim(), window.location.origin)
    setLoading(null)
    if (authError) {
      setError(getUserMessage(authError, 'Der Anmeldelink konnte nicht gesendet werden.'))
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
            <h2>{sent === 'registration' ? 'E-Mail bestätigen' : sent === 'password-reset' ? 'E-Mail zum Zurücksetzen ist unterwegs' : 'Login-Link ist unterwegs'}</h2>
            <p className="muted">
              {sent === 'registration'
                ? <>Falls <strong>{email}</strong> neu ist, wurde eine Bestätigung angefordert. Prüfe auch Spam. Kommt nichts an, nutze „Anmelden“ – die Adresse kann bereits zu einem Konto gehören.</>
                : sent === 'password-reset'
                  ? <>Wenn ein Konto zu <strong>{email}</strong> gehört, erhältst du einen Link zum Festlegen eines neuen Passworts.</>
                  : <>Öffne den einmaligen Login-Link an <strong>{email}</strong>.</>}
            </p>
          </div>
          <Button full onClick={() => { setMode('login'); setSent(null); setPassword('') }}>Zum Anmelden</Button>
          <Button variant="secondary" full onClick={() => setSent(null)}>Zurück</Button>
          <Button type="button" variant="ghost" full onClick={() => window.location.assign('/demo')}>Ohne Konto testen</Button>
        </section>
      ) : (
        <form className="auth-panel" onSubmit={submit}>
          {mode !== 'reset' && <div className="segmented auth-mode" role="tablist" aria-label="Zugang auswählen">
            <button type="button" role="tab" aria-selected={mode === 'login'} aria-pressed={mode === 'login'} onClick={() => changeMode('login')}><LogIn size={16} /> Anmelden</button>
            <button type="button" role="tab" aria-selected={mode === 'register'} aria-pressed={mode === 'register'} onClick={() => changeMode('register')}><UserPlus size={16} /> Registrieren</button>
          </div>}

          <div className="auth-panel__heading">
            <h2>{mode === 'login' ? 'Willkommen zurück' : mode === 'register' ? 'Konto erstellen' : 'Passwort zurücksetzen'}</h2>
            <p>{mode === 'reset'
              ? 'Wir senden dir einen Link, mit dem du ein neues Passwort festlegen kannst.'
              : mode === 'login'
              ? loginMethod === 'magic-link'
                ? 'Du brauchst kein Passwort. Wir senden dir einen einmaligen Anmeldelink.'
                : 'Melde dich mit deinem bereits festgelegten Passwort an.'
              : 'Deine Einträge werden deinem persönlichen Konto zugeordnet.'}</p>
          </div>

          <Field label="E-Mail-Adresse" type="email" autoComplete="email" inputMode="email" placeholder="name@beispiel.de" value={email} onChange={(event) => setEmail(event.target.value)} required />
          {mode !== 'reset' && (mode === 'register' || loginMethod === 'password') && (
            <Field label="Passwort" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="Mindestens 8 Zeichen" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required />
          )}
          {mode === 'register' && (
            <Field label="Passwort wiederholen" type="password" autoComplete="new-password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} minLength={8} required />
          )}
          {mode === 'register' && <p className="auth-note">Schon einmal mit dieser E-Mail registriert? Dann „Anmelden“ wählen. Für bestehende Konten wird keine neue Registrierungs-Mail verschickt.</p>}

          {error && <p className="form-error" role="alert">{error}</p>}
          <Button type="submit" full disabled={Boolean(loading) || !email.trim() || (mode !== 'reset' && (mode === 'register' || loginMethod === 'password') && password.length < 8)}>
            {mode === 'reset' ? <LockKeyhole size={18} /> : mode === 'login' && loginMethod === 'magic-link' ? <Link2 size={18} /> : mode === 'login' ? <LockKeyhole size={18} /> : <UserPlus size={18} />}
            {loading
              ? loading === 'magic-link' ? 'Link wird gesendet …' : loading === 'reset' ? 'E-Mail wird gesendet …' : 'Bitte warten …'
              : mode === 'reset' ? 'Zurücksetz-Link senden' : mode === 'register' ? 'Konto erstellen' : loginMethod === 'magic-link' ? 'Anmeldelink senden' : 'Mit Passwort anmelden'}
            {!loading && <ArrowRight size={18} />}
          </Button>

          {mode === 'login' && (
            <Button type="button" variant="secondary" full disabled={Boolean(loading)} onClick={() => { setLoginMethod((method) => method === 'magic-link' ? 'password' : 'magic-link'); setPassword(''); setError('') }}>
              {loginMethod === 'magic-link' ? <LockKeyhole size={18} /> : <Link2 size={18} />}
              {loginMethod === 'magic-link' ? 'Stattdessen mit Passwort anmelden' : 'Ohne Passwort per E-Mail-Link anmelden'}
            </Button>
          )}
          {mode === 'login' && loginMethod === 'password' && <Button type="button" variant="ghost" full disabled={Boolean(loading)} onClick={() => changeMode('reset')}>Passwort vergessen?</Button>}
          {mode === 'reset' && <Button type="button" variant="secondary" full disabled={Boolean(loading)} onClick={() => changeMode('login')}>Zurück zur Anmeldung</Button>}
          <Button type="button" variant="ghost" full onClick={() => window.location.assign('/demo')}>Ohne Anmeldung fortfahren</Button>
          <p className="auth-note">Altes Bont-Konto ohne Passwort? Nutze den Anmeldelink. Deine bisherigen Daten bleiben erhalten.</p>
        </form>
      )}
    </main>
  )
}

