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

  const params = new URLSearchParams({
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
    const upstream = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?${params}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Bont/0.1 (https://bont-three.vercel.app)',
      },
      signal: AbortSignal.timeout(8_000),
    })

    if (!upstream.ok) {
      console.error('[api/foods] Open Food Facts request failed', { status: upstream.status })
      return response.status(502).json({ error: 'Die Lebensmitteldatenbank antwortet gerade nicht.' })
    }

    const data = await upstream.json()
    response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600')
    return response.status(200).json(data)
  } catch (error) {
    console.error('[api/foods] Search failed', { error: error instanceof Error ? error.message : String(error) })
    return response.status(502).json({ error: 'Die Lebensmitteldatenbank ist gerade nicht erreichbar.' })
  }
}
