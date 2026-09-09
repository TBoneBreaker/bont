import { useState, type FormEvent } from 'react'
import { Check, LockKeyhole } from 'lucide-react'
import { Button, Field } from '../../components/ui'
import { getUserMessage } from '../../lib/errors'
import { authService } from './auth-service'

export function PasswordRecoveryScreen() {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setStatus('')
    if (password.length < 8) {
      setError('Das Passwort muss mindestens 8 Zeichen haben.')
      return
    }
    if (password !== confirmation) {
      setError('Die beiden Passwörter stimmen nicht überein.')
      return
    }
    setSaving(true)
    const { error: updateError } = await authService.updatePassword(password)
    setSaving(false)
    if (updateError) {
      setError(getUserMessage(updateError, 'Das Passwort konnte nicht gespeichert werden.'))
      return
    }
    setPassword('')
    setConfirmation('')
    setStatus('Dein Passwort wurde aktualisiert. Du kannst Bont jetzt weiter verwenden.')
  }

  return (
    <main className="auth-layout">
      <section className="auth-hero">
        <div className="brand-mark">B</div>
        <div>
          <span className="eyebrow">Kontosicherheit</span>
          <h1>Neues Passwort festlegen.</h1>
        </div>
        <p>Wähle ein Passwort mit mindestens acht Zeichen.</p>
      </section>
      <form className="auth-panel" onSubmit={submit}>
        <h2>Passwort zurücksetzen</h2>
        <Field
          label="Neues Passwort"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <Field
          label="Passwort wiederholen"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          required
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {status && (
          <p className="auth-note" role="status">
            <Check size={16} /> {status}
          </p>
        )}
        <Button type="submit" full disabled={saving || password.length < 8 || confirmation.length < 8}>
          <LockKeyhole size={18} /> {saving ? 'Wird gespeichert …' : 'Passwort aktualisieren'}
        </Button>
      </form>
    </main>
  )
}
