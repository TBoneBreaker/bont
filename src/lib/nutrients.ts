import type { Profile } from '../types'

export interface NutrientReference {
  key: string
  label: string
  unit: 'mg' | 'µg'
  male: number
  female: number
  description: string
  note?: string
}

export const nutrientReferences: NutrientReference[] = [
  { key: 'vitamin_a', label: 'Vitamin A', unit: 'µg', male: 850, female: 700, description: 'Unterstützt Sehen, Immunfunktion und Zellteilung.' },
  { key: 'vitamin_d', label: 'Vitamin D', unit: 'µg', male: 20, female: 20, description: 'Wichtig für Knochen, Muskeln und Immunsystem.', note: 'Referenz bei fehlender körpereigener Bildung.' },
  { key: 'vitamin_e', label: 'Vitamin E', unit: 'mg', male: 8, female: 8, description: 'Schützt Zellmembranen vor oxidativem Stress.' },
  { key: 'vitamin_k', label: 'Vitamin K', unit: 'µg', male: 70, female: 60, description: 'Beteiligt an Blutgerinnung und Knochenstoffwechsel.' },
  { key: 'vitamin_c', label: 'Vitamin C', unit: 'mg', male: 110, female: 95, description: 'Unterstützt Immunsystem, Kollagenbildung und Eisenaufnahme.' },
  { key: 'thiamin', label: 'Vitamin B₁', unit: 'mg', male: 1.3, female: 1.0, description: 'Hilft beim Energiestoffwechsel und der Nervenfunktion.' },
  { key: 'riboflavin', label: 'Vitamin B₂', unit: 'mg', male: 1.4, female: 1.1, description: 'Wichtig für Energiegewinnung und Zellschutz.' },
  { key: 'vitamin_b6', label: 'Vitamin B₆', unit: 'mg', male: 1.6, female: 1.4, description: 'Beteiligt am Eiweißstoffwechsel und Nervensystem.' },
  { key: 'folate', label: 'Folat', unit: 'µg', male: 300, female: 300, description: 'Wichtig für Zellteilung und Blutbildung.' },
  { key: 'vitamin_b12', label: 'Vitamin B₁₂', unit: 'µg', male: 4, female: 4, description: 'Unterstützt Blutbildung und Nervensystem.' },
  { key: 'calcium', label: 'Calcium', unit: 'mg', male: 1000, female: 1000, description: 'Baustoff für Knochen und wichtig für Muskelkontraktion.' },
  { key: 'magnesium', label: 'Magnesium', unit: 'mg', male: 350, female: 300, description: 'Beteiligt an Muskelfunktion, Nerven und Energiestoffwechsel.' },
  { key: 'iron', label: 'Eisen', unit: 'mg', male: 11, female: 16, description: 'Wichtig für Sauerstofftransport und Energieversorgung.' },
  { key: 'zinc', label: 'Zink', unit: 'mg', male: 14, female: 10, description: 'Unterstützt Immunsystem, Wundheilung und Proteinstoffwechsel.', note: 'Der Bedarf hängt unter anderem von der Phytatzufuhr ab.' },
  { key: 'iodine', label: 'Jod', unit: 'µg', male: 150, female: 150, description: 'Erforderlich für Schilddrüsenhormone.' },
  { key: 'selenium', label: 'Selen', unit: 'µg', male: 70, female: 60, description: 'Unterstützt Zellschutz und Schilddrüsenstoffwechsel.' },
  { key: 'potassium', label: 'Kalium', unit: 'mg', male: 4000, female: 4000, description: 'Wichtig für Flüssigkeitshaushalt, Nerven und Muskeln.' },
]

export const getNutrientTarget = (nutrient: NutrientReference, profile: Profile) =>
  profile.sex === 'male' ? nutrient.male : nutrient.female
