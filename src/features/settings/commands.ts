import { preliminaryMaintenance } from '../../lib/maintenance'
import { saveRecord, saveRecordsAtomically } from '../../lib/local-db/local-repository'
import { profileInputSchema, type OnboardingInput } from '../../lib/validation'
import type { Profile, UserSettings } from '../../types'

export async function saveProfile(userId: string, profile: Profile, input: OnboardingInput, settings?: UserSettings) {
  const values = profileInputSchema.parse(input)
  const nextProfile: Profile = {
    ...profile,
    user_id: userId,
    display_name: values.displayName,
    birth_date: values.birthDate,
    sex: values.sex,
    height_cm: values.heightCm,
    initial_weight_kg: values.weightKg,
    activity_level: values.activityLevel,
    body_fat_category: values.bodyFatCategory,
  }
  if (!settings) return saveRecord('profiles', nextProfile)
  const nextSettings: UserSettings = {
    ...settings,
    preliminary_maintenance: preliminaryMaintenance({
      sex: values.sex,
      birthDate: values.birthDate,
      heightCm: values.heightCm,
      weightKg: values.weightKg,
      activityLevel: values.activityLevel,
    }),
  }
  await saveRecordsAtomically([
    { table: 'profiles', record: nextProfile },
    { table: 'user_settings', record: nextSettings },
  ])
  return nextProfile
}

export function saveTheme(settings: UserSettings, theme: UserSettings['theme']) {
  return saveRecord('user_settings', { ...settings, theme })
}
