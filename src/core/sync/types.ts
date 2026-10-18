/**
 * sync 子系统类型。
 *
 * 上半部分为平台客户端协议类型:镜像 @cgraphx-server/contract client.ts v1,只增不改
 * (字段名与可选性逐字同契约)。产出 type 放宽为字符串(服务端自契约 0.3.0 起按字符串接收)。
 * 下半部分为本地类型(连接信息、同步状态、接入入参与结果)。
 */

import type { ServerTier } from './version';

// ─── 协议类型(镜像 @cgraphx-server/contract client.ts v1,只增不改) ──────────

/** 产物类型标识:内置类型 + 项目自定义类型(合法标识口径见产物注册表)。 */
export type ArtifactType = string;

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
  /** 服务端协议版本(如 '1.1');旧服务端不返回。 */
  protocolVersion?: string;
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
  /** 任务键(目录任务 feature-id);未带 taskId 时用任务键指向任务,两者都带以 taskId 为准。 */
  taskKey?: string;
  start: string;
  end: string | null;
}

/** 任务声明:随上报批次携带,按(仓库, 任务键)幂等建任务。 */
export interface IngestTaskDeclaration {
  taskKey: string;
  name: string;
  declaredAt: string;
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
  /** 任务键(所在产出目录的 feature-id);协议 ≥ 1.2 且位于需求目录时携带。 */
  taskKey?: string;
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
  taskDeclarations?: IngestTaskDeclaration[];
  sessions: IngestSession[];
}

export type IngestWarning =
  | { kind: 'binding_ineffective'; bindingId: string; reason: 'task_not_found' | 'not_owner' | 'task_closed' }
  | { kind: 'path_dropped'; path: string }
  | { kind: 'binding_pending'; bindingId: string; taskKey: string }
  | { kind: 'task_key_declared_by_other'; taskKey: string }
  | { kind: 'task_declaration_invalid'; taskKey: string; reason: 'invalid_key' | 'invalid_name' }
  | { kind: 'artifact_type_unknown'; path: string; type: string };

export interface IngestResponse {
  accepted: {
    events: number;
    bindings: number;
    commits: number;
    artifacts: number;
    references: number;
  };
  warnings: IngestWarning[];
  /** 本批涉及的任务键 → 平台任务 id(含已存在的任务);挂起的任务键不在其中。 */
  taskKeys?: Array<{ taskKey: string; taskId: string }>;
  /** 服务端协议版本(如 '1.1');旧服务端不返回。 */
  protocolVersion?: string;
}

/** 支持任务声明与任务键的最低服务端协议版本(用 protocolAtLeast 比较)。 */
export const TASK_KEY_PROTOCOL_VERSION = '1.1';

/** 产出携带任务键的最低服务端协议版本(spec §11.1)。 */
export const ARTIFACT_TASK_KEY_PROTOCOL_VERSION = '1.2';

/** 调用 `/spec` 拉取本项目类型表的最低服务端协议版本(spec §11.1)。 */
export const PROJECT_SPEC_PROTOCOL_VERSION = '1.3';

// ─── 本地类型 ───────────────────────────────────────────────────────────────

/** 本地连接信息(`sync_state.connection`);手工存量配置时后三项为 null。不含 token。 */
export interface SyncConnection {
  serverUrl: string;
  username: string | null;
  projectName: string | null;
  connectedAt: string | null;
}

/** 本轮在档位可上报集合外、不发送的产出(path 为仓库相对路径,spec §11.4)。 */
export interface UnreportedArtifact {
  type: string;
  path: string;
}

/** `sync_state.platform_spec`:最近一次 `/spec` 返回的本项目类型表缓存。 */
export interface PlatformSpecCache {
  fetchedAt: string;
  artifactTypes: Array<{ key: string; name: string; phase: string }>;
}

/** `sync_state.warnings`:最近一次收到的平台告警(spec §11.4)。 */
export interface WarningsRecord {
  at: string;
  items: IngestWarning[];
}

/** 一轮同步的结果摘要。 */
export interface SyncRunResult {
  at: string;
  ok: boolean;
  sessionsSent: number;
  recordsSent: number;
  isolatedNew: number;
  warnings: number;
  /** 本轮收到的平台告警(按到达顺序);持久化到状态时不保存。 */
  warningItems: IngestWarning[];
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
  /** 平台返回的协议版本;未知(旧服务端 / 尚未上报)为 null。 */
  serverProtocolVersion: string | null;
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

/** `getSyncStatus` 的本地同步状态报告(spec §7)。 */
export interface SyncStatusReport {
  connected: boolean;
  connection: SyncConnection | null;
  state: SyncStatusState;
  /** 各候选会话中尚未上报的事件数之和。 */
  backlogEvents: number;
  /** 需要上报的会话数(含终端会话需发送时)。 */
  pendingSessions: number;
  /** 被平台拒收而隔离的会话数。 */
  isolatedSessions: number;
  /** 服务端协议档位(spec §11.1)。 */
  tier: ServerTier;
  /** 档位 1.3 且已有缓存时的本项目类型表摘要。 */
  platformSpec: { typeCount: number; fetchedAt: string } | null;
  /** 最近一次收到的平台告警(spec §11.4)。 */
  lastWarnings: WarningsRecord | null;
  /** 当前未上报产出,按类型汇总。 */
  unreported: Array<{ type: string; count: number; samplePath: string }>;
}
