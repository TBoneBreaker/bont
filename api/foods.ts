import { createClient } from '@supabase/supabase-js'

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

declare const process: { env: Record<string, string | undefined> }

/**
 * Search endpoint for the internal catalog. Source APIs deliberately do not
 * run here: imports are the only boundary at which external data is read.
 */
export default async function handler(request: RequestLike, response: ResponseLike) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    response.status(405).json({ error: 'Methode nicht erlaubt.' })
    return
  }

  const url = new URL(request.url ?? '/', 'http://localhost')
  const query = url.searchParams.get('q')?.trim() ?? ''
  if (query.length < 2 || query.length > 80) {
    response.status(400).json({ error: 'Die Suche muss zwischen 2 und 80 Zeichen enthalten.' })
    return
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!supabaseUrl || !publishableKey) {
    response.status(503).json({ error: 'Die Lebensmitteldatenbank ist noch nicht konfiguriert.' })
    return
  }

  const supabase = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const { data, error } = await supabase.rpc('search_foods', {
    search_query: query,
    result_limit: 30,
  })

  if (error) {
    console.error('food catalog search failed', { code: error.code, message: error.message })
    response.status(502).json({ error: 'Die Lebensmitteldatenbank ist gerade nicht erreichbar.' })
    return
  }

  response.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900')
  response.status(200).json({ foods: data ?? [] })
}
