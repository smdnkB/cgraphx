/**
 * 列出用户目录里的项目数据(spec:2026-11-05-数据按项目放用户目录 D32;F5)
 *
 * `~/.cgraphx/projects/` 下每个一级目录(不含 `.` 开头的临时目录)一项:标识、整个目录的大小、timeline 记下的根与
 * 最近活动、备份。只读:不建目录、不建库、不应用 schema;timeline 汇总按目录只读打开,库不在按没有记录,读不出的
 * (库坏了)也按没有记录,不让一个项目拖垮整份列表。目录大小、备份统计、汇总读取也给 remove.ts 用。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { readTimelineSummary, type TimelineDataSummary, type TimelineRoot } from '../timeline';
import { BACKUPS_DIRNAME, listProjectDirs } from '../user-data-dir';
import { projectRefOf, rootInfosOf } from './show';
import type { ProjectListItem, ProjectRef } from './types';

/** 整个目录的字节数:递归 lstat,不跟随链接(链接按它自己的大小算);读不了、刚被删掉的跳过。 */
export function dirSize(dir: string): number {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += dirSize(full);
      continue;
    }
    try {
      total += fs.lstatSync(full).size;
    } catch {
      // 刚被删掉、没权限:不算
    }
  }
  return total;
}

/** 项目目录 `backups/` 下一级目录(一次并旧数据一份)的个数与总字节;`backups/` 不在 → 0。 */
export function backupsSummary(dir: string): { count: number; size: number } {
  const root = path.join(dir, BACKUPS_DIRNAME);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { count: 0, size: 0 };
  }
  let count = 0;
  let size = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    count += 1;
    size += dirSize(path.join(root, entry.name));
  }
  return { count, size };
}

/** 按目录只读读 timeline 汇总;库不在、读不出 → null。 */
export function readSummaryQuietly(dir: string): TimelineDataSummary | null {
  try {
    return readTimelineSummary(dir);
  } catch {
    return null;
  }
}

/** 各根最近一次活动里最晚的;没有记录 → null。 */
function latestActiveAt(roots: readonly TimelineRoot[]): string | null {
  let latest: string | null = null;
  for (const r of roots) {
    if (latest === null || r.lastTs > latest) latest = r.lastTs;
  }
  return latest;
}

/** identity.json 读不出的项目目录:kind、origin、name 为 null,显示名用目录名。 */
function missingIdentityRef(dirName: string): ProjectRef {
  return { dir: dirName, display: dirName, kind: null, origin: null, name: null };
}

/** `cgraphx project list`:用户目录里的每个项目,按目录名排序。只读。 */
export function listProjects(): ProjectListItem[] {
  return listProjectDirs().map((entry) => {
    // 先算大小:读汇总会打开库,WAL 库会带出 -wal、-shm
    const size = dirSize(entry.dir);
    const roots = readSummaryQuietly(entry.dir)?.roots ?? [];
    return {
      project: entry.identity !== null ? projectRefOf(entry.identity, entry.name) : missingIdentityRef(entry.name),
      size,
      lastActiveAt: latestActiveAt(roots),
      roots: rootInfosOf(roots),
      backups: backupsSummary(entry.dir),
      identityMissing: entry.identity === null,
    };
  });
}
