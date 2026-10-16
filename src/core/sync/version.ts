/**
 * 本地 cgraphx 版本号(上报的 clientVersion)。
 *
 * 读包根 package.json:`src/core/sync/` 与 `dist/core/sync/` 上溯三级都是包根。
 * 不得 import `src/cli`(分层约束)。
 */

import fs from 'node:fs';
import path from 'node:path';

let cached: string | null = null;

export function getClientVersion(): string {
  if (cached !== null) return cached;
  let version = 'unknown';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf-8')) as {
      version?: unknown;
    };
    if (typeof pkg.version === 'string' && pkg.version !== '') version = pkg.version;
  } catch {
    // 读不到按 unknown 上报,不阻塞
  }
  cached = version;
  return version;
}
