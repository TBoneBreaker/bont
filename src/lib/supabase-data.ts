import type { PostgrestError } from '@supabase/supabase-js'
import type { AnySyncedRecord, SyncedTableName } from '../types'
import { supabase } from './supabase'
import type { SyncCursor } from './sync/conflict-policy'
import { parseRemoteRecord } from './validation'

export interface RemoteResult<T> {
  data: T | null
  error: PostgrestError | null
}

/**
 * Dynamic table names cannot be represented by Supabase's generated overloads
 * without producing an intersection of all Insert types. This is the one
 * transport boundary where the runtime table union is converted to domain
 * records; feature code remains fully typed.
 */
export async function upsertSyncedRecord(
  table: SyncedTableName,
  payload: AnySyncedRecord,
  conflictTarget: string,
): Promise<RemoteResult<AnySyncedRecord>> {
  const response = await supabase
    .from(table as never)
    .upsert(payload as never, { onConflict: conflictTarget })
    .select('*')
    .maybeSingle()
  return { data: response.data ? parseRemoteRecord(response.data, payload.user_id) : null, error: response.error }
}

export async function findRemoteBodyEntry(userId: string, entryDate: string): Promise<RemoteResult<AnySyncedRecord>> {
  const response = await supabase
    .from('body_entries')
    .select('*')
    .eq('user_id', userId)
    .eq('entry_date', entryDate)
    .maybeSingle()
  return { data: response.data ? parseRemoteRecord(response.data, userId) : null, error: response.error }
}

export async function findRemoteGoalSettingsHistory(
  userId: string,
  effectiveFrom: string,
): Promise<RemoteResult<AnySyncedRecord>> {
  const response = await supabase
    .from('goal_settings_history')
    .select('*')
    .eq('user_id', userId)
    .eq('effective_from', effectiveFrom)
    .maybeSingle()
  return { data: response.data ? parseRemoteRecord(response.data, userId) : null, error: response.error }
}

export async function fetchSyncedPage(
  table: SyncedTableName,
  userId: string,
  cursor: SyncCursor | null,
  from: number,
  to: number,
): Promise<RemoteResult<AnySyncedRecord[]>> {
  let query = supabase
    .from(table as never)
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to)
  if (cursor) {
    query = query.or(`updated_at.gt.${cursor.updated_at},and(updated_at.eq.${cursor.updated_at},id.gt.${cursor.id})`)
  }
  const response = await query
  return {
    data: response.data ? response.data.map((row) => parseRemoteRecord(row, userId)) : null,
    error: response.error,
  }
}
