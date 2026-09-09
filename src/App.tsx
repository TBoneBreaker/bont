import { useLiveQuery } from 'dexie-react-hooks'
import { AuthGate } from './features/app/AuthGate'
import { AppShell } from './features/app/AppShell'
import { SyncProvider } from './features/app/SyncProvider'
import { Onboarding } from './features/onboarding/Onboarding'
import { db } from './lib/db'

export function App() {
  const demoMode = window.location.pathname === '/demo' || new URLSearchParams(window.location.search).has('demo')
  return <AuthGate demoMode={demoMode}>{({ userId, demoMode: isDemo }) => <AuthenticatedApp userId={userId} demoMode={isDemo} />}</AuthGate>
}

function AuthenticatedApp({ userId, demoMode }: { userId: string; demoMode: boolean }) {
  const profile = useLiveQuery(
    () => db.profiles.where('user_id').equals(userId).first(),
    [userId],
  )

  return (
    <SyncProvider userId={userId} demoMode={demoMode}>
      {() => !profile?.onboarding_completed
        ? <div data-theme="light"><Onboarding userId={userId} onComplete={() => undefined} /></div>
        : <AppShell userId={userId} profile={profile} demoMode={demoMode} />}
    </SyncProvider>
  )
}
