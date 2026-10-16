/**
 * sync 子系统类型。
 *
 * 上半部分为平台客户端协议类型:镜像 @cgraphx-server/contract client.ts v1,只增不改
 * (字段名与可选性逐字同契约)。下半部分为本地类型(连接信息、同步状态、接入入参与结果)。
 */

// ─── 协议类型(镜像 @cgraphx-server/contract client.ts v1,只增不改) ──────────

/** 产物类型,顺序同契约 enums.ts。 */
export const ARTIFACT_TYPES = [
  'spec',
  'plan',
  'wireframe',
  'api_test_spec',
  'api_test_report',
  'unit_test_spec',
  'unit_test_report',
  'ui_test_spec',
  'ui_test_report',
  'knowledge',
  'code_map',
  'design_map',
  'schema_knowledge',
] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

/** 平台错误码(错误体 `{ error, message, retryable }` 的 error)。 */
export const CLIENT_ERROR_CODES = [
  'invalid_token',
  'account_disabled',
  'repo_not_registered',
  'repo_disabled',
  'not_project_member',
  'invalid_credentials',
  'validation_failed',
  'internal_error',
  'payload_too_large',
] as const;
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];

/** 导致自动同步暂停的不可重试拒绝(spec §3.3)。 */
export const PAUSE_REASONS = [
  'invalid_token',
  'account_disabled',
  'repo_not_registered',
  'repo_disabled',
  'not_project_member',
] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];

export interface ConnectRequest {
  username: string;
  password: string;
  remoteUrl: string;
  clientName: string;
  clientVersion: string;
}

export interface ConnectResponse {
  token: string;
  project: { id: number; name: string };
  repo: { id: number; defaultBranch: string };
}

export interface ClientStatus {
  lastSyncAt: string | null;
  backlog: number | null;
}

export interface IngestEvent {
  eventId: string;
  ts: string;
  type: string;
  toolName?: string;
  skillName?: string;
}

export interface IngestBinding {
  bindingId: string;
  taskId: string | null;
  start: string;
  end: string | null;
}

export interface IngestCommit {
  hash: string;
  message: string;
  branch: string | null;
  files: string[];
  insertions: number;
  deletions: number;
  ts: string;
}

export interface IngestArtifact {
  type: ArtifactType;
  path: string;
  action: 'create' | 'modify';
  commitHash: string | null;
  branch: string | null;
  ts: string;
}

export interface IngestReference {
  kind: 'file' | 'concept';
  value: string;
  ts: string;
}

export interface IngestSession {
  clientSessionId: string;
  events: IngestEvent[];
  bindings: IngestBinding[];
  commits: IngestCommit[];
  artifacts: IngestArtifact[];
  references: IngestReference[];
}

export interface IngestRequest {
  remoteUrl: string;
  clientName: string;
  clientVersion: string;
  backlog?: number;
  sessions: IngestSession[];
}

export type IngestWarning =
  | { kind: 'binding_ineffective'; bindingId: string; reason: 'task_not_found' | 'not_owner' | 'task_closed' }
  | { kind: 'path_dropped'; path: string };

export interface IngestResponse {
  accepted: {
    events: number;
    bindings: number;
    commits: number;
    artifacts: number;
    references: number;
  };
  warnings: IngestWarning[];
}

// ─── 本地类型 ───────────────────────────────────────────────────────────────

/** 本地连接信息(`sync_state.connection`);手工存量配置时后三项为 null。不含 token。 */
export interface SyncConnection {
  serverUrl: string;
  username: string | null;
  projectName: string | null;
  connectedAt: string | null;
}

/** 一轮同步的结果摘要。 */
export interface SyncRunResult {
  at: string;
  ok: boolean;
  sessionsSent: number;
  recordsSent: number;
  isolatedNew: number;
  warnings: number;
  stoppedBy: 'paused' | 'failing' | 'not_connected' | 'busy' | null;
  error: string | null;
}

/** 同步状态(`sync_state.status`);时间均为 ISO 8601 或 null。 */
export interface SyncStatusState {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  failingSince: string | null;
  lastError: string | null;
  pausedReason: PauseReason | null;
  pausedAt: string | null;
  lastProbeAt: string | null;
  lastResult: SyncRunResult | null;
}

/** `connectPlatform` 入参;密码经回调读取,不进命令行参数。 */
export interface ConnectInput {
  serverUrl?: string;
  username?: string;
  force: boolean;
  readPassword: () => Promise<string>;
}

export type ConnectOutcome =
  | { kind: 'already'; connection: SyncConnection }
  | { kind: 'connected'; connection: SyncConnection; replacedExisting: boolean };

/** `cgraphx docs` 记录的精确参考命中。 */
export interface ReferenceHit {
  kind: 'concept' | 'file';
  value: string;
  sessionId?: string;
}
