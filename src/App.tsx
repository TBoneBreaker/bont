import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useLiveQuery } from 'dexie-react-hooks'
import { Activity, Dumbbell, Settings, Utensils } from 'lucide-react'
import { IconButton, LoadingScreen } from './components/ui'
import { AuthScreen } from './features/auth/AuthScreen'
import { Onboarding } from './features/onboarding/Onboarding'
import { db, syncUser } from './lib/db'
import { DEMO_USER_ID } from './lib/demo-constants'
import { seedDemoData } from './lib/demo'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import type { Profile, ThemeMode } from './types'

type Tab = 'nutrition' | 'body' | 'training'

const BodyScreen = lazy(() => import('./features/body/BodyScreen').then((module) => ({ default: module.BodyScreen })))
const NutritionScreen = lazy(() => import('./features/nutrition/NutritionScreen').then((module) => ({ default: module.NutritionScreen })))
const TrainingScreen = lazy(() => import('./features/training/TrainingScreen').then((module) => ({ default: module.TrainingScreen })))
const SettingsPanel = lazy(() => import('./features/settings/SettingsPanel').then((module) => ({ default: module.SettingsPanel })))

export function App() {
  const demoMode = window.location.pathname === '/demo' || new URLSearchParams(window.location.search).has('demo')
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [initialSyncReady, setInitialSyncReady] = useState(false)
  const [tab, setTab] = useState<Tab>('training')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const userId = demoMode ? DEMO_USER_ID : session?.user.id
  const profile = useLiveQuery(
    () => userId ? db.profiles.where('user_id').equals(userId).first() : undefined,
    [userId],
  )
  const settings = useLiveQuery(
    () => userId ? db.user_settings.where('user_id').equals(userId).first() : undefined,
    [userId],
  )
  const pending = useLiveQuery(() => db.outbox.count(), [], 0)

  useEffect(() => {
    if (demoMode) {
      setAuthReady(true)
      return
    }
    if (!isSupabaseConfigured) {
      setAuthReady(true)
      return
    }
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthReady(true)
    })
    return () => data.subscription.unsubscribe()
  }, [demoMode])

  useEffect(() => {
    if (!userId) {
      setInitialSyncReady(false)
      return
    }
    if (demoMode) {
      let active = true
      void seedDemoData().then(() => active && setInitialSyncReady(true))
      return () => { active = false }
    }
    let active = true
    void syncUser(userId).then(() => active && setInitialSyncReady(true))
    const sync = () => void syncUser(userId)
    const onlineHandler = () => { setOnline(true); sync() }
    const offlineHandler = () => setOnline(false)
    const visibilityHandler = () => document.visibilityState === 'visible' && sync()
    window.addEventListener('online', onlineHandler)
    window.addEventListener('offline', offlineHandler)
    document.addEventListener('visibilitychange', visibilityHandler)
    const interval = window.setInterval(sync, 15_000)
    return () => {
      active = false
      window.removeEventListener('online', onlineHandler)
      window.removeEventListener('offline', offlineHandler)
      document.removeEventListener('visibilitychange', visibilityHandler)
      window.clearInterval(interval)
    }
  }, [demoMode, userId])

  const resolvedTheme = useResolvedTheme(settings?.theme ?? 'system')

  if (!isSupabaseConfigured && !demoMode) {
    return <div data-theme={resolvedTheme}><main className="center-screen"><div className="brand-mark">B</div><div><h1>Verbindung fehlt</h1><p className="muted">Die Supabase-Umgebungsvariablen sind noch nicht gesetzt.</p></div></main></div>
  }
  if (!authReady) return <div data-theme={resolvedTheme}><LoadingScreen /></div>
  if (!session && !demoMode) return <div data-theme={resolvedTheme}><AuthScreen /></div>
  if (!initialSyncReady) return <div data-theme={resolvedTheme}><LoadingScreen label="Deine Daten werden geladen" /></div>
  if (!profile?.onboarding_completed) return <div data-theme={resolvedTheme}><Onboarding userId={userId!} onComplete={() => demoMode ? undefined : void syncUser(userId!)} /></div>

  return (
    <div className="app" data-theme={resolvedTheme}>
      <div className="app-shell">
        <header className="topbar">
          <span className="wordmark">bont</span>
          <div className="topbar__actions">
            {demoMode && <span className="pill">Demo</span>}
            <span className={`connection-dot ${demoMode || !online ? 'connection-dot--offline' : ''}`} title={demoMode ? 'Demo · nur lokal' : online ? pending ? `${pending} Änderungen warten` : 'Synchronisiert' : 'Offline gespeichert'} />
            <IconButton label="Einstellungen öffnen" onClick={() => setSettingsOpen(true)}><Settings size={20} /></IconButton>
          </div>
        </header>
        <Suspense fallback={<LoadingScreen label="Bereich wird geladen" />}>
          {tab === 'nutrition' && <NutritionScreen userId={userId!} profile={profile} />}
          {tab === 'body' && <BodyScreen userId={userId!} displayName={profile.display_name} />}
          {tab === 'training' && <TrainingScreen userId={userId!} displayName={profile.display_name} />}
        </Suspense>
      </div>

      <nav className="bottom-nav" aria-label="Hauptnavigation">
        <button aria-current={tab === 'nutrition' ? 'page' : undefined} onClick={() => setTab('nutrition')}><Utensils size={20} /><span>Ernährung</span></button>
        <button aria-current={tab === 'body' ? 'page' : undefined} onClick={() => setTab('body')}><Activity size={20} /><span>Körperanalyse</span></button>
        <button aria-current={tab === 'training' ? 'page' : undefined} onClick={() => setTab('training')}><Dumbbell size={20} /><span>Training</span></button>
      </nav>

      <Suspense fallback={null}>
        <SettingsPanel
          open={settingsOpen}
          profile={profile}
          online={online}
          demo={demoMode}
          onClose={() => setSettingsOpen(false)}
          onSignedOut={() => setSettingsOpen(false)}
        />
      </Suspense>
    </div>
  )
}

function useResolvedTheme(theme: ThemeMode) {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return useMemo(() => theme === 'system' ? systemDark ? 'dark' : 'light' : theme, [theme, systemDark])
}
