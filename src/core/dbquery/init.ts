/**
 * 在数据位置里生成 db-profiles.json 模板(并过的目录在 ~/.cgraphx/projects/<目录名>/,没并过的在 .cgraphx/)。
 *
 * Writes a starter file with two example profiles (MySQL + PostgreSQL)
 * containing placeholder credentials the user edits in place. Mode 0600
 * on POSIX because the file may hold real passwords once filled in.
 *
 * Idempotent: by default, refuses to overwrite an existing file; pass
 * `--force` to clobber.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { PROFILES_FILENAME } from './constants';
import { ensureDataDir, locateData, missingDataMessage } from '../data-location';

const POSIX = process.platform !== 'win32';

export interface InitReport {
  projectRoot: string;
  filePath: string;
  action: 'created' | 'already-exists' | 'overwritten';
}

/** The template content. Uses placeholder passwords so the user knows to fill. */
export function templateProfilesContent(): string {
  const obj = {
    enabled: true,
    default: 'example-mysql',
    'example-mysql': {
      description: '示例 MySQL 配置 — 改成实际值后重命名 profile',
      type: 'mysql',
      host: 'localhost',
      port: 3306,
      user: 'readonly_user',
      password: 'CHANGE_ME',
      database: 'your_database',
    },
    'example-postgres': {
      description: '示例 PostgreSQL 配置 — 改成实际值后重命名 profile',
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      user: 'readonly_user',
      password: 'CHANGE_ME',
      database: 'your_database',
      schema: 'public',
    },
    'example-http': {
      description: '示例 HTTP 配置 — 经只读查询接口访问无法直连的库(如生产)',
      type: 'http',
      url: 'http://127.0.0.1:8080/workflow/dbquery',
      headers: { Authorization: 'Bearer CHANGE_ME' },
      schema: 'public',
    },
  };
  return JSON.stringify(obj, null, 2) + '\n';
}

/**
 * Write the db-profiles.json template.
 *
 * @param projectRoot  项目根或起点(按数据位置的规则认根)
 * @param opts.force   Overwrite an existing file. Default false.
 *
 * Behavior:
 *   - 拿不到数据位置 → throws
 *   - File exists + !force → returns action='already-exists', no write
 *   - File exists + force  → action='overwritten'
 *   - File absent          → action='created'
 */
export function initDbProfiles(projectRoot: string, opts: { force?: boolean } = {}): InitReport {
  const resolved = path.resolve(projectRoot);
  // 连接配置写进数据位置(写数据的入口,与 config.ts 读取同一路径):旧库模式在本地 .cgraphx/;
  // 项目库模式在项目目录,根装过而项目目录不在时就建
  const dataDir = ensureDataDir(resolved);
  if (dataDir === null) {
    throw new Error(missingDataMessage(locateData(resolved)));
  }

  const filePath = path.join(dataDir, PROFILES_FILENAME);
  const exists = fs.existsSync(filePath);

  if (exists && !opts.force) {
    return {
      projectRoot: resolved,
      filePath,
      action: 'already-exists',
    };
  }

  fs.writeFileSync(filePath, templateProfilesContent(), {
    encoding: 'utf8',
    mode: POSIX ? 0o600 : 0o644,
  });
  // Re-chmod: writeFileSync's `mode` only applies on file *creation*; on a
  // --force overwrite of an existing file the existing mode is kept. Force
  // 0600 so a previously loose mode (e.g. 0644) gets tightened.
  if (POSIX) {
    try { fs.chmodSync(filePath, 0o600); } catch { /* non-fatal */ }
  }

  return {
    projectRoot: resolved,
    filePath,
    action: exists && opts.force ? 'overwritten' : 'created',
  };
}
