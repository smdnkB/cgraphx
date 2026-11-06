/**
 * timeline 的总开关:`CGRAPHX_NO_TIMELINE` 设了(非空,且不是 '0'/'false')就不再采集。
 *
 * hook 时代从 hook-runner.ts 出;会话文件解析替代 hooks 后,补录管线(ingest)与重建也用它,
 * 独立成文件,不再挂在 hook 入口下面(hook-runner 整体删除见 spec 2026-11-06-会话文件解析替代hooks D19)。
 */

import { NO_TIMELINE_ENV } from './constants';

export function isKillSwitchOn(): boolean {
  const v = process.env[NO_TIMELINE_ENV];
  if (!v) return false;
  const trimmed = v.trim().toLowerCase();
  return trimmed !== '' && trimmed !== '0' && trimmed !== 'false';
}
