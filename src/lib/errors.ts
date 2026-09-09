export class UserFacingError extends Error {
  readonly userMessage: string

  constructor(userMessage: string, options?: { cause?: unknown }) {
    super(userMessage, options)
    this.name = 'UserFacingError'
    this.userMessage = userMessage
  }
}

export function getUserMessage(
  error: unknown,
  fallback = 'Das hat leider nicht funktioniert. Bitte versuche es erneut.',
) {
  if (error instanceof UserFacingError) return error.userMessage
  if (error instanceof Error && /network|fetch|offline|failed to fetch/i.test(error.message)) {
    return 'Die Verbindung ist gerade nicht verfügbar. Deine lokalen Änderungen bleiben erhalten.'
  }
  if (error instanceof Error && /invalid login credentials/i.test(error.message)) {
    return 'E-Mail-Adresse oder Passwort ist nicht korrekt.'
  }
  if (error instanceof Error && /email not confirmed/i.test(error.message)) {
    return 'Bestätige zuerst deine E-Mail-Adresse.'
  }
  if (error instanceof Error && /rate limit/i.test(error.message)) {
    return 'Zu viele Anfragen. Warte kurz und versuche es danach erneut.'
  }
  return fallback
}

export function logError(context: string, error: unknown) {
  console.error(`[bont] ${context}`, error)
}
