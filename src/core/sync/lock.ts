/**
 * 两个标记文件(语义分开):
 *   - 同步互斥锁 `.cgraphx/sync.lock`:只在一次 runSync 期间持有,让前台 `sync now` 与后台互斥;
 *   - worker 存活标记 `.cgraphx/sync-worker.pid`:worker 整个生命周期(含尾随睡眠)持有,保证同仓库最多 1 个 worker。
 *
 * 两者都用 `wx` 独占创建,内容 `{"pid":…,"startedAt":…}`;pid 不存活或 mtime 超过 LOCK_STALE_MS 视为陈旧,删除后接管。
 */

import fs from 'node:fs';
import path from 'node:path';

import { getCodeGraphDir } from '../directory';
import { LOCK_FILENAME, LOCK_STALE_MS, WORKER_PID_FILENAME } from './constants';

const RETRY_INTERVAL_MS = 1000;

function markerPath(projectRoot: string, filename: string): string {
  return path.join(getCodeGraphDir(projectRoot), filename);
}

/** 读标记文件里的 pid;读不到 / 内容非法返回 null。 */
function readPid(file: string): number | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as { pid?: unknown };
    return typeof raw.pid === 'number' && Number.isInteger(raw.pid) && raw.pid > 0 ? raw.pid : null;
  } catch {
    return null;
  }
}

/** pid 是否存活(EPERM 表示存在但无权发信号,算存活)。 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function isFresh(file: string): boolean {
  try {
    return Date.now() - fs.statSync(file).mtimeMs <= LOCK_STALE_MS;
  } catch {
    return false;
  }
}

/** 已存在的标记是否陈旧:pid 不存活,或 mtime 超时。pid 读不到时只看 mtime(可能正被另一进程写入)。 */
function isStale(file: string): boolean {
  if (!isFresh(file)) return true;
  const pid = readPid(file);
  return pid !== null && !isPidAlive(pid);
}

function tryCreate(file: string): boolean {
  try {
    const fd = fs.openSync(file, 'wx');
    try {
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}

/** 独占创建一次;已存在且陈旧 → 删除后重试一次。 */
function claimOnce(file: string): boolean {
  if (tryCreate(file)) return true;
  if (!isStale(file)) return false;
  try {
    fs.unlinkSync(file);
  } catch {
    // 被别的进程抢先删除 / 接管:按重试结果为准
  }
  return tryCreate(file);
}

/** 只删内容为本进程 pid 的标记。 */
function releaseOwn(file: string): void {
  try {
    if (readPid(file) === process.pid) fs.unlinkSync(file);
  } catch {
    // 释放失败静默:陈旧判定兜底
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ─── 同步互斥锁 ─────────────────────────────────────────────────────────────

/** 取同步锁;`waitMs > 0` 时每 1 秒重试直到超时。 */
export function acquireLock(projectRoot: string, waitMs: number): boolean {
  const file = markerPath(projectRoot, LOCK_FILENAME);
  const deadline = Date.now() + Math.max(0, waitMs);
  for (;;) {
    if (claimOnce(file)) return true;
    const left = deadline - Date.now();
    if (left <= 0) return false;
    sleepSync(Math.min(RETRY_INTERVAL_MS, left));
  }
}

/** 释放同步锁(只删本进程持有的)。 */
export function releaseLock(projectRoot: string): void {
  releaseOwn(markerPath(projectRoot, LOCK_FILENAME));
}

// ─── worker 存活标记 ────────────────────────────────────────────────────────

/** 认领 worker 身份;已有存活 worker 返回 false(调用方直接退出)。 */
export function claimWorker(projectRoot: string): boolean {
  return claimOnce(markerPath(projectRoot, WORKER_PID_FILENAME));
}

/** 刷新存活标记的 mtime,防止尾随睡眠期间被判陈旧。 */
export function refreshWorker(projectRoot: string): void {
  try {
    const now = new Date();
    fs.utimesSync(markerPath(projectRoot, WORKER_PID_FILENAME), now, now);
  } catch {
    // 刷新失败静默
  }
}

/** 释放 worker 身份(只删本进程的)。 */
export function releaseWorker(projectRoot: string): void {
  releaseOwn(markerPath(projectRoot, WORKER_PID_FILENAME));
}

/** 是否有存活 worker:标记存在 + pid 存活 + mtime 未超 LOCK_STALE_MS。 */
export function isWorkerAlive(projectRoot: string): boolean {
  const file = markerPath(projectRoot, WORKER_PID_FILENAME);
  if (!isFresh(file)) return false;
  const pid = readPid(file);
  return pid !== null && isPidAlive(pid);
}
