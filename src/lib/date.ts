/**
 * Returns a calendar date in the user's local timezone.
 * ISO strings are UTC based and can otherwise show the previous/next day
 * around midnight for date-only fields.
 */
export function localDateString(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function dateAtNoon(date: string) {
  return `${date}T12:00:00.000Z`
}
