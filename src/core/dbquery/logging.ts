/**
 * Query history log for the db-query subsystem (spec §2.6).
 *
 * 每次查询(成功、失败、安全拒绝、超时、禁用)往数据位置里的 db-query.log 追加一行 JSONL;
 * 文件到 10 MB 轮转,留 5 个历史文件。拿不到数据位置或目录不在时不记。
 *
 * Write failures NEVER block the query — they emit one stderr warning and
 * continue (spec §2.6 写入语义).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { LOG_FILENAME, LOG_MAX_BYTES, LOG_KEEP_FILES } from './constants';
import type { QueryLogRecord } from './types';
import { getDataDir } from '../data-location';

const POSIX = process.platform !== 'win32';

/** 查询日志在数据位置里;拿不到数据位置 → null。只读:不建目录、不写并过记号。 */
function logPath(projectRoot: string): string | null {
  const dataDir = getDataDir(projectRoot);
  return dataDir === null ? null : path.join(dataDir, LOG_FILENAME);
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Rotate the log file if it exceeds LOG_MAX_BYTES.
 * Renames .log → .log.1, .log.1 → .log.2, ... drops the oldest.
 * Failures here are swallowed (best-effort).
 */
function rotateIfNeeded(filePath: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return; // file doesn't exist — nothing to rotate
  }
  if (stat.size < LOG_MAX_BYTES) return;

  // Drop the oldest, shift each older file up by one.
  const oldest = `${filePath}.${LOG_KEEP_FILES - 1}`;
  try {
    if (fs.existsSync(oldest)) fs.rmSync(oldest, { force: true });
  } catch {
    /* ignore */
  }
  for (let i = LOG_KEEP_FILES - 2; i >= 1; i--) {
    const from = `${filePath}.${i}`;
    const to = `${filePath}.${i + 1}`;
    try {
      if (fs.existsSync(from)) fs.renameSync(from, to);
    } catch {
      /* ignore */
    }
  }
  // Move current → .log.1
  try {
    fs.renameSync(filePath, `${filePath}.1`);
  } catch {
    /* ignore — best-effort */
  }
}

/**
 * Append a single record as one JSON line.
 *
 * Spec §2.6:
 *   - file path: 数据位置里的 db-query.log
 *   - format: JSONL (one record per line)
 *   - file mode: 0600 (POSIX only)
 *   - failures do not throw; one stderr warning per failure
 */
export function logQuery(projectRoot: string, record: QueryLogRecord): void {
  // 拿不到数据位置或目录不在:不建目录、不写、不报错(项目目录只由写数据的入口建,记日志不另建)
  const filePath = logPath(projectRoot);
  if (filePath === null || !isDirectory(path.dirname(filePath))) return;

  rotateIfNeeded(filePath);

  const line = JSON.stringify(record) + '\n';
  let fd: number | undefined;
  try {
    // mode 0o600 applies only when the file is created; existing files
    // retain their current mode. On Windows the mode is effectively ignored.
    fd = fs.openSync(filePath, 'a', POSIX ? 0o600 : 0o644);
    fs.writeFileSync(fd, line);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // One warning, then move on. Spec §2.6: write failure does not block.
    process.stderr.write(
      `[cgraphx db-query] failed to write log to ${filePath}: ${msg}\n`,
    );
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore close errors */
      }
    }
  }
}
