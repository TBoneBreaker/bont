import type { SyncResult } from './sync-engine'

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error'

export interface UserSyncStatus {
  state: SyncState
  pending: number
  failed: number
  deadLetter: number
  lastError: string | null
  lastSyncedAt: string | null
}

const statuses = new Map<string, UserSyncStatus>()
const listeners = new Map<string, Set<(status: UserSyncStatus) => void>>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let syncRunner: ((userId: string) => void) | null = null

const initialStatus = (): UserSyncStatus => ({
  state: 'idle',
  pending: 0,
  failed: 0,
  deadLetter: 0,
  lastError: null,
  lastSyncedAt: null,
})

export function getSyncStatus(userId: string) {
  return statuses.get(userId) ?? initialStatus()
}

export function subscribeSyncStatus(userId: string, listener: (status: UserSyncStatus) => void) {
  const userListeners = listeners.get(userId) ?? new Set<(status: UserSyncStatus) => void>()
  userListeners.add(listener)
  listeners.set(userId, userListeners)
  return () => {
    userListeners.delete(listener)
    if (!userListeners.size) listeners.delete(userId)
  }
}

export function publishSyncStatus(userId: string, next: Partial<UserSyncStatus>) {
  const status = { ...getSyncStatus(userId), ...next }
  statuses.set(userId, status)
  listeners.get(userId)?.forEach((listener) => listener(status))
}

export function publishSyncResult(userId: string, result: SyncResult) {
  publishSyncStatus(userId, {
    state: result.error ? 'error' : 'idle',
    pending: result.pending,
    failed: result.failed,
    deadLetter: result.deadLetter,
    lastError: result.error ?? null,
    lastSyncedAt: result.error ? getSyncStatus(userId).lastSyncedAt : new Date().toISOString(),
  })
}

export function registerSyncRunner(runner: (userId: string) => void) {
  syncRunner = runner
}

export function scheduleUserSync(userId: string) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return
  const current = timers.get(userId)
  if (current) clearTimeout(current)
  timers.set(userId, setTimeout(() => {
    timers.delete(userId)
    syncRunner?.(userId)
  }, 350))
}
