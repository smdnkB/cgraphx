/**
 * 同步执行器(spec §4.1–§4.6、§9):候选判定 → 构造 → 发送前断言 → 分批上报 → 失败分级 → 进度推进。
 *
 * 进度只按「整批成功响应」推进(spec §4.6),不使用回执里的 `accepted` 计数;`warnings` 只计数,不重试、不提示。
 * 一轮同步期间持有 `.cgraphx/sync.lock`;worker 另持 `.cgraphx/sync-worker.pid`(见 lock.ts)。
 */

import type { SqliteDatabase } from '../db';
import { recordFeatureTaskMappings, refreshAutoBindings } from '../task';
import { listCommitEvents, listSessionEventMaxIds } from '../timeline';
import { getStatus as probePlatformStatus, postIngest } from './client';
import { readConnection } from './connection';
import {
  BATCH_MAX_BYTES,
  BATCH_MAX_EVENTS,
  BATCH_MAX_SESSIONS,
  CLIENT_NAME,
  FOREGROUND_LOCK_WAIT_MS,
  PAUSE_PROBE_MS,
  PLATFORM_HINTS,
  WORKER_TRAIL_MS,
} from './constants';
import { SyncBusyError, SyncError, SyncNotConnectedError, SyncPlatformError } from './errors';
import { getOriginUrl } from './git';
import { acquireLock, claimWorker, refreshWorker, releaseLock, releaseWorker } from './lock';
import { isSafeRelPath } from './paths';
import {
  bindingsHashOf,
  buildSessionPayload,
  buildTerminalPayload,
  createSyncContext,
  taskDeclarationsFor,
  type BuiltSession,
  type SyncContext,
} from './payload';
import { openSyncDb } from './schema-bootstrap';
import {
  ackSession,
  advanceSessionEvents,
  getConnection,
  getStatus as readStatusState,
  isolateSession,
  listSessions,
  setStatus,
  updatePendingPush,
  type SyncSessionRow,
} from './store';
import {
  PAUSE_REASONS,
  TASK_KEY_PROTOCOL_VERSION,
  type IngestRequest,
  type IngestSession,
  type PauseReason,
  type SyncRunResult,
  type SyncStatusState,
} from './types';

type SyncMode = 'foreground' | 'background';

function isPauseReason(code: string): code is PauseReason {
  return (PAUSE_REASONS as readonly string[]).includes(code);
}

/** 暂停原因 → 提示(spec §3.3)。 */
function pauseHint(reason: PauseReason): string {
  return PLATFORM_HINTS[reason] ?? reason;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── 候选判定 ───────────────────────────────────────────────────────────────

/** 被隔离且客户端版本未变 → 本轮跳过(版本变化后自动重试,spec §4.5)。 */
export function isExcludedByIsolation(row: SyncSessionRow | undefined, clientVersion: string): boolean {
  return row !== undefined && row.isolated_reason !== null && row.isolated_client_version === clientVersion;
}

/** agent 会话候选判定(plan T-4 runSync 第 5 步)。 */
export function isAgentCandidate(
  ctx: Pick<SyncContext, 'bindingsBySession' | 'clientVersion' | 'supportsTaskKey'>,
  sessionId: string,
  maxId: number,
  row: SyncSessionRow | undefined,
): boolean {
  if (isExcludedByIsolation(row, ctx.clientVersion)) return false;
  if (row === undefined) return true;
  if (maxId > row.last_event_id) return true;
  if (row.pending_push === 1) return true;
  if (bindingsHashOf(ctx.bindingsBySession.get(sessionId) ?? [], ctx.supportsTaskKey) !== row.bindings_hash) return true;
  return row.isolated_reason !== null && row.isolated_client_version !== ctx.clientVersion;
}

/** 终端会话是否需要发送:有终端 commit、未被同版本隔离、内容哈希变化。 */
export function terminalNeedsSend(
  built: BuiltSession | null,
  rows: Map<string, SyncSessionRow>,
  clientVersion: string,
): built is BuiltSession {
  if (built === null) return false;
  const row = rows.get(built.session.clientSessionId);
  if (isExcludedByIsolation(row, clientVersion)) return false;
  return built.extrasHash !== row?.extras_hash;
}

// ─── 发送前断言 ─────────────────────────────────────────────────────────────

/** 移除不安全路径条目(就地修改),返回丢弃条数。 */
function dropUnsafePaths(session: IngestSession): number {
  let dropped = 0;
  for (const commit of session.commits) {
    const safe = commit.files.filter(isSafeRelPath);
    dropped += commit.files.length - safe.length;
    commit.files = safe;
  }
  const artifacts = session.artifacts.filter((a) => isSafeRelPath(a.path));
  dropped += session.artifacts.length - artifacts.length;
  session.artifacts = artifacts;
  const references = session.references.filter((r) => r.kind !== 'file' || isSafeRelPath(r.value));
  dropped += session.references.length - references.length;
  session.references = references;
  return dropped;
}

// ─── 分块与装箱 ─────────────────────────────────────────────────────────────

/** 一个会话的一块:非最后块只含事件;最后块带 bindings / commits / artifacts / references。 */
interface Chunk {
  session: IngestSession;
  built: BuiltSession;
  isLast: boolean;
  recordCount: number;
  bytes: number;
}

function makeChunk(built: BuiltSession, session: IngestSession, isLast: boolean): Chunk {
  const recordCount =
    session.events.length +
    session.bindings.length +
    session.commits.length +
    session.artifacts.length +
    session.references.length;
  return { session, built, isLast, recordCount, bytes: Buffer.byteLength(JSON.stringify(session), 'utf-8') };
}

/** 把会话的事件切成 ≤ BATCH_MAX_EVENTS 的块;其余字段只放最后一块。 */
function chunkSession(built: BuiltSession, maxEvents: number): Chunk[] {
  const s = built.session;
  const chunks: Chunk[] = [];
  let start = 0;
  while (s.events.length - start > maxEvents) {
    const events = s.events.slice(start, start + maxEvents);
    chunks.push(
      makeChunk(built, { clientSessionId: s.clientSessionId, events, bindings: [], commits: [], artifacts: [], references: [] }, false),
    );
    start += maxEvents;
  }
  chunks.push(makeChunk(built, { ...s, events: s.events.slice(start) }, true));
  return chunks;
}

/** 单块事件对半切(413 后重发用);事件 < 2 条返回 null。 */
function splitChunkEvents(chunk: Chunk): [Chunk, Chunk] | null {
  const s = chunk.session;
  if (s.events.length < 2) return null;
  const mid = Math.ceil(s.events.length / 2);
  const head = makeChunk(
    chunk.built,
    { clientSessionId: s.clientSessionId, events: s.events.slice(0, mid), bindings: [], commits: [], artifacts: [], references: [] },
    false,
  );
  const tail = makeChunk(chunk.built, { ...s, events: s.events.slice(mid) }, chunk.isLast);
  return [head, tail];
}

/** 请求信封(不含 sessions)的近似字节数。 */
function envelopeBytes(ctx: SyncContext): number {
  return Buffer.byteLength(
    JSON.stringify({
      remoteUrl: ctx.remoteUrl,
      clientName: CLIENT_NAME,
      clientVersion: ctx.clientVersion,
      backlog: Number.MAX_SAFE_INTEGER,
      sessions: [],
    }),
    'utf-8',
  );
}

/** 按会话数 / 事件数 / 字节数装箱,保持块顺序(同会话的块先后不变)。 */
function packBatches(chunks: Chunk[], baseBytes: number): Chunk[][] {
  const batches: Chunk[][] = [];
  let current: Chunk[] = [];
  let events = 0;
  let bytes = baseBytes;
  for (const chunk of chunks) {
    const n = chunk.session.events.length;
    const fits =
      current.length < BATCH_MAX_SESSIONS &&
      events + n <= BATCH_MAX_EVENTS &&
      bytes + chunk.bytes + 1 <= BATCH_MAX_BYTES;
    if (!fits && current.length > 0) {
      batches.push(current);
      current = [];
      events = 0;
      bytes = baseBytes;
    }
    current.push(chunk);
    events += n;
    bytes += chunk.bytes + 1;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** 按会话分组(保持首次出现顺序)。 */
function groupBySession(chunks: Chunk[]): Chunk[][] {
  const groups = new Map<string, Chunk[]>();
  for (const chunk of chunks) {
    const id = chunk.session.clientSessionId;
    const list = groups.get(id);
    if (list === undefined) groups.set(id, [chunk]);
    else list.push(chunk);
  }
  return [...groups.values()];
}

// ─── 一轮上报 ───────────────────────────────────────────────────────────────

interface Stop {
  stoppedBy: 'paused' | 'failing';
  error: string;
}

interface Round {
  db: SqliteDatabase;
  ctx: SyncContext;
  serverUrl: string;
  token: string;
  now: string;
  status: SyncStatusState;
  /** 本轮剩余未确认的记录数(随请求上报为 backlog)。 */
  remaining: number;
  sessionsSent: number;
  recordsSent: number;
  isolatedNew: number;
  warnings: number;
  /** 本轮被隔离的会话:其后续块不再发送,防止水位越过被拒数据。 */
  isolated: Set<string>;
  /** 是否已发过单会话请求(判定「首个单会话请求被拒 + 涉及远程地址」为整批级错误)。 */
  singleSessionSent: boolean;
}

/** 整批成功后推进进度:非最后块只推进 last_event_id;最后块写满进度并清隔离标记。 */
function ackChunks(round: Round, chunks: Chunk[]): void {
  round.db.transaction(() => {
    for (const chunk of chunks) {
      const id = chunk.session.clientSessionId;
      if (!chunk.isLast) {
        const last = chunk.session.events[chunk.session.events.length - 1];
        if (last !== undefined) advanceSessionEvents(round.db, id, Number(last.eventId));
        continue;
      }
      ackSession(round.db, {
        sessionId: id,
        lastEventId: chunk.built.maxEventId,
        bindingsHash: chunk.built.bindingsHash,
        extrasHash: chunk.built.extrasHash,
        pendingPush: chunk.built.pendingPush,
        uploadedAt: round.now,
      });
    }
  })();
  for (const chunk of chunks) {
    if (chunk.isLast) round.sessionsSent++;
    round.recordsSent += chunk.recordCount;
    round.remaining -= chunk.recordCount;
  }
}

function isolate(round: Round, sessionId: string, reason: string): void {
  isolateSession(round.db, sessionId, reason, round.ctx.clientVersion);
  round.isolated.add(sessionId);
  round.isolatedNew++;
}

function mentionsRemote(message: string): boolean {
  return message.includes('remote') || message.includes('远程');
}

/** 发一批;失败按类别拆分 / 隔离 / 终止。返回 null 表示本批已处理完(成功或已隔离),可继续后续批次。 */
async function sendBatch(round: Round, input: Chunk[]): Promise<Stop | null> {
  const chunks = input.filter((c) => !round.isolated.has(c.session.clientSessionId));
  if (chunks.length === 0) return null;
  const groups = groupBySession(chunks);
  const single = groups.length === 1;
  const firstSingle = single && !round.singleSessionSent;
  if (single) round.singleSessionSent = true;

  try {
    // 声明按「本批任一绑定段指向的任务键」过滤;块可能只含事件,故取 built 的完整会话绑定。
    const taskDeclarations = taskDeclarationsFor(
      round.ctx,
      chunks.flatMap((c) => c.built.session.bindings),
    );
    const request: IngestRequest = {
      remoteUrl: round.ctx.remoteUrl,
      clientName: CLIENT_NAME,
      clientVersion: round.ctx.clientVersion,
      backlog: Math.max(0, round.remaining),
      sessions: chunks.map((c) => c.session),
    };
    if (taskDeclarations !== undefined) request.taskDeclarations = taskDeclarations;

    const resp = await postIngest(round.serverUrl, round.token, request);
    // 平台协议版本写回状态:下一次构造哈希时据此决定是否携带任务键。
    if (resp.protocolVersion !== undefined) round.status.serverProtocolVersion = resp.protocolVersion;
    // 回执映射先写回再确认进度,写失败时下一轮会重发同一批。
    if (resp.taskKeys !== undefined && resp.taskKeys.length > 0) {
      recordFeatureTaskMappings(
        round.ctx.projectRoot,
        resp.taskKeys.map(({ taskKey, taskId }) => ({ featureId: taskKey, taskId })),
      );
    }
    ackChunks(round, chunks);
    round.warnings += resp.warnings.length;
    return null;
  } catch (err) {
    if (!(err instanceof SyncPlatformError)) {
      if (err instanceof SyncError) return failing(round, err.message);
      throw err;
    }

    if (err.code === 'payload_too_large') {
      if (chunks.length > 1) return sendHalves(round, chunks);
      const only = chunks[0] as Chunk;
      const parts = splitChunkEvents(only);
      if (parts === null) {
        isolate(round, only.session.clientSessionId, err.message);
        return null;
      }
      return sendHalves(round, parts, true);
    }

    if (err.code === 'validation_failed') {
      if (!single) {
        const mid = Math.ceil(groups.length / 2);
        return (await sendBatch(round, groups.slice(0, mid).flat())) ?? sendBatch(round, groups.slice(mid).flat());
      }
      if (firstSingle && mentionsRemote(err.message)) return failing(round, err.message);
      isolate(round, (chunks[0] as Chunk).session.clientSessionId, err.message);
      return null;
    }

    if (isPauseReason(err.code)) {
      round.status.pausedReason = err.code;
      round.status.pausedAt = round.now;
      return { stoppedBy: 'paused', error: pauseHint(err.code) };
    }

    return failing(round, err.message);
  }
}

/** 对半拆分后顺序重发。`alreadySplit` 为 true 时 `chunks` 恰为两半。 */
async function sendHalves(round: Round, chunks: Chunk[], alreadySplit = false): Promise<Stop | null> {
  const mid = alreadySplit ? 1 : Math.ceil(chunks.length / 2);
  return (await sendBatch(round, chunks.slice(0, mid))) ?? sendBatch(round, chunks.slice(mid));
}

function failing(round: Round, message: string): Stop {
  round.status.failingSince ??= round.now;
  round.status.lastError = message;
  return { stoppedBy: 'failing', error: message };
}

/** 构造本轮候选会话的块(含发送前断言与只更新 pending_push 的分支)。 */
async function collectChunks(round: Round): Promise<Chunk[]> {
  const { db, ctx } = round;
  const locals = await listSessionEventMaxIds(ctx.projectRoot);
  const rows = listSessions(db);
  const builtList: BuiltSession[] = [];

  for (const { sessionId, maxId } of locals) {
    const row = rows.get(sessionId);
    if (!isAgentCandidate(ctx, sessionId, maxId, row)) continue;
    const built = await buildSessionPayload(ctx, sessionId, row?.last_event_id ?? 0);
    if (built.session.events.length === 0 && built.extrasHash === row?.extras_hash) {
      if (row !== undefined && (row.pending_push === 1) !== built.pendingPush) {
        updatePendingPush(db, sessionId, built.pendingPush);
      }
      continue;
    }
    builtList.push(built);
  }

  const terminal = buildTerminalPayload(ctx);
  if (terminalNeedsSend(terminal, rows, ctx.clientVersion)) builtList.push(terminal);

  const chunks: Chunk[] = [];
  for (const built of builtList) {
    const dropped = dropUnsafePaths(built.session);
    if (dropped > 0) process.stderr.write(`[sync] 已丢弃不安全路径 ${dropped} 条\n`);
    chunks.push(...chunkSession(built, BATCH_MAX_EVENTS));
  }
  return chunks;
}

function makeResult(
  at: string,
  round: Round | null,
  stop: Stop | null,
  stoppedBy: SyncRunResult['stoppedBy'] = stop?.stoppedBy ?? null,
): SyncRunResult {
  const by = stoppedBy;
  return {
    at,
    ok: by === null,
    sessionsSent: round?.sessionsSent ?? 0,
    recordsSent: round?.recordsSent ?? 0,
    isolatedNew: round?.isolatedNew ?? 0,
    warnings: round?.warnings ?? 0,
    stoppedBy: by,
    error: stop?.error ?? null,
  };
}

/**
 * 跑一轮同步。
 *
 * @throws SyncNotConnectedError foreground 且未接入。
 * @throws SyncBusyError foreground 且等锁超时(后台同步正在进行)。
 */
export async function runSync(projectRoot: string, mode: SyncMode): Promise<SyncRunResult> {
  const startedAt = new Date().toISOString();

  // 1. 接入判定
  const conn = readConnection(projectRoot);
  if (conn === null) {
    if (mode === 'foreground') throw new SyncNotConnectedError('未接入平台,先运行 cgraphx sync connect');
    return makeResult(startedAt, null, null, 'not_connected');
  }

  // 2. 取锁
  if (!acquireLock(projectRoot, mode === 'foreground' ? FOREGROUND_LOCK_WAIT_MS : 0)) {
    if (mode === 'foreground') throw new SyncBusyError('后台同步正在进行,稍后再试');
    return makeResult(startedAt, null, null, 'busy');
  }

  const dbConn = openSyncDbLocked(projectRoot);
  try {
    const db = dbConn.getDb();
    const status = readStatusState(db);
    const now = new Date().toISOString();
    const finish = (round: Round | null, stop: Stop | null): SyncRunResult => {
      const result = makeResult(now, round, stop);
      status.lastResult = result;
      setStatus(db, status, now);
      return result;
    };

    // 3. 暂停处理
    if (status.pausedReason === 'invalid_token') {
      return finish(null, { stoppedBy: 'paused', error: pauseHint('invalid_token') });
    }
    if (status.pausedReason !== null) {
      const lastProbe = status.lastProbeAt === null ? NaN : Date.parse(status.lastProbeAt);
      if (mode === 'background' && Date.now() - lastProbe < PAUSE_PROBE_MS) {
        return finish(null, { stoppedBy: 'paused', error: pauseHint(status.pausedReason) });
      }
      status.lastProbeAt = now;
      try {
        const remoteUrl = getOriginUrl(projectRoot);
        if (remoteUrl === null) throw new SyncError('当前仓库没有 origin 远程地址,请先运行 `git remote add origin <url>`');
        await probePlatformStatus(conn.serverUrl, conn.token, remoteUrl);
        status.pausedReason = null;
        status.pausedAt = null;
      } catch (err) {
        if (err instanceof SyncPlatformError && isPauseReason(err.code)) {
          status.pausedReason = err.code;
          return finish(null, { stoppedBy: 'paused', error: pauseHint(err.code) });
        }
        if (!(err instanceof SyncError)) throw err;
        return finish(null, { stoppedBy: 'failing', error: err.message });
      }
    }

    // 4. 先刷新自动绑定派生;失败只记为本轮错误,沿用上次派生结果继续同步
    let refreshError: string | null = null;
    try {
      await refreshAutoBindings(projectRoot);
    } catch (err) {
      refreshError = errorMessage(err);
      process.stderr.write(`[sync] 自动关联刷新失败,沿用上次派生结果:${refreshError}\n`);
    }

    // 5. 记尝试时间,构造上下文
    status.lastAttemptAt = now;
    setStatus(db, status, now);
    const supportsTaskKey = status.serverProtocolVersion === TASK_KEY_PROTOCOL_VERSION;
    let ctx: SyncContext;
    try {
      ctx = await createSyncContext(projectRoot, { supportsTaskKey });
    } catch (err) {
      if (!(err instanceof SyncError)) throw err;
      status.failingSince ??= now;
      status.lastError = err.message;
      return finish(null, { stoppedBy: 'failing', error: err.message });
    }

    const round: Round = {
      db,
      ctx,
      serverUrl: conn.serverUrl,
      token: conn.token,
      now,
      status,
      remaining: 0,
      sessionsSent: 0,
      recordsSent: 0,
      isolatedNew: 0,
      warnings: 0,
      isolated: new Set(),
      singleSessionSent: false,
    };

    // 6–9. 候选 → 构造 → 断言 → 分块装箱
    const chunks = await collectChunks(round);
    round.remaining = chunks.reduce((sum, c) => sum + c.recordCount, 0);
    const batches = packBatches(chunks, envelopeBytes(ctx));

    // 10. 逐批上报
    for (const batch of batches) {
      const stop = await sendBatch(round, batch);
      if (stop !== null) return finish(round, stop);
    }

    // 11. 全部成功;同步成功不代表派生刷新成功,保留该错误供 status 展示
    status.lastSuccessAt = now;
    status.failingSince = null;
    status.lastError = refreshError;
    return finish(round, null);
  } finally {
    dbConn.close();
    releaseLock(projectRoot);
  }
}

/** 已持锁时打开库;失败要释放锁再抛出。 */
function openSyncDbLocked(projectRoot: string): ReturnType<typeof openSyncDb> {
  try {
    return openSyncDb(projectRoot);
  } catch (err) {
    releaseLock(projectRoot);
    throw err;
  }
}

// ─── worker ─────────────────────────────────────────────────────────────────

/**
 * 本地活动标记:各会话最大事件 id 的最大值 + commit 事件数 + 接入时间。
 *
 * 含接入时间是为了让尾随中的旧 worker 在 connect(清空进度、写入新 connectedAt)后
 * 判定为有新活动,再跑一轮完成历史回传。
 */
async function activityMark(projectRoot: string): Promise<string> {
  let max = 0;
  for (const { maxId } of await listSessionEventMaxIds(projectRoot)) if (maxId > max) max = maxId;
  const commits = (await listCommitEvents(projectRoot)).length;
  return `${max}:${commits}:${readConnectedAt(projectRoot)}`;
}

/** 读 `sync_state` 连接的 connectedAt;无连接、无值或开库失败均为空串,不抛。 */
function readConnectedAt(projectRoot: string): string {
  try {
    const conn = openSyncDb(projectRoot);
    try {
      return getConnection(conn.getDb())?.connectedAt ?? '';
    } finally {
      conn.close();
    }
  } catch {
    return '';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 后台 worker:同步一轮后尾随等待,期间有新活动就再跑一轮。任何异常写 stderr,不抛出。 */
export async function runWorker(projectRoot: string): Promise<void> {
  try {
    if (!claimWorker(projectRoot)) return;
    try {
      for (;;) {
        const result = await runSync(projectRoot, 'background');
        if (result.stoppedBy !== null && result.stoppedBy !== 'busy') break;
        const mark = await activityMark(projectRoot);
        refreshWorker(projectRoot);
        await sleep(WORKER_TRAIL_MS);
        refreshWorker(projectRoot);
        if ((await activityMark(projectRoot)) === mark) break;
      }
    } finally {
      releaseWorker(projectRoot);
    }
  } catch (err) {
    process.stderr.write(`[sync] 后台同步异常:${errorMessage(err)}\n`);
  }
}
