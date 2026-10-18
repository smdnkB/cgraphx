/**
 * 本地同步状态报告(spec §7):是否接入、连接信息、同步状态、积压、隔离数。
 *
 * 只读:不取锁、不发请求、不写库。积压按 runSync 的候选判定口径计算。
 */

import { isInitialized } from '../directory';
import { listSessionEventMaxIds, listSessionEventsAfter } from '../timeline';
import { readConnection } from './connection';
import { buildTerminalPayload, createSyncContext, type SyncContext } from './payload';
import { isAgentCandidate, terminalNeedsSend } from './runner';
import { openSyncDb } from './schema-bootstrap';
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
import { SyncError } from './errors';
import type { SyncStatusReport } from './types';
import { getClientVersion, serverTier } from './version';

/** 本地同步状态。未初始化时除 `connected` 外均为空值。 */
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
  if (!isInitialized(projectRoot)) {
    if (cred !== null) report.connection = { serverUrl: cred.serverUrl, username: null, projectName: null, connectedAt: null };
    return report;
  }

  let rows: Map<string, SyncSessionRow>;
  let projectTypes: string[] | null = null;
  const conn = openSyncDb(projectRoot);
  try {
    const db = conn.getDb();
    if (cred !== null) {
      report.connection = getConnection(db) ?? {
        serverUrl: cred.serverUrl,
        username: null,
        projectName: null,
        connectedAt: null,
      };
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
  } finally {
    conn.close();
  }

  // 取不到 origin 等导致上下文构造失败时,退化为不比较绑定段、不计终端会话
  const tier = report.tier;
  let ctx: SyncContext | null = null;
  try {
    ctx = await createSyncContext(projectRoot, { tier, projectTypes });
  } catch (err) {
    if (!(err instanceof SyncError)) throw err;
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
  return report;
}
