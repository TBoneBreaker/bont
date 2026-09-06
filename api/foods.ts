interface RequestLike {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
}

interface ResponseLike {
  status(code: number): ResponseLike
  setHeader(name: string, value: string): void
  json(body: unknown): void
}

interface UsdaNutrient {
  nutrientId?: number
  nutrientName?: string
  unitName?: string
  value?: number
}

interface UsdaFood {
  fdcId?: number
  description?: string
  brandOwner?: string
  brandName?: string
  dataType?: string
  foodNutrients?: UsdaNutrient[]
}

interface UsdaSearchResponse {
  foods?: UsdaFood[]
}

declare const process: { env: Record<string, string | undefined> }

const fields = [
  'code',
  'product_name',
  'product_name_de',
  'brands',
  'quantity',
  'product_quantity_unit',
  'nutriments',
].join(',')

const usdaNutrients = [
  { key: 'energy-kcal', ids: [1008, 2047, 2048], names: ['energy'], unit: 'kcal' },
  { key: 'proteins', ids: [1003], names: ['protein'], unit: 'g' },
  { key: 'carbohydrates', ids: [1005], names: ['carbohydrate'], unit: 'g' },
  { key: 'fat', ids: [1004], names: ['total lipid', 'total fat'], unit: 'g' },
  { key: 'vitamin-a', ids: [1106], names: ['vitamin a, rae'], unit: 'µg' },
  { key: 'vitamin-d', ids: [1114], names: ['vitamin d'], unit: 'µg' },
  { key: 'vitamin-e', ids: [1109], names: ['vitamin e'], unit: 'mg' },
  { key: 'vitamin-k', ids: [1185], names: ['vitamin k'], unit: 'µg' },
  { key: 'vitamin-c', ids: [1162], names: ['vitamin c'], unit: 'mg' },
  { key: 'vitamin-b1', ids: [1165], names: ['thiamin'], unit: 'mg' },
  { key: 'vitamin-b2', ids: [1166], names: ['riboflavin'], unit: 'mg' },
  { key: 'vitamin-b6', ids: [1175], names: ['vitamin b-6', 'vitamin b6'], unit: 'mg' },
  { key: 'folate', ids: [1177], names: ['folate, total'], unit: 'µg' },
  { key: 'vitamin-b12', ids: [1178], names: ['vitamin b-12', 'vitamin b12'], unit: 'µg' },
  { key: 'calcium', ids: [1087], names: ['calcium'], unit: 'mg' },
  { key: 'magnesium', ids: [1090], names: ['magnesium'], unit: 'mg' },
  { key: 'iron', ids: [1089], names: ['iron'], unit: 'mg' },
  { key: 'zinc', ids: [1095], names: ['zinc'], unit: 'mg' },
  { key: 'iodine', ids: [1100], names: ['iodine'], unit: 'µg' },
  { key: 'selenium', ids: [1103], names: ['selenium'], unit: 'µg' },
  { key: 'potassium', ids: [1092], names: ['potassium'], unit: 'mg' },
] as const

const germanFoodTerms: Array<[RegExp, string]> = [
  [/\bhaferflocken\b/giu, 'oats'],
  [/\bnudeln?\b/giu, 'pasta'],
  [/\bhähnchenbrust\b/giu, 'chicken breast'],
  [/\bhuehnchenbrust\b/giu, 'chicken breast'],
  [/\bsüßkartoffeln?\b/giu, 'sweet potato'],
  [/\bsuesskartoffeln?\b/giu, 'sweet potato'],
  [/\bkartoffeln?\b/giu, 'potato'],
  [/\bbrokkoli\b/giu, 'broccoli'],
  [/\bspinat\b/giu, 'spinach'],
  [/\bbananen?\b/giu, 'banana'],
  [/\bäpfel?\b/giu, 'apple'],
  [/\baepfel?\b/giu, 'apple'],
  [/\borangen?\b/giu, 'orange'],
  [/\blachs\b/giu, 'salmon'],
  [/\bthunfisch\b/giu, 'tuna'],
  [/\bvollmilch\b/giu, 'whole milk'],
  [/\bmilch\b/giu, 'milk'],
  [/\bmagerquark\b/giu, 'low fat quark'],
  [/\bquark\b/giu, 'quark'],
  [/\breis\b/giu, 'rice'],
  [/\beier\b/giu, 'eggs'],
  [/\bei\b/giu, 'egg'],
]

export default async function handler(request: RequestLike, response: ResponseLike) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    return response.status(405).json({ error: 'Nur GET-Anfragen sind erlaubt.' })
  }

  const host = Array.isArray(request.headers.host) ? request.headers.host[0] : request.headers.host
  const url = new URL(request.url ?? '/api/foods', `https://${host ?? 'bont-three.vercel.app'}`)
  const query = (url.searchParams.get('q') ?? '').trim()

  if (query.length < 2 || query.length > 80) {
    return response.status(400).json({ error: 'Bitte gib mindestens zwei Zeichen ein.' })
  }

  const [openFoodFacts, usda] = await Promise.allSettled([
    searchOpenFoodFacts(query),
    searchUsda(query),
  ])

  const products = [
    ...(openFoodFacts.status === 'fulfilled' ? openFoodFacts.value : []),
    ...(usda.status === 'fulfilled' ? usda.value : []),
  ]

  if (products.length === 0) {
    console.error('[api/foods] All food sources failed', {
      openFoodFacts: openFoodFacts.status === 'rejected' ? String(openFoodFacts.reason) : 'no results',
      usda: usda.status === 'rejected' ? String(usda.reason) : 'no results',
    })
    return response.status(502).json({ error: 'Die Lebensmitteldatenbanken antworten gerade nicht.' })
  }

  response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400')
  return response.status(200).json({ products })
}

async function searchOpenFoodFacts(query: string) {
  const modernParams = new URLSearchParams({ q: query, page: '1', page_size: '12', langs: 'de,en', fields })
  const modern = await fetch(`https://search.openfoodfacts.org/search?${modernParams}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'Bont/0.1 (https://bont-three.vercel.app)' },
    signal: AbortSignal.timeout(6_000),
  })

  if (modern.ok) {
    const data = await modern.json() as { hits?: Record<string, unknown>[] }
    if (Array.isArray(data.hits)) return data.hits.map((product) => ({ ...product, source: 'open_food_facts' }))
  }

  const legacyParams = new URLSearchParams({
    search_terms: query,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '12',
    lc: 'de',
    cc: 'de',
    fields,
  })
  const legacy = await fetch(`https://de.openfoodfacts.org/cgi/search.pl?${legacyParams}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'Bont/0.1 (https://bont-three.vercel.app)' },
    signal: AbortSignal.timeout(7_000),
  })
  if (!legacy.ok) throw new Error(`Open Food Facts ${legacy.status}`)
  const data = await legacy.json() as { products?: Record<string, unknown>[] }
  return (data.products ?? []).map((product) => ({ ...product, source: 'open_food_facts' }))
}

async function searchUsda(query: string) {
  const apiKey = process.env.USDA_FDC_API_KEY || 'DEMO_KEY'
  const translatedQuery = germanFoodTerms.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), query)
  const result = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: translatedQuery,
      pageSize: 18,
      dataType: ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded'],
    }),
    signal: AbortSignal.timeout(8_000),
  })
  if (!result.ok) throw new Error(`USDA FoodData Central ${result.status}`)

  const data = await result.json() as UsdaSearchResponse
  return (data.foods ?? [])
    .map((food) => usdaFoodToProduct(food, query, translatedQuery))
    .filter((product): product is NonNullable<ReturnType<typeof usdaFoodToProduct>> => Boolean(product))
    .sort((a, b) => usdaProductScore(b, translatedQuery) - usdaProductScore(a, translatedQuery))
    .slice(0, 8)
}

function usdaFoodToProduct(food: UsdaFood, originalQuery: string, translatedQuery: string) {
  if (!food.fdcId || !food.description) return null
  const nutriments: Record<string, number | string> = {}

  for (const definition of usdaNutrients) {
    const nutrient = food.foodNutrients?.find((candidate) => {
      if (candidate.nutrientId && (definition.ids as readonly number[]).includes(candidate.nutrientId)) return true
      const name = candidate.nutrientName?.toLowerCase() ?? ''
      return definition.names.some((alias) => name === alias || name.startsWith(`${alias},`))
    })
    if (typeof nutrient?.value !== 'number' || !Number.isFinite(nutrient.value) || nutrient.value < 0) continue
    const sourceUnit = normalizeUsdaUnit(nutrient.unitName || definition.unit)
    nutriments[`${definition.key}_100g`] = definition.key === 'energy-kcal' && sourceUnit === 'kj'
      ? nutrient.value / 4.184
      : nutrient.value
    nutriments[`${definition.key}_unit`] = definition.key === 'energy-kcal' ? 'kcal' : sourceUnit
  }

  if (typeof nutriments['energy-kcal_100g'] !== 'number') return null
  return {
    code: `usda-${food.fdcId}`,
    product_name: localizeUsdaName(food.description, originalQuery, translatedQuery),
    brands: food.brandOwner || food.brandName || 'USDA FoodData Central',
    quantity: '100 g',
    product_quantity_unit: 'g',
    nutriments,
    source: 'usda',
    data_type: food.dataType,
    search_match: originalQuery,
  }
}

function normalizeUsdaUnit(unit: string) {
  const normalized = unit.trim().toLowerCase()
  if (normalized === 'ug' || normalized === 'μg') return 'µg'
  return normalized
}

function micronutrientCount(nutriments: Record<string, number | string>) {
  return usdaNutrients.slice(4).filter(({ key }) => typeof nutriments[`${key}_100g`] === 'number').length
}

function usdaProductScore(product: NonNullable<ReturnType<typeof usdaFoodToProduct>>, translatedQuery: string) {
  const name = String(product.product_name).toLowerCase()
  const translated = translatedQuery.toLowerCase()
  const firstTerm = translated.split(/\s+/)[0]
  let score = micronutrientCount(product.nutriments) * 2
  if (name.startsWith(firstTerm)) score += 45
  if (/\b(raw|plain|cooked|dry|uncooked|fresh)\b/.test(name)) score += 35
  if (/\b(dehydrated|powder|chips|pudding|nectar|salad|mixture|mix|with|sauce|baked)\b/.test(name)) score -= 30
  if (product.data_type === 'Foundation') score += 25
  else if (product.data_type === 'SR Legacy') score += 20
  else if (product.data_type === 'Survey (FNDDS)') score += 12
  return score
}

function localizeUsdaName(description: string, originalQuery: string, translatedQuery: string) {
  const name = sentenceCase(description)
  const english = translatedQuery.toLowerCase()
  const german = originalQuery.trim().replace(/(^|\s)\S/g, (letter) => letter.toLocaleUpperCase('de-DE'))
  if (/^pasta,?\s+cooked/i.test(description)) return 'Nudeln, gekocht'
  if (/^pasta,?\s+(dry|uncooked)/i.test(description)) return 'Nudeln, trocken'
  if (/^banana,?\s+raw/i.test(description)) return 'Banane, roh'
  if (/^egg,?\s+whole,?\s+raw/i.test(description)) return 'Ei, ganz und roh'
  if (/^oats?,?\s+/i.test(description)) return name.replace(/^Oats?/i, 'Haferflocken')
  return originalQuery.toLowerCase() !== english ? `${german} · ${name}` : name
}

function sentenceCase(value: string) {
  const normalized = value.trim().toLocaleLowerCase('en-US')
  return normalized ? normalized[0].toLocaleUpperCase('en-US') + normalized.slice(1) : ''
}
