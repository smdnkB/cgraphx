/**
 * 数据位置(spec:2026-11-05-数据按项目放用户目录 D2、D7、D8、D22)
 *
 * timeline 的库和文件(轮次记录),db-query 的项目级
 * `db-profiles.json` 与 `db-query.log`,都经这里定位置:
 *
 * - 项目根(D2):从起点往上第一个装过的目录(`.cgraphx/cgraphx.db` 在,就近优先);一直没有,再往上第一个有
 *   `.git` 的目录(工作区根);都没有就没有根
 * - 旧库模式:根装过、本地 `.cgraphx/project.json` 没有并过记号、本地库里有 `timeline_*`、`task_*`、`sync_*`
 *   任一张表 → 数据照旧在本地 `.cgraphx/`
 * - 项目库模式:其余情况,数据在用户目录里这个项目的目录(`~/.cgraphx/projects/<目录名>/`)。根装过的,第一次
 *   写数据时写上并过记号、项目目录不在就建;根没装过的,项目目录已在才记
 *
 * 固定走本地 `.cgraphx/` 的(知识库、1.x 遗留表清理、「我的需求」、副本登记、shared 链接、`project.json`)不经
 * 这里。读的一方(locateData、getDataDir)不写记号、不建目录。有并过记号时只读 `project.json` 和 `projects/`
 * 目录、不开库;没有记号时按根开一次本地库看有没有旧表(同一进程记住)。标识走进程内记忆(project-identity.ts)。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { createDatabase, type SqliteDatabase } from './db/sqlite-adapter';
import { getCodeGraphDir, isInitialized } from './directory';
import { identityOfRoot, projectDisplayName, type ProjectIdentity } from './project-identity';
import { ensureProjectDir, findProjectDir } from './user-data-dir';

export type DataUnavailable = 'no-root' | 'no-identity' | 'git-error' | 'not-created';
export interface DataLocation {
  start: string;
  root: string | null;                 // D2;起点往上没有装过的目录也没有 .git → null
  installed: boolean;                  // 根装过(isInitialized)
  identity: ProjectIdentity | null;
  mode: 'legacy' | 'project';          // 根装过、没并过记号、本地库有 timeline_*/task_*/sync_* 任一张表 → legacy
  dataDir: string | null;              // legacy:本地 .cgraphx/;project:已建的项目目录;没有 → null
  projectDirName: string | null;       // project 模式下已建的项目目录名
  unavailable: DataUnavailable | null; // dataDir 为 null 的原因
}
export interface LocalProjectJson { mergedAt: string | null; mergedInto: string | null; name: string | null }

/** 本地库文件名,与 db/index.ts 的 DATABASE_FILENAME 同值(这里不 import db/index.ts:它 import 本文件)。 */
const LOCAL_DATABASE_FILENAME = 'cgraphx.db';

/** 本地 `.cgraphx/` 里的并过记号与项目名称(D22)。 */
const PROJECT_JSON_FILENAME = 'project.json';

/** 往上找项目根的深度上限(同 resolveProjectRoot)。 */
const MAX_WALK_DEPTH = 128;

/** 本地库里有没有旧数据:timeline、task、sync 任一张表。 */
const LEGACY_TABLES_SQL =
  "SELECT 1 FROM sqlite_master WHERE type = 'table' AND (name LIKE 'timeline\\_%' ESCAPE '\\' " +
  "OR name LIKE 'task\\_%' ESCAPE '\\' OR name LIKE 'sync\\_%' ESCAPE '\\') LIMIT 1";

/** hasLegacyTables 按根记住结果;超过上限整个清掉。 */
const legacyMemo = new Map<string, boolean>();
const LEGACY_MEMO_LIMIT = 1024;

/** 装过(`.cgraphx/cgraphx.db` 在);判断出错按没装过。 */
function isInstalled(dir: string): boolean {
  try {
    return isInitialized(dir);
  } catch {
    return false;
  }
}

/** 目录下有 `.git`(目录或文件都算)。 */
function hasDotGit(dir: string): boolean {
  try {
    return fs.lstatSync(path.join(dir, '.git'), { throwIfNoEntry: false }) !== undefined;
  } catch {
    return false;
  }
}

/** spec D2:从起点往上第一个装过的目录;一直没有,再往上第一个有 `.git` 的目录;都没有 → null。 */
export function findProjectRoot(start: string): string | null {
  let current = path.resolve(start);
  let firstWorkTree: string | null = null;
  for (let depth = 0; depth < MAX_WALK_DEPTH; depth++) {
    if (isInstalled(current)) return current;
    if (firstWorkTree === null && hasDotGit(current)) firstWorkTree = current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return firstWorkTree;
}

function hasMergedMark(root: string): boolean {
  return (readLocalProjectJson(root)?.mergedAt ?? null) !== null;
}

/**
 * spec D7:已知根的数据位置,只读(不写记号、不建目录)。根装过:有并过记号 → 项目库;没有 → 本地库有旧表
 * 走旧库,没有走项目库。根没装过 → 项目库。项目库模式下按标识找已建的项目目录。
 */
export function locateDataAtRoot(root: string): DataLocation {
  const resolved = path.resolve(root);
  const installed = isInstalled(resolved);
  const base = { start: resolved, root: resolved, installed };
  if (installed && !hasMergedMark(resolved) && hasLegacyTables(resolved)) {
    // 旧库:标识只给显示用,git 出错也照给本地目录
    const info = identityOfRoot(resolved);
    return {
      ...base,
      identity: info === 'git-error' ? null : info.identity,
      mode: 'legacy',
      dataDir: getCodeGraphDir(resolved),
      projectDirName: null,
      unavailable: null,
    };
  }
  const missing = (identity: ProjectIdentity | null, reason: DataUnavailable): DataLocation => ({
    ...base,
    identity,
    mode: 'project',
    dataDir: null,
    projectDirName: null,
    unavailable: reason,
  });
  const info = identityOfRoot(resolved);
  if (info === 'git-error') return missing(null, 'git-error');
  if (info.identity === null) return missing(null, 'no-identity');
  const found = findProjectDir(info.identity);
  if (found === null) return missing(info.identity, 'not-created');
  return {
    ...base,
    identity: info.identity,
    mode: 'project',
    dataDir: found.dir,
    projectDirName: found.name,
    unavailable: null,
  };
}

/** 从起点按 D2 认根后 locateDataAtRoot;没有根 → `unavailable: 'no-root'`。只读。 */
export function locateData(start: string): DataLocation {
  const resolvedStart = path.resolve(start);
  const root = findProjectRoot(resolvedStart);
  if (root === null) {
    return {
      start: resolvedStart,
      root: null,
      installed: false,
      identity: null,
      mode: 'project',
      dataDir: null,
      projectDirName: null,
      unavailable: 'no-root',
    };
  }
  return { ...locateDataAtRoot(root), start: resolvedStart };
}

/** 数据目录(= locateData(start).dataDir);拿不到 → null。只读。 */
export function getDataDir(start: string): string | null {
  return locateData(start).dataDir;
}

/** 写上并过记号;写不上不影响这一次写数据(下一次照样走项目库,再写一次)。 */
function writeMergedMark(root: string, dirName: string): void {
  try {
    updateLocalProjectJson(root, { mergedAt: new Date().toISOString(), mergedInto: dirName });
  } catch {
    // 记号只让判定不再开本地库;没写上时本地库里仍没有旧表,判定结果相同
  }
}

/**
 * spec D7、全局约束 3:已知根写数据的入口。旧库 → 本地 `.cgraphx/`;根装过的项目库模式 → 没有并过记号就写上,
 * 项目目录不在就建(只经 ensureProjectDir);根没装过 → 项目目录已在才返回;没有标识、git 出错 → null。
 */
export function ensureDataDirAtRoot(root: string): string | null {
  const resolved = path.resolve(root);
  const installed = isInstalled(resolved);
  const merged = installed && hasMergedMark(resolved);
  if (installed && !merged && hasLegacyTables(resolved)) return getCodeGraphDir(resolved);
  const info = identityOfRoot(resolved);
  if (info === 'git-error' || info.identity === null) return null;
  if (!installed) return findProjectDir(info.identity)?.dir ?? null;
  const dir = findProjectDir(info.identity) ?? ensureProjectDir(info.identity);
  if (!merged) writeMergedMark(resolved, dir.name);
  return dir.dir;
}

/** 写数据的入口(D7):从起点按 D2 认根后 ensureDataDirAtRoot;没有根 → null。 */
export function ensureDataDir(start: string): string | null {
  const root = findProjectRoot(start);
  return root === null ? null : ensureDataDirAtRoot(root);
}

/** 只读查本地库有没有表;打开或查询失败 → true(宁可留在旧库,不写记号)。 */
function probeLegacyTables(dbPath: string): boolean {
  if (!fs.existsSync(dbPath)) return false;
  let db: SqliteDatabase | null = null;
  try {
    db = createDatabase(dbPath).db;
    return db.prepare(LEGACY_TABLES_SQL).get() !== undefined;
  } catch {
    return true;
  } finally {
    try {
      db?.close();
    } catch {
      // 关不上不影响结论
    }
  }
}

/**
 * 本地库有没有 timeline_*、task_*、sync_* 任一张表。本地库不在 → false;打开或查询失败 → true。同一进程按根
 * 记住结果(并过记号每次现读,并完以后判定不再走到这里)。
 */
export function hasLegacyTables(root: string): boolean {
  const key = path.resolve(root);
  const cached = legacyMemo.get(key);
  if (cached !== undefined) return cached;
  const result = probeLegacyTables(path.join(getCodeGraphDir(key), LOCAL_DATABASE_FILENAME));
  if (legacyMemo.size >= LEGACY_MEMO_LIMIT) legacyMemo.clear();
  legacyMemo.set(key, result);
  return result;
}

function projectJsonPath(root: string): string {
  return path.join(getCodeGraphDir(path.resolve(root)), PROJECT_JSON_FILENAME);
}

/** 读 JSON 文件成对象;不在、读不了、不是对象 → null。 */
function readJsonObject(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** 本地 `.cgraphx/project.json`;不在、不是对象 → null;字段类型不对的按 null。 */
export function readLocalProjectJson(root: string): LocalProjectJson | null {
  const obj = readJsonObject(projectJsonPath(root));
  if (obj === null) return null;
  return {
    mergedAt: stringOrNull(obj.mergedAt),
    mergedInto: stringOrNull(obj.mergedInto),
    name: stringOrNull(obj.name),
  };
}

/** 同目录临时文件 + rename;失败时删掉临时文件再抛。 */
function writeFileAtomic(file: string, content: string): void {
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // 临时文件删不掉不盖住原来的错误
    }
    throw err;
  }
}

const PROJECT_JSON_KEYS = ['mergedAt', 'mergedInto', 'name'] as const;

/**
 * 改写本地 `.cgraphx/project.json`:读出原对象(不在为空)、合并 patch、写回(临时文件 + rename);三个字段
 * 缺的补 null,不认识的字段原样保留。只给装过的目录写:本地 `.cgraphx/` 不在时抛错。
 */
export function updateLocalProjectJson(root: string, patch: Partial<LocalProjectJson>): void {
  const resolved = path.resolve(root);
  const dir = getCodeGraphDir(resolved);
  let isDir = false;
  try {
    isDir = fs.statSync(dir).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    throw new Error(`${dir} 不在,写不了 ${PROJECT_JSON_FILENAME}(只给装过 cgraphx 的目录写);先在 ${resolved} 运行 cgraphx install`);
  }
  const current = readJsonObject(projectJsonPath(resolved)) ?? {};
  const next: Record<string, unknown> = {};
  for (const key of PROJECT_JSON_KEYS) next[key] = Object.hasOwn(current, key) ? current[key] : null;
  for (const [key, value] of Object.entries(current)) {
    if (!Object.hasOwn(next, key)) next[key] = value;
  }
  for (const key of PROJECT_JSON_KEYS) {
    const value = patch[key];
    if (value !== undefined) next[key] = value;
  }
  writeFileAtomic(projectJsonPath(resolved), `${JSON.stringify(next, null, 2)}\n`);
}

/** dataDir 为 null 时给人看的原因和修法;unavailable 为 null 时返回空串。 */
export function missingDataMessage(loc: DataLocation): string {
  const root = loc.root ?? loc.start;
  switch (loc.unavailable) {
    case 'no-root':
      return `${loc.start} 不在装过 cgraphx 的目录里,也不在 git 仓库里;到项目目录里运行,或先在项目根运行 cgraphx install`;
    case 'no-identity':
      return `认不出 ${root} 是哪个项目(没有 origin,也没装过 cgraphx);在项目根运行 cgraphx install`;
    case 'git-error':
      return `认不出 ${root} 是哪个项目:git 跑不起来;装好 git 后重试`;
    case 'not-created': {
      const display = loc.identity !== null ? projectDisplayName(loc.identity) : root;
      return `项目 ${display} 在本机还没有数据;在装过 cgraphx 的目录里干活后会记起来(没装过就先在项目根运行 cgraphx install)`;
    }
    case null:
      return '';
  }
}
