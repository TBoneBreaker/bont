import { localDateString } from './date'
import { estimateMaintenance } from './maintenance'
import type { BodyEntry, GoalSettingsHistory, UserSettings } from '../types'

type GoalSettings = Pick<UserSettings, 'goal_mode' | 'calorie_adjustment'>

export function calculateCalorieTarget(baseMaintenance: number | null | undefined, settings?: GoalSettings | null) {
  if (baseMaintenance === null || baseMaintenance === undefined || !settings) return null
  const adjustment =
    settings.goal_mode === 'cut'
      ? -settings.calorie_adjustment
      : settings.goal_mode === 'bulk'
        ? settings.calorie_adjustment
        : 0
  return Math.max(0, Math.round(baseMaintenance + adjustment))
}

/**
 * Returns the last known goal snapshot for a calendar date. When no history
 * exists yet, current settings are only used from today onward; older dates
 * intentionally remain unknown instead of receiving a made-up target.
 */
export function goalSettingsAtDate(
  date: string,
  currentSettings: GoalSettings | null | undefined,
  history: GoalSettingsHistory[],
  today = localDateString(),
): GoalSettings | null {
  const knownHistory = history.filter((item) => !item.deleted_at)
  const snapshot = knownHistory
    .filter((item) => item.effective_from <= date)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from) || a.updated_at.localeCompare(b.updated_at))
    .at(-1)
  if (snapshot) return snapshot
  return knownHistory.length === 0 && currentSettings && date >= today ? currentSettings : null
}

export function calorieTargetForDate({
  date,
  entries,
  settings,
  history,
}: {
  date: string
  entries: BodyEntry[]
  settings?: UserSettings | null
  history: GoalSettingsHistory[]
}) {
  const datedSettings = goalSettingsAtDate(date, settings, history)
  if (!datedSettings) return null
  const estimate = estimateMaintenance(entries, date)
  const baseMaintenance = estimate.maintenance ?? settings?.preliminary_maintenance ?? null
  return calculateCalorieTarget(baseMaintenance, datedSettings)
}
