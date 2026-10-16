/**
 * sync 子系统公共门面(接入研发管理平台:接入 / 断开 / 上报)。
 *
 * 外部调用方(cli、docs、hooks、installer)只通过本模块调用,不得直接伸手进内部模块。
 * sync 只经 task / timeline / agents 的门面取数据;它们不依赖 sync。
 */

export { openSyncDb, ensureSyncSchema } from './schema-bootstrap';
export { connectPlatform, disconnectPlatform, readConnection, recordReferenceHit } from './connection';
export { spawnSyncWorker } from './spawn';
export { runSync, runWorker } from './runner';
export { getSyncStatus } from './status';
export { getClientVersion } from './version';
export {
  SYNC_SCHEMA_VERSION,
  CLIENT_NAME,
  CLIENT_API_PREFIX,
  TASKS_PATH_SUFFIX,
  CLIENT_TIMEOUT_MS,
  TERMINAL_SESSION_PREFIX,
  SEDIMENT_DIRS,
  LOCK_FILENAME,
  TRIGGER_FILENAME,
  LOCK_STALE_MS,
  WORKER_PID_FILENAME,
  PAUSE_PROBE_MS,
  FAIL_NOTICE_MS,
  WORKER_TRAIL_MS,
  BATCH_MAX_SESSIONS,
  BATCH_MAX_EVENTS,
  BATCH_MAX_BYTES,
  FOREGROUND_LOCK_WAIT_MS,
} from './constants';
export { ARTIFACT_TYPES, CLIENT_ERROR_CODES, PAUSE_REASONS } from './types';
export type {
  ArtifactType,
  ClientErrorCode,
  PauseReason,
  ConnectRequest,
  ConnectResponse,
  ClientStatus,
  IngestEvent,
  IngestBinding,
  IngestCommit,
  IngestArtifact,
  IngestReference,
  IngestSession,
  IngestRequest,
  IngestWarning,
  IngestResponse,
  SyncConnection,
  SyncRunResult,
  SyncStatusState,
  ConnectInput,
  ConnectOutcome,
  ReferenceHit,
  SyncStatusReport,
} from './types';
export {
  SyncError,
  SyncArgError,
  SyncNotInitializedError,
  SyncNotConnectedError,
  SyncSchemaError,
  SyncPlatformError,
  SyncNetworkError,
  SyncBusyError,
  exitCodeForError,
  exitCodeForRunResult,
} from './errors';
