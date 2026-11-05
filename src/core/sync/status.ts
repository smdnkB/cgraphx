/**
 * 本地同步状态报告(spec §7):是否接入、连接信息(含上报地址)、同步状态、积压、隔离数。
 *
 * 只读:不取锁、不发请求、不写库;库只读打开,不建目录、不应用 schema。积压按 runSync 的候选判定口径计算,
 * 上报地址同 runSync(连接里存的,旧连接没存的取当前根的 origin,只用不存)。
 */

import fs from 'node:fs';

import { getDatabasePath } from '../db';
import { listSessionEventMaxIds, listSessionEventsAfter } from '../timeline';
import { readConnection } from './connection';
import { buildReplicaSessionPayloads, buildTerminalPayload, createSyncContext, type SyncContext } from './payload';
import { isAgentCandidate, resolveReportRemoteUrl, terminalNeedsSend } from './runner';
import { openSyncDbForRead } from './schema-bootstrap';
import {
  countIsolatedSessions,
  emptyStatus,
  getConnection,
  getLastWarnings,
  getPlatformSpec,
  getStatus,
  listSessions,
  summarizeUnreported,
  type SyncSessionRow,
} from './store';
import { SyncError, SyncNotInitializedError } from './errors';
import type { SyncConnection, SyncStatusReport } from './types';
import { getClientVersion, serverTier } from './version';

/** 只有本地凭据、库里没有连接信息时报告里的连接。 */
function credentialOnlyConnection(serverUrl: string): SyncConnection {
  return { serverUrl, username: null, projectName: null, connectedAt: null, remoteUrl: null };
}

/** 本地同步状态。数据位置的库不在(或库里还没有 sync 的表)时除 `connected` 外均为空值。 */
export async function getSyncStatus(projectRoot: string): Promise<SyncStatusReport> {
  const cred = readConnection(projectRoot);
  const report: SyncStatusReport = {
    connected: cred !== null,
    connection: null,
    state: emptyStatus(),
    backlogEvents: 0,
    pendingSessions: 0,
    isolatedSessions: 0,
    tier: '1.0',
    platformSpec: null,
    lastWarnings: null,
    unreported: [],
  };
  const notInitializedReport = (): SyncStatusReport => {
    if (cred !== null) report.connection = credentialOnlyConnection(cred.serverUrl);
    return report;
  };
  const dbPath = getDatabasePath(projectRoot);
  if (dbPath === null || !fs.existsSync(dbPath)) return notInitializedReport();

  let conn: ReturnType<typeof openSyncDbForRead>;
  try {
    conn = openSyncDbForRead(projectRoot);
  } catch (err) {
    // 库在、sync 的表还没建(还没接入过):同库不在
    if (err instanceof SyncNotInitializedError) return notInitializedReport();
    throw err;
  }

  let rows: Map<string, SyncSessionRow>;
  let projectTypes: string[] | null = null;
  let remoteUrl: string | null;
  try {
    const db = conn.getDb();
    if (cred !== null) {
      report.connection = getConnection(db) ?? credentialOnlyConnection(cred.serverUrl);
    }
    report.state = getStatus(db);
    report.tier = serverTier(report.state.serverProtocolVersion);
    const spec = getPlatformSpec(db);
    if (spec !== null) {
      projectTypes = spec.artifactTypes.map((type) => type.key);
      if (report.tier === '1.3') {
        report.platformSpec = { typeCount: spec.artifactTypes.length, fetchedAt: spec.fetchedAt };
      }
    }
    report.lastWarnings = getLastWarnings(db);
    report.unreported = summarizeUnreported(db);
    report.isolatedSessions = countIsolatedSessions(db);
    rows = listSessions(db);
    remoteUrl = resolveReportRemoteUrl(db, projectRoot, { save: false });
  } finally {
    conn.close();
  }

  // 取不到上报地址、或上下文构造失败时,退化为不比较绑定段、不计终端会话
  const tier = report.tier;
  let ctx: SyncContext | null = null;
  if (remoteUrl !== null) {
    try {
      ctx = await createSyncContext(projectRoot, { remoteUrl, tier, projectTypes });
    } catch (err) {
      if (!(err instanceof SyncError)) throw err;
    }
  }
  // 重新评估只影响同步收尾的补报;status 的待上报会话数不计入「仅因重新评估」进候选的会话
  const judge = ctx ?? {
    bindingsBySession: new Map(),
    clientVersion: getClientVersion(),
    supportsTaskKey: tier !== '1.0',
    reevaluateAll: false,
  };

  for (const { sessionId, maxId } of await listSessionEventMaxIds(projectRoot)) {
    const row = rows.get(sessionId);
    if (!isAgentCandidate(judge, sessionId, maxId, row)) continue;
    report.pendingSessions++;
    report.backlogEvents += (await listSessionEventsAfter(projectRoot, sessionId, row?.last_event_id ?? 0)).length;
  }
  if (ctx !== null && terminalNeedsSend(buildTerminalPayload(ctx), rows, ctx.clientVersion)) {
    report.pendingSessions++;
  }
  // 副本里没对上会话的提交,每个副本一个会话(spec D28),判断同 runner 的发送口径
  if (ctx !== null) {
    for (const replica of buildReplicaSessionPayloads(ctx)) {
      if (terminalNeedsSend(replica, rows, ctx.clientVersion)) report.pendingSessions++;
    }
  }
  return report;
}
