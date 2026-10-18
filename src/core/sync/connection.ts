/**
 * 接入 / 断开平台,读取本地凭据,记录精确参考(spec §3.1–§3.2、§6「本地凭据」)。
 *
 * 凭据只存在 `.cgraphx/task-source.json`(经 task 门面读写);`sync_state.connection` 不存 token。
 * 密码只在本次接入请求里使用,不落盘。
 */

import { resolveSessionIdFromEnv } from '../agents';
import { isInitialized } from '../directory';
import { TaskConfigError, loadTaskSourceConfig, removeTaskSourceConfig, writeTaskSourceConfig } from '../task';
import { getStatus, postConnect } from './client';
import { CLIENT_NAME, FOREGROUND_LOCK_WAIT_MS, TASKS_PATH_SUFFIX } from './constants';
import { SyncArgError, SyncBusyError, SyncNotInitializedError, SyncPlatformError } from './errors';
import { acquireLock, releaseLock } from './lock';
import { getOriginUrl } from './git';
import { openSyncDb } from './schema-bootstrap';
import {
  clearConnectionState,
  clearSessions,
  emptyStatus,
  getConnection,
  insertReferenceRecord,
  setConnection,
  setStatus,
} from './store';
import type { ConnectInput, ConnectOutcome, ReferenceHit, SyncConnection } from './types';
import { getClientVersion } from './version';

const BEARER_PREFIX = 'Bearer ';

/**
 * 读本地凭据。满足「url 以 /api/client/v1/tasks 结尾 + Authorization 以 Bearer 开头」才返回;
 * 配置不存在或非法返回 null。
 */
export function readConnection(projectRoot: string): { serverUrl: string; token: string } | null {
  let config;
  try {
    config = loadTaskSourceConfig(projectRoot);
  } catch (err) {
    if (err instanceof TaskConfigError) return null;
    throw err;
  }
  if (config === null) return null;
  const auth = config.headers.Authorization;
  if (!config.url.endsWith(TASKS_PATH_SUFFIX)) return null;
  if (typeof auth !== 'string' || !auth.startsWith(BEARER_PREFIX)) return null;
  return {
    serverUrl: config.url.slice(0, -TASKS_PATH_SUFFIX.length),
    token: auth.slice(BEARER_PREFIX.length),
  };
}

/** 平台地址归一:trim + 去尾部 `/`。 */
function trimServerUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/** 读 store 里的连接信息(只用于展示)。 */
function readStoredConnection(projectRoot: string): SyncConnection | null {
  const conn = openSyncDb(projectRoot);
  try {
    return getConnection(conn.getDb());
  } finally {
    conn.close();
  }
}

/**
 * 接入平台。步骤顺序固定(见 plan T-2「connectPlatform 流程」)。
 *
 * @throws SyncNotInitializedError 项目未初始化。
 * @throws SyncArgError 无 origin / 换平台未加 --force / 缺 --server / 地址非法 / 缺 --user / 密码为空。
 * @throws SyncPlatformError 平台拒绝或响应非法。
 * @throws SyncNetworkError 网络失败 / 超时。
 */
export async function connectPlatform(projectRoot: string, input: ConnectInput): Promise<ConnectOutcome> {
  // 1
  if (!isInitialized(projectRoot)) {
    throw new SyncNotInitializedError(`cgraphx 未在 ${projectRoot} 初始化,请先运行 \`cgraphx install\``);
  }
  // 2
  const remoteUrl = getOriginUrl(projectRoot);
  if (remoteUrl === null) {
    throw new SyncArgError('本仓库没有 origin 远程地址,无法匹配平台项目');
  }
  // 3
  const existing = readConnection(projectRoot);
  // 4
  if (!input.force && existing) {
    if (input.serverUrl !== undefined && trimServerUrl(input.serverUrl) !== existing.serverUrl) {
      throw new SyncArgError(`已接入 ${existing.serverUrl},换平台请加 --force`);
    }
    try {
      await getStatus(existing.serverUrl, existing.token, remoteUrl);
      const stored = readStoredConnection(projectRoot);
      return {
        kind: 'already',
        connection: stored ?? { serverUrl: existing.serverUrl, username: null, projectName: null, connectedAt: null },
      };
    } catch (err) {
      // 凭据已失效(invalid_token)→ 进入第 5 步重新接入;其它错误原样抛出
      if (!(err instanceof SyncPlatformError && err.code === 'invalid_token')) throw err;
    }
  }
  // 5
  const rawServer = input.serverUrl ?? existing?.serverUrl;
  if (rawServer === undefined || rawServer.trim() === '') {
    throw new SyncArgError('缺少 --server');
  }
  const serverUrl = trimServerUrl(rawServer);
  if (!/^https?:\/\//.test(serverUrl)) {
    throw new SyncArgError(`平台地址须以 http:// 或 https:// 开头:${serverUrl}`);
  }
  const username = input.username?.trim();
  if (username === undefined || username === '') {
    throw new SyncArgError('缺少 --user');
  }
  // 6
  const password = await input.readPassword();
  if (password === '') {
    throw new SyncArgError('密码为空,请重新输入');
  }
  // 7–9 持同步锁执行:防止运行中的同步在清空 sync_sessions 之后写回旧账号的确认进度,
  // 导致部分会话不再向新账号回传。拿不到锁就在签发凭据之前放弃,不留半成品。
  if (!acquireLock(projectRoot, FOREGROUND_LOCK_WAIT_MS)) {
    throw new SyncBusyError('后台同步正在进行,稍后再试');
  }
  try {
    return await connectLocked(projectRoot, serverUrl, username, password, remoteUrl, existing !== null);
  } finally {
    releaseLock(projectRoot);
  }
}

async function connectLocked(
  projectRoot: string,
  serverUrl: string,
  username: string,
  password: string,
  remoteUrl: string,
  replacedExisting: boolean,
): Promise<ConnectOutcome> {
  // 7
  const resp = await postConnect(serverUrl, {
    username,
    password,
    remoteUrl,
    clientName: CLIENT_NAME,
    clientVersion: getClientVersion(),
  });
  // 8
  writeTaskSourceConfig(projectRoot, {
    url: serverUrl + TASKS_PATH_SUFFIX,
    headers: { Authorization: BEARER_PREFIX + resp.token },
  });
  // 9
  const now = new Date().toISOString();
  const connection: SyncConnection = { serverUrl, username, projectName: resp.project.name, connectedAt: now };
  const conn = openSyncDb(projectRoot);
  try {
    const db = conn.getDb();
    db.transaction(() => {
      setConnection(db, connection, now);
      setStatus(db, { ...emptyStatus(), serverProtocolVersion: resp.protocolVersion ?? null }, now);
      clearSessions(db); // 重新回传全部历史(spec §3.2 / §4.3)
    })();
  } finally {
    conn.close();
  }
  // 10
  return { kind: 'connected', connection, replacedExisting };
}

/**
 * 断开平台:删除任务源配置 + `sync_state` 的 connection / status 两键(库未初始化则跳过)。
 * 不删 `sync_sessions`、`sync_reference_records`。返回是否删除了配置文件。
 */
export function disconnectPlatform(projectRoot: string): boolean {
  const removed = removeTaskSourceConfig(projectRoot);
  if (isInitialized(projectRoot)) {
    const conn = openSyncDb(projectRoot);
    try {
      clearConnectionState(conn.getDb());
    } finally {
      conn.close();
    }
  }
  return removed;
}

/** 记录一条精确参考。绝不抛错、绝不输出。 */
export function recordReferenceHit(projectRoot: string, hit: ReferenceHit): void {
  try {
    const sessionId = hit.sessionId ?? resolveSessionIdFromEnv()?.sessionId;
    if (!sessionId) return;
    if (!isInitialized(projectRoot)) return;
    if (!hit.value) return;
    const conn = openSyncDb(projectRoot);
    try {
      insertReferenceRecord(conn.getDb(), {
        sessionId,
        kind: hit.kind,
        value: hit.value,
        ts: new Date().toISOString(),
      });
    } finally {
      conn.close();
    }
  } catch {
    // 精确参考是尽力而为,失败静默
  }
}
