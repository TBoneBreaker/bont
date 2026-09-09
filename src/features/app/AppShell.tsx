import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Settings } from 'lucide-react'
import { IconButton, LoadingScreen } from '../../components/ui'
import { Navigation, type Tab } from './Navigation'
import { useOnlineStatus } from './use-online-status'
import { useAppState } from './use-app-state'
import type { Profile, ThemeMode } from '../../types'

const BodyScreen = lazy(() => import('../body/BodyScreen').then((module) => ({ default: module.BodyScreen })))
const NutritionScreen = lazy(() => import('../nutrition/NutritionScreen').then((module) => ({ default: module.NutritionScreen })))
const TrainingScreen = lazy(() => import('../training/TrainingScreen').then((module) => ({ default: module.TrainingScreen })))
const SettingsPanel = lazy(() => import('../settings/SettingsPanel').then((module) => ({ default: module.SettingsPanel })))

export function AppShell({ userId, profile, demoMode }: { userId: string; profile: Profile; demoMode: boolean }) {
  const [tab, setTab] = useState<Tab>('training')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const online = useOnlineStatus()
  const { settings, sync: outbox } = useAppState(userId)
  const resolvedTheme = useResolvedTheme(settings?.theme ?? 'system')
  const pending = outbox.pending + outbox.failed + outbox.deadLetter

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
          {tab === 'nutrition' && <NutritionScreen userId={userId} profile={profile} />}
          {tab === 'body' && <BodyScreen userId={userId} />}
          {tab === 'training' && <TrainingScreen userId={userId} displayName={profile.display_name} />}
        </Suspense>
      </div>
      <Navigation tab={tab} onChange={setTab} />
      <Suspense fallback={null}>
        <SettingsPanel open={settingsOpen} profile={profile} online={online} demo={demoMode} onClose={() => setSettingsOpen(false)} onSignedOut={() => setSettingsOpen(false)} />
      </Suspense>
    </div>
  )
}

function useResolvedTheme(theme: ThemeMode) {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return useMemo(() => theme === 'system' ? systemDark ? 'dark' : 'light' : theme, [theme, systemDark])
}
