/**
 * 版本:本地 cgraphx 版本号(上报的 clientVersion)与服务端协议版本比较。
 *
 * 读包根 package.json:`src/core/sync/` 与 `dist/core/sync/` 上溯三级都是包根。
 * 不得 import `src/cli`(分层约束)。
 */

import fs from 'node:fs';
import path from 'node:path';

import { ARTIFACT_TASK_KEY_PROTOCOL_VERSION, PROJECT_SPEC_PROTOCOL_VERSION, TASK_KEY_PROTOCOL_VERSION } from './types';

/** 服务端协议档位(spec §11.1):按「主.次」数值向下归类。 */
export type ServerTier = '1.0' | '1.1' | '1.2' | '1.3';

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

/** 取开头的「主.次」两段;不是这个形状返回 null。 */
function parseMajorMinor(version: string): { major: number; minor: number } | null {
  const m = /^(\d+)\.(\d+)(?:\.|$)/.exec(version);
  if (m === null) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}

/**
 * 服务端协议版本是否不低于 `min`:按「主.次」数值比较,不按字符串比较(如 1.10 > 1.2)。
 * 版本缺失(旧服务端不返回)或格式不合法按不支持处理。
 */
export function protocolAtLeast(version: string | null, min: string): boolean {
  if (version === null) return false;
  const v = parseMajorMinor(version);
  const m = parseMajorMinor(min);
  if (v === null || m === null) return false;
  return v.major !== m.major ? v.major > m.major : v.minor >= m.minor;
}

/**
 * 服务端协议版本 → 档位:≥ '1.3' → '1.3';≥ '1.2' → '1.2';≥ '1.1' → '1.1';
 * 其余(含 null、不合法)按 '1.0'。
 */
export function serverTier(version: string | null): ServerTier {
  if (protocolAtLeast(version, PROJECT_SPEC_PROTOCOL_VERSION)) return '1.3';
  if (protocolAtLeast(version, ARTIFACT_TASK_KEY_PROTOCOL_VERSION)) return '1.2';
  if (protocolAtLeast(version, TASK_KEY_PROTOCOL_VERSION)) return '1.1';
  return '1.0';
}
