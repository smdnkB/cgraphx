/**
 * 并旧数据的文件部分(spec:2026-11-05-数据按项目放用户目录 D26、D29 文件行;index C-15)
 *
 * - 锁:`<项目目录>/merge.lock`,同一项目同一时间只有一个目录在并;`wx` 独占创建,内容 `{"pid":…,"startedAt":…}`,
 *   pid 不存活或 mtime 超过 2 小时算陈旧,删掉后接管(规则同 sync.lock)
 * - 备份:在旧库写事务里把本地 `.cgraphx/` 的库文件、平台连接、db-query 配置与日志、轮次记录照原名复制进
 *   `<项目目录>/backups/<时间>-<目录名>/`;写事务挡住同目录的 hook,复制出来的库文件是一致的
 * - 文件并:`db-profiles.json`、`db-query.log`、`turns/`(`task-source.json` 归 sync 并);每一类旧目录里没有就什么
 *   都不做、不提示。再装一次时结果不变:配置逐字相同不管,日志已追加过的整段不再追加,轮次记录同名的不覆盖
 * - 并完删本地的平台连接、db-query 配置与日志、轮次记录(备份里有)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { DATABASE_FILENAME, type SqliteDatabase } from '../db';
import { TASK_SOURCE_CONFIG_FILENAME } from '../task';
import { TURNS_DIRNAME } from '../timeline';
import { BACKUPS_DIRNAME } from '../user-data-dir';
import {
  DB_PROFILES_FILENAME,
  DB_QUERY_LOG_FILENAME,
  MERGE_LOCK_FILENAME,
  MERGE_LOCK_RETRY_MS,
  MERGE_LOCK_STALE_MS,
  MERGE_LOCK_WAIT_MS,
  PRIVATE_DIR_MODE,
  PRIVATE_FILE_MODE,
} from './constants';

/** 备份里照原名放的文件(在的才放):库文件三件、平台连接、db-query 连接配置与日志。 */
const BACKUP_FILENAMES = [
  DATABASE_FILENAME,
  `${DATABASE_FILENAME}-wal`,
  `${DATABASE_FILENAME}-shm`,
  TASK_SOURCE_CONFIG_FILENAME,
  DB_PROFILES_FILENAME,
  DB_QUERY_LOG_FILENAME,
] as const;

function errnoOf(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException).code;
}

/** 不在(含上级不是目录)。 */
function isMissing(err: unknown): boolean {
  const code = errnoOf(err);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** 收紧权限;Windows 上不设。 */
function chmodPrivate(p: string, mode: number): void {
  if (process.platform !== 'win32') fs.chmodSync(p, mode);
}

function removeQuietly(p: string): void {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // 删不掉不盖住原来的结果
  }
}

/** 读文件原文;不在 → null。其余读不了的错误照抛:判断不了就不并,由调用方按并失败处理。 */
function readFileOrNull(file: string): Buffer | null {
  try {
    return fs.readFileSync(file);
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

function statOrNull(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

// ─── 锁 ────────────────────────────────────────────────────────────────────

function lockPath(projectDir: string): string {
  return path.join(projectDir, MERGE_LOCK_FILENAME);
}

/** 锁里的 pid;读不到、内容不对 → null。 */
function readLockPid(file: string): number | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { pid?: unknown };
    return typeof raw.pid === 'number' && Number.isInteger(raw.pid) && raw.pid > 0 ? raw.pid : null;
  } catch {
    return null;
  }
}

/** pid 是否存活(EPERM 表示进程在、只是没权限发信号,算存活)。 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return errnoOf(err) !== 'ESRCH';
  }
}

/** 已在的锁是否陈旧:mtime 超时,或 pid 不存活;pid 读不到时只看 mtime(可能正被别的进程写入)。 */
function isStaleLock(file: string): boolean {
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return true;
  }
  if (Date.now() - mtimeMs > MERGE_LOCK_STALE_MS) return true;
  const pid = readLockPid(file);
  return pid !== null && !isPidAlive(pid);
}

function tryCreateLock(file: string): boolean {
  try {
    const fd = fs.openSync(file, 'wx', PRIVATE_FILE_MODE);
    try {
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch (err) {
    if (errnoOf(err) === 'EEXIST') return false;
    throw err;
  }
}

/** 独占创建一次;已在且陈旧 → 删掉后再试一次。 */
function claimOnce(file: string): boolean {
  if (tryCreateLock(file)) return true;
  if (!isStaleLock(file)) return false;
  try {
    fs.unlinkSync(file);
  } catch {
    // 被别的进程抢先删掉、接管:按再试的结果为准
  }
  return tryCreateLock(file);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 拿项目目录的 merge.lock:拿不到每隔 MERGE_LOCK_RETRY_MS 再试,最多等 MERGE_LOCK_WAIT_MS;等不到 → false。 */
export function acquireMergeLock(projectDir: string): boolean {
  const file = lockPath(projectDir);
  const deadline = Date.now() + MERGE_LOCK_WAIT_MS;
  for (;;) {
    if (claimOnce(file)) return true;
    const left = deadline - Date.now();
    if (left <= 0) return false;
    sleepSync(Math.min(MERGE_LOCK_RETRY_MS, left));
  }
}

/** 放锁:只删本进程拿的;删不掉由陈旧判定兜底。 */
export function releaseMergeLock(projectDir: string): void {
  const file = lockPath(projectDir);
  try {
    if (readLockPid(file) === process.pid) fs.unlinkSync(file);
  } catch {
    // 放锁失败不影响结果
  }
}

// ─── 备份 ──────────────────────────────────────────────────────────────────

/** 目录不在就建(0700,Windows 照默认权限)。 */
function ensurePrivateDir(dir: string): void {
  const created = fs.mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  if (created !== undefined) chmodPrivate(dir, PRIVATE_DIR_MODE);
}

/** 备份目录名:`new Date().toISOString()` 里的 `:`、`.` 换成 `-`,再接 `-<并的那个目录的 basename>`。 */
function backupDirName(dirName: string): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${dirName}`;
}

/** 文件在就照原名复制(能写时复制就写时复制),0600。 */
function copyFileIfPresent(src: string, dst: string): void {
  if (statOrNull(src)?.isFile() !== true) return;
  fs.copyFileSync(src, dst, fs.constants.COPYFILE_FICLONE);
  chmodPrivate(dst, PRIVATE_FILE_MODE);
}

/**
 * 备份(D26):在旧库写事务里把本地 `.cgraphx/` 里在的库文件(含 -wal、-shm)、`task-source.json`、`db-profiles.json`、
 * `db-query.log`、`turns/` 复制进 `<项目目录>/backups/<时间>-<目录名>/`,提交。返回备份目录。
 *
 * @throws 拿不到旧库写锁、建目录或复制失败(已回滚,建了一半的备份目录已删):备份失败就不并
 */
export function backupLegacyData(oldDb: SqliteDatabase, localDir: string, projectDir: string, dirName: string): string {
  oldDb.exec('BEGIN IMMEDIATE');
  let created: string | null = null;
  try {
    const backupsRoot = path.join(projectDir, BACKUPS_DIRNAME);
    ensurePrivateDir(backupsRoot);
    const target = path.join(backupsRoot, backupDirName(dirName));
    // 不带 recursive:目标已在就报错,不往别人的备份里混
    fs.mkdirSync(target, { mode: PRIVATE_DIR_MODE });
    created = target;
    chmodPrivate(target, PRIVATE_DIR_MODE);
    for (const name of BACKUP_FILENAMES) copyFileIfPresent(path.join(localDir, name), path.join(target, name));
    const turns = path.join(localDir, TURNS_DIRNAME);
    if (statOrNull(turns)?.isDirectory() === true) {
      fs.cpSync(turns, path.join(target, TURNS_DIRNAME), { recursive: true });
    }
    oldDb.exec('COMMIT');
    return target;
  } catch (err) {
    try {
      oldDb.exec('ROLLBACK');
    } catch {
      // 事务可能已结束
    }
    if (created !== null) removeQuietly(created);
    throw err;
  }
}

// ─── 文件并 ────────────────────────────────────────────────────────────────

/** 同目录临时文件(0600)写好再改名到位:写到一半被杀掉也不会留下半个配置。 */
function writePrivateFileAtomic(target: string, content: Buffer): void {
  const tmp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    fs.writeFileSync(tmp, content, { mode: PRIVATE_FILE_MODE, flag: 'wx' });
    chmodPrivate(tmp, PRIVATE_FILE_MODE);
    fs.renameSync(tmp, target);
  } catch (err) {
    removeQuietly(tmp);
    throw err;
  }
}

/** db-profiles.json:旧的在、项目里没有 → 复制过去(0600);逐字相同 → 不管;不一样 → 留项目里的,返回 true。 */
function mergeProfiles(src: string, dst: string): boolean {
  const old = readFileOrNull(src);
  if (old === null) return false;
  const current = readFileOrNull(dst);
  if (current === null) {
    writePrivateFileAtomic(dst, old);
    return false;
  }
  return !current.equals(old);
}

/** db-query.log:旧的追加到项目日志末尾(项目里没有就等于复制),0600;项目日志里已有这一整段(上次并到一半)不再追加。 */
function appendLog(src: string, dst: string): void {
  const old = readFileOrNull(src);
  if (old === null || old.length === 0) return;
  const current = readFileOrNull(dst);
  if (current !== null && current.includes(old)) return;
  fs.appendFileSync(dst, old, { mode: PRIVATE_FILE_MODE });
  chmodPrivate(dst, PRIVATE_FILE_MODE);
}

/** turns/:旧的每个文件,项目的 turns/ 里没有同名的才复制(项目里没有 turns/ 先建)。 */
function mergeTurns(srcDir: string, dstDir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(srcDir, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return;
    throw err;
  }
  const files = entries.filter((entry) => entry.isFile());
  if (files.length === 0) return;
  fs.mkdirSync(dstDir, { recursive: true });
  for (const file of files) {
    try {
      fs.copyFileSync(path.join(srcDir, file.name), path.join(dstDir, file.name), fs.constants.COPYFILE_EXCL);
    } catch (err) {
      // 项目里已有同名的(别的目录的会话、hook 刚写的):留项目里的
      if (errnoOf(err) !== 'EEXIST') throw err;
    }
  }
}

/**
 * 文件并(D29 文件行),由调用方在旧库写事务里调。返回 M2 的 db-query 那句(配置和项目里已有的不一样时)。
 *
 * @throws 读写文件出错:由调用方按并失败处理
 */
export function mergeLegacyFiles(localDir: string, projectDir: string, dirName: string): string[] {
  const notices: string[] = [];
  if (mergeProfiles(path.join(localDir, DB_PROFILES_FILENAME), path.join(projectDir, DB_PROFILES_FILENAME))) {
    notices.push(`${dirName} 的 db-query 连接配置和项目里已有的不一样,没并,在备份里`);
  }
  appendLog(path.join(localDir, DB_QUERY_LOG_FILENAME), path.join(projectDir, DB_QUERY_LOG_FILENAME));
  mergeTurns(path.join(localDir, TURNS_DIRNAME), path.join(projectDir, TURNS_DIRNAME));
  return notices;
}

// ─── 并完删本地 ────────────────────────────────────────────────────────────

/** db-query.log 本身,以及它轮转出来的 `db-query.log.1`、`db-query.log.2`…。 */
function isQueryLogFile(name: string): boolean {
  if (name === DB_QUERY_LOG_FILENAME) return true;
  const prefix = `${DB_QUERY_LOG_FILENAME}.`;
  return name.startsWith(prefix) && /^[0-9]+$/.test(name.slice(prefix.length));
}

/** 旧库提交之后:删本地 `.cgraphx/` 里在的平台连接、db-query 配置与日志(连同轮转文件)、轮次记录;删不掉的不管。 */
export function removeMergedLocalFiles(localDir: string): void {
  removeQuietly(path.join(localDir, TASK_SOURCE_CONFIG_FILENAME));
  removeQuietly(path.join(localDir, DB_PROFILES_FILENAME));
  let names: string[] = [];
  try {
    names = fs.readdirSync(localDir);
  } catch {
    // 本地目录读不了:日志留着
  }
  for (const name of names) {
    if (isQueryLogFile(name)) removeQuietly(path.join(localDir, name));
  }
  removeQuietly(path.join(localDir, TURNS_DIRNAME));
}
