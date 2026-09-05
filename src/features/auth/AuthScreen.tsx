import { useState, type FormEvent } from 'react'
import { ArrowRight, Check, Mail } from 'lucide-react'
import { Button, Field } from '../../components/ui'
import { supabase } from '../../lib/supabase'

export function AuthScreen() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setLoading(true)
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: true,
        emailRedirectTo: window.location.origin,
      },
    })
    setLoading(false)
    if (authError) {
      setError(authError.message)
      return
    }
    setSent(true)
  }

  return (
    <main className="auth-layout">
      <section className="auth-hero">
        <div className="brand-mark">B</div>
        <div>
          <span className="eyebrow">Dein Training. Deine Daten.</span>
          <h1>Fortschritt, der sich nach dir richtet.</h1>
        </div>
        <p>Bont verbindet Training, Körperanalyse und Ernährung – schnell, ruhig und auch dann zuverlässig, wenn dein Empfang es nicht ist.</p>
      </section>

      {sent ? (
        <section className="auth-panel card">
          <div className="empty-state__icon"><Check size={25} /></div>
          <div>
            <h2>Link ist unterwegs</h2>
            <p className="muted">Öffne die Nachricht an <strong>{email}</strong> auf diesem Gerät. Danach bleibst du angemeldet.</p>
          </div>
          <Button variant="secondary" full onClick={() => setSent(false)}>Andere E-Mail verwenden</Button>
        </section>
      ) : (
        <form className="auth-panel" onSubmit={submit}>
          <Field
            label="E-Mail-Adresse"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="name@beispiel.de"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          {error && <p className="small" role="alert" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
          <Button type="submit" full disabled={loading || !email.trim()}>
            <Mail size={18} /> {loading ? 'Wird gesendet …' : 'Sicher anmelden'} <ArrowRight size={18} />
          </Button>
          <p className="auth-note">Kein Passwort nötig. Anmeldung und Registrierung erfolgen über einen einmaligen E-Mail-Link.</p>
        </form>
      )}
    </main>
  )
}
