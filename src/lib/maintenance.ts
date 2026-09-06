import type { BodyEntry } from '../types'

export interface MaintenanceEstimate {
  days: number
  maintenance: number | null
  confidence: 'insufficient' | 'preliminary' | 'good' | 'strong'
  dailyWeightTrend: number | null
  weightChangePerWeek: number | null
  averageCalories: number | null
  reason?: string
}

const byDate = (a: BodyEntry, b: BodyEntry) => a.entry_date.localeCompare(b.entry_date)
type CompleteBodyEntry = BodyEntry & { weight_kg: number; calories: number }
type WeightBodyEntry = BodyEntry & { weight_kg: number }

export function estimateMaintenance(entries: BodyEntry[]): MaintenanceEstimate {
  const usable = entries
    .filter((entry): entry is CompleteBodyEntry =>
      !entry.deleted_at && entry.weight_kg !== null && entry.weight_kg > 0 && entry.calories !== null && entry.calories > 0,
    )
    .sort(byDate)
    .slice(-28)

  if (usable.length < 7) {
    return {
      days: usable.length,
      maintenance: null,
      confidence: 'insufficient',
      dailyWeightTrend: null,
      weightChangePerWeek: null,
      averageCalories: usable.length
        ? Math.round(usable.reduce((sum, entry) => sum + entry.calories, 0) / usable.length)
        : null,
      reason: 'Mindestens sieben vollständige Tage nötig.',
    }
  }

  const firstDate = new Date(`${usable[0].entry_date}T12:00:00Z`).getTime()
  const points = usable.map((entry) => ({
    x: (new Date(`${entry.entry_date}T12:00:00Z`).getTime() - firstDate) / 86_400_000,
    y: entry.weight_kg,
  }))
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length
  const denominator = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0)
  const slope = denominator
    ? points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0) / denominator
    : 0
  const averageCalories = usable.reduce((sum, entry) => sum + entry.calories, 0) / usable.length
  const rawMaintenance = averageCalories - slope * 7700
  const maintenance = rawMaintenance >= 900 && rawMaintenance <= 6000 ? Math.round(rawMaintenance / 10) * 10 : null

  return {
    days: usable.length,
    maintenance,
    confidence: usable.length >= 21 ? 'strong' : usable.length >= 14 ? 'good' : 'preliminary',
    dailyWeightTrend: slope,
    weightChangePerWeek: slope * 7,
    averageCalories: Math.round(averageCalories),
    reason: maintenance ? undefined : 'Die Gewichtsschwankungen sind für eine sinnvolle Schätzung noch zu groß.',
  }
}

export function weeklyAverages(entries: BodyEntry[]) {
  const usable = entries
    .filter((entry): entry is WeightBodyEntry => !entry.deleted_at && entry.weight_kg !== null && entry.weight_kg > 0)
    .sort(byDate)
  const current = usable.slice(-7)
  const previous = usable.slice(-14, -7)
  const average = (rows: WeightBodyEntry[]) =>
    rows.length === 7 ? rows.reduce((sum, row) => sum + row.weight_kg, 0) / 7 : null
  const currentAverage = average(current)
  const previousAverage = average(previous)
  return {
    current: currentAverage,
    previous: previousAverage,
    change: currentAverage !== null && previousAverage !== null ? currentAverage - previousAverage : null,
  }
}

export function calculateAge(birthDate: string, now = new Date()) {
  const birth = new Date(`${birthDate}T12:00:00`)
  let age = now.getFullYear() - birth.getFullYear()
  const beforeBirthday =
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())
  if (beforeBirthday) age -= 1
  return age
}

const activityFactors: Record<string, number> = {
  low: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
  athlete: 1.9,
}

export function preliminaryMaintenance(input: {
  sex: 'male' | 'female'
  birthDate: string
  heightCm: number
  weightKg: number
  activityLevel: string
}) {
  const age = Math.max(16, calculateAge(input.birthDate))
  const sexOffset = input.sex === 'male' ? 5 : -161
  const resting = 10 * input.weightKg + 6.25 * input.heightCm - 5 * age + sexOffset
  return Math.round((resting * (activityFactors[input.activityLevel] ?? 1.375)) / 10) * 10
}
