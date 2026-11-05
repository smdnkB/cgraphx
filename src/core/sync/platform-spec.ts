/**
 * 本项目类型表缓存(spec §11.1、§11.3):档位 ≥ 1.3 时每轮同步前经 `/spec` 刷新,构造上下文时读取。
 *
 * 拉取失败(404、网络错误、任何错误码、响应不合法)按默认类型表上报:不暂停、不计为同步失败,
 * 缓存保持原样;读取时数据位置的库不在 / 无缓存 / 任何异常一律返回 null,绝不阻塞同步。读取只读打开,
 * 不建目录、不应用 schema。
 */

import fs from 'node:fs';

import { getDatabasePath, type SqliteDatabase } from '../db';
import { getSpec } from './client';
import { openSyncDbForRead } from './schema-bootstrap';
import { getPlatformSpec, setPlatformSpec } from './store';

/** 读缓存的本项目产物类型标识;数据位置的库不在 / 库里没有 sync 的表 / 无缓存 / 任何异常 → null。 */
export function readCachedProjectArtifactTypes(projectRoot: string): string[] | null {
  try {
    const dbPath = getDatabasePath(projectRoot);
    if (dbPath === null || !fs.existsSync(dbPath)) return null;
    const conn = openSyncDbForRead(projectRoot);
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
