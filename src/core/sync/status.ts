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
import { countIsolatedSessions, emptyStatus, getConnection, getStatus, listSessions, type SyncSessionRow } from './store';
import { SyncError } from './errors';
import type { SyncStatusReport } from './types';
import { getClientVersion } from './version';

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
  };
  if (!isInitialized(projectRoot)) {
    if (cred !== null) report.connection = { serverUrl: cred.serverUrl, username: null, projectName: null, connectedAt: null };
    return report;
  }

  let rows: Map<string, SyncSessionRow>;
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
    report.isolatedSessions = countIsolatedSessions(db);
    rows = listSessions(db);
  } finally {
    conn.close();
  }

  // 取不到 origin 等导致上下文构造失败时,退化为不比较绑定段、不计终端会话
  let ctx: SyncContext | null = null;
  try {
    ctx = await createSyncContext(projectRoot);
  } catch (err) {
    if (!(err instanceof SyncError)) throw err;
  }
  const judge = ctx ?? { bindingsBySession: new Map(), clientVersion: getClientVersion() };

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
