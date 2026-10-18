/**
 * 本项目类型表缓存(spec §11.1、§11.3):档位 ≥ 1.3 时每轮同步前经 `/spec` 刷新,构造上下文时读取。
 *
 * 拉取失败(404、网络错误、任何错误码、响应不合法)按默认类型表上报:不暂停、不计为同步失败,
 * 缓存保持原样;读取未初始化 / 无缓存 / 任何异常一律返回 null,绝不阻塞同步。
 */

import type { SqliteDatabase } from '../db';
import { isInitialized } from '../directory';
import { getSpec } from './client';
import { openSyncDb } from './schema-bootstrap';
import { getPlatformSpec, setPlatformSpec } from './store';

/** 读缓存的本项目产物类型标识;未初始化 / 无缓存 / 任何异常 → null。 */
export function readCachedProjectArtifactTypes(projectRoot: string): string[] | null {
  if (!isInitialized(projectRoot)) return null;
  try {
    const conn = openSyncDb(projectRoot);
    try {
      const cache = getPlatformSpec(conn.getDb());
      return cache === null ? null : cache.artifactTypes.map((type) => type.key);
    } finally {
      conn.close();
    }
  } catch {
    return null;
  }
}

/**
 * 拉取并缓存本项目类型表,返回各项类型标识;任何异常 → 写 stderr、缓存不动、返回 null。
 * 调用方按 null 处理为「本轮按默认类型表上报」,不暂停、不计为同步失败。
 */
export async function refreshPlatformSpec(
  db: SqliteDatabase,
  serverUrl: string,
  token: string,
  remoteUrl: string,
  now: string,
): Promise<string[] | null> {
  try {
    const spec = await getSpec(serverUrl, token, remoteUrl);
    setPlatformSpec(db, { fetchedAt: now, artifactTypes: spec.artifactTypes }, now);
    return spec.artifactTypes.map((type) => type.key);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[sync] 拉取本项目产物类型表失败,本轮按默认类型表上报:${message}\n`);
    return null;
  }
}
