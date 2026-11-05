/**
 * 两个标记文件(语义分开):
 *   - 同步互斥锁 `sync.lock`:只在一次 runSync 期间持有,让前台 `sync now` 与后台互斥;
 *   - worker 存活标记 `sync-worker.pid`:worker 整个生命周期(含尾随睡眠)持有,保证同一项目最多 1 个 worker。
 *
 * 两者都在数据位置:并过的目录在用户目录的项目目录里,同一项目的各个目录共用一把锁、一个 worker(spec D13)。
 * 都用 `wx` 独占创建,内容 `{"pid":…,"startedAt":…}`;pid 不存活或 mtime 超过 LOCK_STALE_MS 视为陈旧,删除后接管。
 * 只在已在的数据目录里创建,不建目录(全局约束 3):数据位置拿不到时取锁、认领 worker 返回 false,
 * isWorkerAlive 返回 false,释放、刷新什么都不做。
 */

import fs from 'node:fs';
import path from 'node:path';

import { getDataDir } from '../data-location';
import { LOCK_FILENAME, LOCK_STALE_MS, WORKER_PID_FILENAME } from './constants';

const RETRY_INTERVAL_MS = 1000;

/** 标记文件路径:数据目录下的 filename;数据位置拿不到 → null。 */
function markerPath(projectRoot: string, filename: string): string | null {
  const dir = getDataDir(projectRoot);
  return dir === null ? null : path.join(dir, filename);
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

/** 取同步锁;`waitMs > 0` 时每 1 秒重试直到超时。数据位置拿不到 → false。 */
export function acquireLock(projectRoot: string, waitMs: number): boolean {
  const file = markerPath(projectRoot, LOCK_FILENAME);
  if (file === null) return false;
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
  const file = markerPath(projectRoot, LOCK_FILENAME);
  if (file !== null) releaseOwn(file);
}

// ─── worker 存活标记 ────────────────────────────────────────────────────────

/** 认领 worker 身份;已有存活 worker、数据位置拿不到返回 false(调用方直接退出)。 */
export function claimWorker(projectRoot: string): boolean {
  const file = markerPath(projectRoot, WORKER_PID_FILENAME);
  return file !== null && claimOnce(file);
}

/** 刷新存活标记的 mtime,防止尾随睡眠期间被判陈旧。 */
export function refreshWorker(projectRoot: string): void {
  try {
    const file = markerPath(projectRoot, WORKER_PID_FILENAME);
    if (file === null) return;
    const now = new Date();
    fs.utimesSync(file, now, now);
  } catch {
    // 刷新失败静默
  }
}

/** 释放 worker 身份(只删本进程的)。 */
export function releaseWorker(projectRoot: string): void {
  const file = markerPath(projectRoot, WORKER_PID_FILENAME);
  if (file !== null) releaseOwn(file);
}

/** 是否有存活 worker:标记存在 + pid 存活 + mtime 未超 LOCK_STALE_MS;数据位置拿不到 → false。 */
export function isWorkerAlive(projectRoot: string): boolean {
  const file = markerPath(projectRoot, WORKER_PID_FILENAME);
  if (file === null) return false;
  if (!isFresh(file)) return false;
  const pid = readPid(file);
  return pid !== null && isPidAlive(pid);
}
