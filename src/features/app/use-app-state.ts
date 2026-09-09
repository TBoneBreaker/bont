import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../lib/db'
import { countOutbox } from '../../lib/sync/outbox'

export function useAppState(userId: string) {
  const profile = useLiveQuery(() => db.profiles.where('user_id').equals(userId).first(), [userId])
  const settings = useLiveQuery(() => db.user_settings.where('user_id').equals(userId).first(), [userId])
  const sync = useLiveQuery(() => countOutbox(userId), [userId], { pending: 0, failed: 0, deadLetter: 0 })
  return { profile, settings, sync }
}
