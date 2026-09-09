// Compatibility barrel. Feature code imports the stable repository/sync API;
// the physical storage and transport implementations live in dedicated modules.
export { db, BontDatabase } from './local-db/schema'
export {
  clearLocalUserData,
  listRecords,
  putRemoteRecord,
  saveRecord,
  saveRecordsAtomically,
  softDeleteRecord,
  softDeleteRecordsAtomically,
} from './local-db/local-repository'
export { syncUser } from './sync/sync-engine'
export { getSyncStatus, subscribeSyncStatus } from './sync/sync-status'
export type { SyncResult } from './sync/sync-engine'
