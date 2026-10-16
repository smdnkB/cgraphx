/**
 * 拉起后台同步进程(`cgraphx sync-worker`),立即返回、不等待。
 */

import { spawn } from 'node:child_process';

/** 拉起 detached worker;任何异常返回 false。 */
export function spawnSyncWorker(projectRoot: string): boolean {
  try {
    const script = process.argv[1];
    if (script === undefined) return false;
    const child = spawn(process.execPath, [script, 'sync-worker', '--project', projectRoot], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', () => {
      // 拉起失败静默:下次 hook 触发再试
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
