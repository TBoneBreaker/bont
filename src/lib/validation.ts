import { z } from 'zod'
import type { ActivityLevel, AnySyncedRecord, BodyFatCategory, Sex } from '../types'
import { UserFacingError } from './errors'

export const sexSchema = z.enum(['male', 'female'])
export const activityLevelSchema = z.enum(['low', 'light', 'moderate', 'high', 'athlete'])
export const bodyFatCategorySchema = z.enum(['very_low', 'athletic', 'fit', 'average', 'high'])

const remoteRecordSchema = z
  .object({
    id: z.string().min(1),
    user_id: z.string().min(1),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    deleted_at: z.string().datetime().nullable(),
  })
  .passthrough()

export const onboardingInputSchema = z.object({
  displayName: z.string().trim().min(2).max(40),
  birthDate: z.string().date(),
  sex: sexSchema,
  heightCm: z.number().finite().min(120).max(230),
  weightKg: z.number().finite().min(35).max(300),
  activityLevel: activityLevelSchema,
  bodyFatCategory: bodyFatCategorySchema,
})

export const profileInputSchema = onboardingInputSchema

export type OnboardingInput = z.infer<typeof onboardingInputSchema>

export function parseActivityLevel(value: string): ActivityLevel {
  return activityLevelSchema.parse(value)
}

export function parseBodyFatCategory(value: string): BodyFatCategory {
  return bodyFatCategorySchema.parse(value)
}

export function parseSex(value: string): Sex {
  return sexSchema.parse(value)
}

export function assertFiniteNonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} muss eine endliche, nicht negative Zahl sein.`)
  }
  return value
}

/** Validate the untrusted row before it enters the local write model. */
export function parseRemoteRecord(value: unknown, userId: string): AnySyncedRecord {
  const record = remoteRecordSchema.parse(value)
  if (record.user_id !== userId) throw new UserFacingError('Der Cloud-Datensatz gehört nicht zu deinem Konto.')
  return record as unknown as AnySyncedRecord
}
