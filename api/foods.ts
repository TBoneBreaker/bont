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

const fields = [
  'code',
  'product_name',
  'product_name_de',
  'brands',
  'quantity',
  'product_quantity_unit',
  'nutriments',
].join(',')

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

  try {
    const modernParams = new URLSearchParams({
      q: query,
      page: '1',
      page_size: '12',
      langs: 'de,en',
      fields,
    })
    const modern = await fetch(`https://search.openfoodfacts.org/search?${modernParams}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Bont/0.1 (https://bont-three.vercel.app)',
      },
      signal: AbortSignal.timeout(6_000),
    })

    if (modern.ok) {
      const data = await modern.json() as { hits?: unknown[] }
      if (Array.isArray(data.hits)) {
        response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600')
        return response.status(200).json({ products: data.hits })
      }
    }
    console.warn('[api/foods] Search-a-licious unavailable, using legacy fallback', { status: modern.status })

    const legacy = await fetch(`https://de.openfoodfacts.org/cgi/search.pl?${legacyParams}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Bont/0.1 (https://bont-three.vercel.app)',
      },
      signal: AbortSignal.timeout(7_000),
    })
    if (!legacy.ok) {
      console.error('[api/foods] Open Food Facts fallback failed', { status: legacy.status })
      return response.status(502).json({ error: 'Die Lebensmitteldatenbank antwortet gerade nicht.' })
    }

    const data = await legacy.json()
    response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600')
    return response.status(200).json(data)
  } catch (error) {
    console.error('[api/foods] Search failed', { error: error instanceof Error ? error.message : String(error) })
    return response.status(502).json({ error: 'Die Lebensmitteldatenbank ist gerade nicht erreichbar.' })
  }
}
