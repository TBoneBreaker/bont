import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AuthScreen } from '../auth/AuthScreen'
import { PasswordRecoveryScreen } from '../auth/PasswordRecoveryScreen'
import { LoadingScreen } from '../../components/ui'
import { getUserMessage } from '../../lib/errors'
import { DEMO_USER_ID } from '../../lib/demo-constants'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'

interface AuthContext {
  session: Session | null
  userId: string
  demoMode: boolean
}

export function AuthGate({ demoMode, children }: { demoMode: boolean; children: (context: AuthContext) => ReactNode }) {
  const initialReady = demoMode || !isSupabaseConfigured
  const [auth, setAuth] = useState<{
    ready: boolean
    session: Session | null
    error: string
    recovery: boolean
    key: string
  }>({
    ready: initialReady,
    session: null,
    error: '',
    recovery: false,
    key: `${demoMode}:${isSupabaseConfigured}`,
  })
  const key = `${demoMode}:${isSupabaseConfigured}`

  useEffect(() => {
    if (demoMode || !isSupabaseConfigured) return
    let active = true
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return
        setAuth({
          ready: true,
          session: data.session,
          error: error ? getUserMessage(error, 'Die Anmeldung konnte nicht geladen werden.') : '',
          recovery: Boolean(data.session && new URLSearchParams(window.location.search).has('reset')),
          key,
        })
      })
      .catch((error: unknown) => {
        if (active)
          setAuth({
            ready: true,
            session: null,
            error: getUserMessage(error, 'Die Anmeldung konnte nicht geladen werden.'),
            recovery: false,
            key,
          })
      })
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (active) setAuth({ ready: true, session, error: '', recovery: event === 'PASSWORD_RECOVERY', key })
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [demoMode, key])

  if (!isSupabaseConfigured && !demoMode) {
    return (
      <main className="center-screen">
        <div className="brand-mark">B</div>
        <div>
          <h1>Verbindung fehlt</h1>
          <p className="muted">Die Supabase-Umgebungsvariablen sind noch nicht gesetzt.</p>
        </div>
      </main>
    )
  }
  if (auth.key !== key || !auth.ready) return <LoadingScreen />
  if (auth.recovery || (auth.session && new URLSearchParams(window.location.search).has('reset')))
    return <PasswordRecoveryScreen />
  if (!auth.session && !demoMode)
    return (
      <AuthScreen
        initialError={
          auth.error ? 'Die gespeicherte Anmeldung konnte nicht geladen werden. Bitte melde dich erneut an.' : ''
        }
      />
    )

  return <>{children({ session: auth.session, userId: demoMode ? DEMO_USER_ID : auth.session!.user.id, demoMode })}</>
}
