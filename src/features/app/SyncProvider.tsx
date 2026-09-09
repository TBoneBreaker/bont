import { useEffect, useState, type ReactNode } from 'react'
import { LoadingScreen } from '../../components/ui'
import { getUserMessage } from '../../lib/errors'
import { db, syncUser } from '../../lib/db'
import { seedDemoData } from '../../lib/demo'

interface SyncContext {
  retry: () => void
}

export function SyncProvider({ userId, demoMode, children }: { userId: string; demoMode: boolean; children: (context: SyncContext) => ReactNode }) {
  const [attempt, setAttempt] = useState(0)
  const key = `${userId}:${demoMode}:${attempt}`
  const [state, setState] = useState<{ key: string; ready: boolean; error: string }>({ key: '', ready: false, error: '' })
  const current = state.key === key

  useEffect(() => {
    let active = true
    const finish = (next: { ready: boolean; error?: string }) => {
      if (active) setState({ key, ready: next.ready, error: next.error ?? '' })
    }
    if (demoMode) {
      void seedDemoData().then(() => finish({ ready: true })).catch((error: unknown) => finish({ ready: false, error: getUserMessage(error, 'Die Demo konnte nicht geladen werden.') }))
      return () => { active = false }
    }

    void syncUser(userId, { full: true }).then(async (result) => {
      if (!active) return
      const cachedProfile = await db.profiles.where('user_id').equals(userId).first()
      if (result.error && !cachedProfile) {
        finish({ ready: false, error: 'Deine Cloud-Daten konnten nicht geladen werden. Prüfe deine Verbindung und versuche es erneut.' })
        return
      }
      if (!navigator.onLine && !cachedProfile) {
        finish({ ready: false, error: 'Für die erste Einrichtung auf diesem Gerät wird kurz eine Internetverbindung benötigt.' })
        return
      }
      finish({ ready: true })
    }).catch((error: unknown) => finish({ ready: false, error: getUserMessage(error, 'Die Synchronisierung konnte nicht gestartet werden.') }))

    const sync = () => { void syncUser(userId) }
    const onlineHandler = sync
    const visibilityHandler = () => document.visibilityState === 'visible' && sync()
    window.addEventListener('online', onlineHandler)
    document.addEventListener('visibilitychange', visibilityHandler)
    return () => {
      active = false
      window.removeEventListener('online', onlineHandler)
      document.removeEventListener('visibilitychange', visibilityHandler)
    }
  }, [demoMode, key, userId])

  if (!current) return <LoadingScreen label="Deine Daten werden geladen" />
  if (state.error) return (
    <main className="center-screen">
      <div className="brand-mark">B</div>
      <div><h1>Abgleich nicht möglich</h1><p className="muted">{state.error}</p></div>
      <button className="button button--primary" onClick={() => setAttempt((value) => value + 1)}>Erneut versuchen</button>
    </main>
  )
  if (!state.ready) return <LoadingScreen label="Deine Daten werden geladen" />
  return <>{children({ retry: () => setAttempt((value) => value + 1) })}</>
}
