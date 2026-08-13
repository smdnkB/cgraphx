/**
 * 存量碎片目录清理(spec:2026-08-13-timeline项目根回溯修复 §3.4)。
 *
 * 碎片签名(必须全部满足):`.cgraphx/` 目录内**仅有**
 * `timeline-current-turn.json` 一个条目 —— 无 `cgraphx.db`、无其他任何
 * 文件或子目录。这类目录是 cwd 漂移 bug 时代 hook 散落的空壳(记录在建
 * 库之前就失败,从未存过事件数据)。含 DB 或其他任何条目的 `.cgraphx/`
 * 是合法子项目根或用户数据,一律不碰。
 *
 * 清理幂等(删完再扫为空)、单个失败只报 stderr、绝不中断宿主命令。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** 扫描时跳过的目录名:重依赖/构建产物目录,碎片不可能在其中产生。 */
const SCAN_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
  'target',
  'vendor',
  '.venv',
]);

/** 判定 `.cgraphx/` 目录是否命中碎片签名:内部仅有 turn 文件一个条目。 */
function isDebrisDir(cgraphxDir: string): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(cgraphxDir, { withFileTypes: true });
  } catch {
    return false;
  }
  if (entries.length !== 1) return false;
  const only = entries[0]!;
  // 符号链接不算(isFile 为 false)—— 保守起见只认真实文件。
  return only.isFile() && only.name === 'timeline-current-turn.json';
}

/**
 * 从 projectRoot 递归扫描并删除命中签名的碎片 `.cgraphx/` 目录。
 *
 * 返回被删除的目录绝对路径列表。单个目录删除失败记 stderr 后继续;
 * 整体不可恢复的失败由调用方兜底(本函数自身不抛出)。不进入任何
 * `.cgraphx/` 内部扫描 —— 项目根与子项目根内部没有碎片可找。
 */
export function cleanDebrisCgraphxDirs(projectRoot: string): string[] {
  const removed: string[] = [];
  const queue: string[] = [path.resolve(projectRoot)];

  while (queue.length > 0) {
    const dir = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // 不可读目录:跳过,不中断
    }
    for (const entry of entries) {
      // 只沿真实目录下钻,不跟随符号链接(避免环)。
      if (!entry.isDirectory()) continue;
      if (entry.name === '.cgraphx') {
        const cgraphxDir = path.join(dir, entry.name);
        if (isDebrisDir(cgraphxDir)) {
          try {
            fs.rmSync(cgraphxDir, { recursive: true, force: true });
            removed.push(cgraphxDir);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            process.stderr.write(`[timeline] debris clean failed at ${cgraphxDir}: ${msg}\n`);
          }
        }
        continue; // 无论删与否,不进入 .cgraphx 内部
      }
      if (!SCAN_SKIP_DIRS.has(entry.name)) {
        queue.push(path.join(dir, entry.name));
      }
    }
  }

  return removed;
}
