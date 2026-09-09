import { Activity, Dumbbell, Utensils } from 'lucide-react'

export type Tab = 'nutrition' | 'body' | 'training'

export function Navigation({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className="bottom-nav" aria-label="Hauptnavigation">
      <button aria-current={tab === 'nutrition' ? 'page' : undefined} onClick={() => onChange('nutrition')}>
        <Utensils size={20} />
        <span>Ernährung</span>
      </button>
      <button aria-current={tab === 'body' ? 'page' : undefined} onClick={() => onChange('body')}>
        <Activity size={20} />
        <span>Körperanalyse</span>
      </button>
      <button aria-current={tab === 'training' ? 'page' : undefined} onClick={() => onChange('training')}>
        <Dumbbell size={20} />
        <span>Training</span>
      </button>
    </nav>
  )
}
