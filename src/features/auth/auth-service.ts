import type { AuthError } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'

export const authService = {
  signIn(email: string, password: string) {
    return supabase.auth.signInWithPassword({ email, password })
  },

  signUp(email: string, password: string, redirectTo: string) {
    return supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectTo },
    })
  },

  sendMagicLink(email: string, redirectTo: string) {
    return supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
    })
  },

  sendPasswordReset(email: string, redirectTo: string) {
    return supabase.auth.resetPasswordForEmail(email, { redirectTo })
  },

  signOut() {
    return supabase.auth.signOut()
  },

  updatePassword(password: string) {
    return supabase.auth.updateUser({ password })
  },
}

export function isAuthError(error: unknown): error is AuthError {
  return Boolean(error && typeof error === 'object' && 'message' in error)
}
