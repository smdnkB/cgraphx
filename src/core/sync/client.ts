/**
 * 平台客户端(契约 v1,路径前缀 `/api/client/v1`)。
 *
 * 全局 fetch + AbortController 超时。非 2xx 解析错误体 `{ error, message, retryable }` → SyncPlatformError;
 * 网络失败 / 超时 → SyncNetworkError。错误消息不得包含 token 或密码。
 */

import { CLIENT_API_PREFIX, CLIENT_TIMEOUT_MS } from './constants';
import { SyncNetworkError, SyncPlatformError } from './errors';
import type { ClientStatus, ConnectRequest, ConnectResponse, IngestRequest, IngestResponse } from './types';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 非 2xx 响应 → SyncPlatformError。 */
function platformErrorFrom(status: number, text: string): SyncPlatformError {
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (isRecord(body) && typeof body.error === 'string' && body.error !== '') {
    const message = typeof body.message === 'string' && body.message !== '' ? body.message : body.error;
    const retryable = typeof body.retryable === 'boolean' ? body.retryable : status >= 500;
    return new SyncPlatformError(message, body.error, status, retryable);
  }
  if (status === 413) return new SyncPlatformError('请求体过大(HTTP 413)', 'payload_too_large', status, true);
  if (status >= 500) return new SyncPlatformError(`平台服务异常(HTTP ${status})`, 'internal_error', status, true);
  return new SyncPlatformError(`平台返回 HTTP ${status}`, `http_${status}`, status, false);
}

function invalidResponse(status: number, problem: string): SyncPlatformError {
  return new SyncPlatformError(`平台响应非法:${problem}`, 'invalid_response', status, false);
}

/**
 * 发一次请求并返回 2xx 的 JSON body(已解析)。
 *
 * @throws SyncNetworkError 网络失败 / 超时。
 * @throws SyncPlatformError 非 2xx,或 2xx 但 body 不是 JSON。
 */
async function requestJson(
  serverUrl: string,
  pathAndQuery: string,
  init: { method: 'GET' | 'POST'; token?: string; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  const url = serverUrl + CLIENT_API_PREFIX + pathAndQuery;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.token !== undefined) headers.Authorization = 'Bearer ' + init.token;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
    } catch (err) {
      // 只透出错误名 / 原因,不带请求头与请求体
      if ((err as Error)?.name === 'AbortError') {
        throw new SyncNetworkError(`请求平台超时(${CLIENT_TIMEOUT_MS / 1000} 秒)`);
      }
      const cause = (err as { cause?: { code?: unknown } })?.cause?.code;
      throw new SyncNetworkError(`请求平台失败${typeof cause === 'string' ? `(${cause})` : ''}`);
    }

    let text: string;
    try {
      text = await resp.text();
    } catch {
      throw new SyncNetworkError('读取平台响应失败');
    }
    if (!resp.ok) throw platformErrorFrom(resp.status, text);

    try {
      return { status: resp.status, body: JSON.parse(text) };
    } catch {
      throw invalidResponse(resp.status, '不是合法 JSON');
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `POST /connect`:用账号密码换取上报凭据。
 *
 * @throws SyncPlatformError 2xx 但缺 token / project.name 时 code='invalid_response'。
 */
export async function postConnect(serverUrl: string, body: ConnectRequest): Promise<ConnectResponse> {
  const { status, body: data } = await requestJson(serverUrl, '/connect', { method: 'POST', body });
  if (!isRecord(data)) throw invalidResponse(status, '顶层不是对象');
  const token = data.token;
  if (typeof token !== 'string' || token === '') throw invalidResponse(status, '缺少 token');
  const project = data.project;
  if (!isRecord(project) || typeof project.name !== 'string') throw invalidResponse(status, '缺少 project.name');
  const repo = isRecord(data.repo) ? data.repo : {};
  const response: ConnectResponse = {
    token,
    project: { id: typeof project.id === 'number' ? project.id : 0, name: project.name },
    repo: {
      id: typeof repo.id === 'number' ? repo.id : 0,
      defaultBranch: typeof repo.defaultBranch === 'string' ? repo.defaultBranch : '',
    },
  };
  if (typeof data.protocolVersion === 'string') response.protocolVersion = data.protocolVersion;
  return response;
}

/** `GET /status?remoteUrl=`:平台视角的接入状态(也用于探测凭据是否可用)。 */
export async function getStatus(serverUrl: string, token: string, remoteUrl: string): Promise<ClientStatus> {
  const { status, body: data } = await requestJson(
    serverUrl,
    `/status?remoteUrl=${encodeURIComponent(remoteUrl)}`,
    { method: 'GET', token },
  );
  if (!isRecord(data)) throw invalidResponse(status, '顶层不是对象');
  return {
    lastSyncAt: typeof data.lastSyncAt === 'string' ? data.lastSyncAt : null,
    backlog: typeof data.backlog === 'number' ? data.backlog : null,
  };
}

/** `POST /ingest`:上报一批会话。 */
export async function postIngest(serverUrl: string, token: string, body: IngestRequest): Promise<IngestResponse> {
  const { status, body: data } = await requestJson(serverUrl, '/ingest', { method: 'POST', token, body });
  if (!isRecord(data) || !isRecord(data.accepted)) throw invalidResponse(status, '缺少 accepted');
  const a = data.accepted;
  const num = (x: unknown): number => (typeof x === 'number' ? x : 0);
  const warnings = Array.isArray(data.warnings) ? (data.warnings as IngestResponse['warnings']) : [];
  const response: IngestResponse = {
    accepted: {
      events: num(a.events),
      bindings: num(a.bindings),
      commits: num(a.commits),
      artifacts: num(a.artifacts),
      references: num(a.references),
    },
    warnings,
  };
  if (Array.isArray(data.taskKeys)) {
    const taskKeys: Array<{ taskKey: string; taskId: string }> = [];
    for (const item of data.taskKeys) {
      if (!isRecord(item) || typeof item.taskKey !== 'string' || typeof item.taskId !== 'string') continue;
      taskKeys.push({ taskKey: item.taskKey, taskId: item.taskId });
    }
    response.taskKeys = taskKeys;
  }
  if (typeof data.protocolVersion === 'string') response.protocolVersion = data.protocolVersion;
  return response;
}
