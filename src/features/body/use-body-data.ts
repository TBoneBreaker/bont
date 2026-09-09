import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../lib/db'

export function useBodyData(userId: string) {
  const entries = useLiveQuery(
    async () => (await db.body_entries.where('user_id').equals(userId).toArray())
      .filter((entry) => !entry.deleted_at)
      .sort((a, b) => a.entry_date.localeCompare(b.entry_date)),
    [userId],
    [],
  )
  const settings = useLiveQuery(() => db.user_settings.where('user_id').equals(userId).first(), [userId])
  return { entries, settings }
}
