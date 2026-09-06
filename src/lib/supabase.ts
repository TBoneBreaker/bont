import { createClient } from '@supabase/supabase-js'

// Supabase publishable keys are designed to be used in browser applications.
// Environment variables can still override these defaults for other deployments.
const defaultUrl = 'https://otygkrovpsvqtpenjicd.supabase.co'
const defaultPublishableKey = 'sb_publishable_vqSFCdipful6hGJrxImlrQ_XN8azhS2'

const url = import.meta.env.VITE_SUPABASE_URL?.trim() || defaultUrl
const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || defaultPublishableKey

export const isSupabaseConfigured = Boolean(url && publishableKey)

export const supabase = createClient(
  url,
  publishableKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'bont-auth',
    },
  },
)
