import { normalizeSearchText } from './normalize.ts'

export interface SourceNutrientDefinition {
  key: string
  unit: 'kcal' | 'g' | 'mg' | 'µg'
  group: 'macro' | 'vitamin' | 'mineral' | 'other'
  aliases: string[]
}

/** Shared seed map. Unmapped source columns remain in raw_payload for later expansion. */
export const nutrientDefinitions: SourceNutrientDefinition[] = [
  {
    key: 'energy_kcal',
    unit: 'kcal',
    group: 'macro',
    aliases: ['energy', 'energy kcal', 'energie', 'energie kcal', 'kilocalorie', 'kcal'],
  },
  { key: 'protein', unit: 'g', group: 'macro', aliases: ['protein', 'eiweiss', 'eiweiß'] },
  {
    key: 'carbohydrate',
    unit: 'g',
    group: 'macro',
    aliases: ['carbohydrate', 'kohlenhydrate', 'available carbohydrate'],
  },
  { key: 'fat', unit: 'g', group: 'macro', aliases: ['total fat', 'total lipid', 'fett'] },
  { key: 'fiber', unit: 'g', group: 'macro', aliases: ['fiber', 'fibre', 'ballaststoffe'] },
  { key: 'vitamin_a', unit: 'µg', group: 'vitamin', aliases: ['vitamin a', 'retinol activity equivalent', 'rae'] },
  { key: 'vitamin_d', unit: 'µg', group: 'vitamin', aliases: ['vitamin d'] },
  { key: 'vitamin_e', unit: 'mg', group: 'vitamin', aliases: ['vitamin e', 'alpha tocopherol'] },
  { key: 'vitamin_k', unit: 'µg', group: 'vitamin', aliases: ['vitamin k'] },
  { key: 'vitamin_c', unit: 'mg', group: 'vitamin', aliases: ['vitamin c', 'ascorbic acid'] },
  { key: 'thiamin', unit: 'mg', group: 'vitamin', aliases: ['thiamin', 'thiamine', 'vitamin b 1', 'vitamin b1'] },
  { key: 'riboflavin', unit: 'mg', group: 'vitamin', aliases: ['riboflavin', 'vitamin b 2', 'vitamin b2'] },
  { key: 'niacin', unit: 'mg', group: 'vitamin', aliases: ['niacin', 'vitamin b 3', 'vitamin b3'] },
  { key: 'vitamin_b6', unit: 'mg', group: 'vitamin', aliases: ['vitamin b 6', 'vitamin b6', 'pyridoxine'] },
  {
    key: 'pantothenic_acid',
    unit: 'mg',
    group: 'vitamin',
    aliases: ['pantothenic acid', 'pantothensaure', 'pantothensäure', 'vitamin b5'],
  },
  { key: 'biotin', unit: 'µg', group: 'vitamin', aliases: ['biotin', 'vitamin b7'] },
  {
    key: 'folate',
    unit: 'µg',
    group: 'vitamin',
    aliases: ['folate', 'folat', 'folic acid', 'folsaeure', 'folsäure', 'vitamin b9'],
  },
  { key: 'vitamin_b12', unit: 'µg', group: 'vitamin', aliases: ['vitamin b 12', 'vitamin b12', 'cobalamin'] },
  { key: 'calcium', unit: 'mg', group: 'mineral', aliases: ['calcium', 'kalzium'] },
  { key: 'magnesium', unit: 'mg', group: 'mineral', aliases: ['magnesium'] },
  { key: 'phosphorus', unit: 'mg', group: 'mineral', aliases: ['phosphorus', 'phosphor'] },
  { key: 'iron', unit: 'mg', group: 'mineral', aliases: ['iron', 'eisen'] },
  { key: 'zinc', unit: 'mg', group: 'mineral', aliases: ['zinc', 'zink'] },
  { key: 'copper', unit: 'mg', group: 'mineral', aliases: ['copper', 'kupfer'] },
  { key: 'manganese', unit: 'mg', group: 'mineral', aliases: ['manganese', 'mangan'] },
  { key: 'sodium', unit: 'mg', group: 'mineral', aliases: ['sodium', 'natrium'] },
  { key: 'iodine', unit: 'µg', group: 'mineral', aliases: ['iodine', 'jod'] },
  { key: 'selenium', unit: 'µg', group: 'mineral', aliases: ['selenium', 'selen'] },
  { key: 'potassium', unit: 'mg', group: 'mineral', aliases: ['potassium', 'kalium'] },
]

const normalizedDefinitions = nutrientDefinitions.map((definition) => ({
  definition,
  aliases: definition.aliases.map(normalizeSearchText),
}))

export function findNutrientDefinition(label: string) {
  const normalized = normalizeSearchText(label)
  return (
    normalizedDefinitions.find(({ aliases }) =>
      aliases.some((alias) => normalized === alias || normalized.startsWith(`${alias} `)),
    )?.definition ?? null
  )
}
