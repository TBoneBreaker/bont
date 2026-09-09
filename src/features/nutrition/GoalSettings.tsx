import type { GoalMode, UserSettings } from '../../types'
import { Card, Field } from '../../components/ui'

export function GoalSettings({ settings, onGoalChange, onAdjustmentChange, basis }: {
  settings: UserSettings | undefined
  onGoalChange: (mode: GoalMode) => void
  onAdjustmentChange: (value: number) => void
  basis: string
}) {
  return (
    <Card className="stack">
      <div><span className="eyebrow">Zielrichtung</span><h2>Was ist dein aktuelles Ziel?</h2></div>
      <div className="segmented">
        <button aria-pressed={settings?.goal_mode === 'cut'} onClick={() => onGoalChange('cut')}>Defizit</button>
        <button aria-pressed={settings?.goal_mode === 'maintain'} onClick={() => onGoalChange('maintain')}>Halten</button>
        <button aria-pressed={settings?.goal_mode === 'bulk'} onClick={() => onGoalChange('bulk')}>Aufbau</button>
      </div>
      {settings?.goal_mode !== 'maintain' && (
        <Field label={`${settings?.goal_mode === 'cut' ? 'Defizit' : 'Überschuss'} in kcal`} type="number" min="0" max="1500" step="50" value={settings?.calorie_adjustment ?? 0} onChange={(event) => onAdjustmentChange(Number(event.target.value))} />
      )}
      <p className="auth-note">Basis: {basis}.</p>
    </Card>
  )
}
