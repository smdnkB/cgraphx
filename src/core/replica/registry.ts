/**
 * 副本登记的读写(spec D19、plan C-3)。
 *
 * 登记存主目录数据目录下的 `replicas/<副本目录名>.json`,一个副本一个文件:两个会话同时开副本
 * 各写各的文件,不会互相覆盖。写入走同目录临时文件 + rename,读的一方不会读到写了一半的文件;
 * 删副本只填 removedAt,文件保留(副本删了,旧记录照样换算、照样归属)。读到不认识的字段,
 * 写回时原样保留。directory.ts 的 resolveDataDir 只读其中的 path、removedAt。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { getDataDir, REPLICAS_DIRNAME } from '../directory';
import type { ReplicaEntry } from './types';

const ENTRY_EXT = '.json';

/** 登记目录:主目录数据目录下的 `replicas/`。 */
export function registryDir(mainRoot: string): string {
  return path.join(getDataDir(mainRoot), REPLICAS_DIRNAME);
}

/** 一个副本的登记文件路径。 */
export function entryFilePath(mainRoot: string, name: string): string {
  return path.join(registryDir(mainRoot), `${name}${ENTRY_EXT}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 读登记文件并解析成对象;读不了、不是合法 JSON、不是对象 → null。 */
function readRaw(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 7 个必有字段齐全、类型对、path 是绝对路径 → 登记;否则 null(按解析失败跳过)。baseCommit 是后加的
 * 字段:不是字符串(以前的登记没有)→ null。
 */
function toEntry(raw: Record<string, unknown>): ReplicaEntry | null {
  const { name, path: replicaPath, featureId, branch, baseBranch, baseCommit, createdAt, removedAt } = raw;
  if (
    typeof name !== 'string' ||
    typeof replicaPath !== 'string' ||
    !path.isAbsolute(replicaPath) ||
    typeof featureId !== 'string' ||
    typeof branch !== 'string' ||
    typeof baseBranch !== 'string' ||
    typeof createdAt !== 'string' ||
    (removedAt !== null && typeof removedAt !== 'string')
  ) {
    return null;
  }
  return {
    name,
    path: replicaPath,
    featureId,
    branch,
    baseBranch,
    baseCommit: typeof baseCommit === 'string' && baseCommit !== '' ? baseCommit : null,
    createdAt,
    removedAt,
  };
}

/**
 * 读过的登记目录:目录的修改时间没变就不再逐个读文件(Stop hook 一轮里找需求目录要读很多次,登记里
 * 已删的副本也一直留着)。登记文件都经临时文件 + rename 写入,增删改都会改到目录的修改时间。
 */
const entriesCache = new Map<string, { mtimeMs: number; entries: ReplicaEntry[] }>();

/** 全部登记(含已删除),按文件名排序;登记目录不在 → [],解析失败的文件跳过。 */
export function readEntries(mainRoot: string): ReplicaEntry[] {
  const dir = registryDir(mainRoot);
  const stat = fs.statSync(dir, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isDirectory()) return [];
  const cached = entriesCache.get(dir);
  if (cached !== undefined && cached.mtimeMs === stat.mtimeMs) return [...cached.entries];
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const entries: ReplicaEntry[] = [];
  for (const file of files.sort()) {
    if (!file.endsWith(ENTRY_EXT)) continue;
    const raw = readRaw(path.join(dir, file));
    const entry = raw === null ? null : toEntry(raw);
    if (entry !== null) entries.push(entry);
  }
  entriesCache.set(dir, { mtimeMs: stat.mtimeMs, entries });
  return [...entries];
}

/**
 * 同目录先写临时文件再 rename。`replicas/` 不在时只建这一层:数据目录本身不在说明主目录
 * 不对,不能顺手把它建出来(spec D24)。临时文件不以 .json 结尾,读的一方不会把它当登记。
 */
function writeJsonAtomic(file: string, value: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(file));
  } catch (err) {
    // 已经在(含两个会话同时开第一个副本)照常写;其余(如数据目录不在)照常抛出
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  entriesCache.delete(path.dirname(file));
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/** 写一个新登记(字段顺序同 spec「细节方案:F7」的示例);返回登记文件路径。 */
export function writeEntry(mainRoot: string, entry: ReplicaEntry): string {
  const file = entryFilePath(mainRoot, entry.name);
  writeJsonAtomic(file, {
    name: entry.name,
    path: entry.path,
    featureId: entry.featureId,
    branch: entry.branch,
    baseBranch: entry.baseBranch,
    baseCommit: entry.baseCommit,
    createdAt: entry.createdAt,
    removedAt: entry.removedAt,
  });
  return file;
}

/** 只改 removedAt,其余字段(含不认识的)原样写回。 */
export function markRemoved(mainRoot: string, name: string, at: string): void {
  const file = entryFilePath(mainRoot, name);
  const raw = readRaw(file);
  if (raw === null) {
    throw new Error(`读不了登记文件 ${file},没能把 ${name} 记为删除;检查这个文件是不是合法的 JSON`);
  }
  writeJsonAtomic(file, { ...raw, removedAt: at });
}
