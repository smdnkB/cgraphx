/**
 * 查看这个目录属于哪个项目(spec:2026-11-05-数据按项目放用户目录 D17、D18;F2)
 *
 * showProject 按数据位置(locateData,只读)认根、标识和数据在哪,再列 timeline 记下的根;不建目录、不写记号、不写库。
 * 本文件也放 show、list、remove、name 和命令行共用的显示辅助:项目引用、根信息、家目录前缀显示成 `~`。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { locateData, missingDataMessage, type DataLocation } from '../data-location';
import { projectDisplayName, type ProjectIdentity } from '../project-identity';
import { listTimelineRoots, type TimelineRoot } from '../timeline';
import { findProjectDir } from '../user-data-dir';
import { ProjectError } from './errors';
import type { ProjectRef, ProjectRootInfo, ProjectShowReport } from './types';

/** 有标识的项目引用;dir 是项目目录名(还没建为 null),display 就是名字。 */
export function projectRefOf(identity: ProjectIdentity, dir: string | null): ProjectRef {
  return { dir, display: projectDisplayName(identity), name: identity.name };
}

/** timeline 记下的根(已按最近活动降序)→ 根信息,顺带看目录还在不在。 */
export function rootInfosOf(roots: readonly TimelineRoot[]): ProjectRootInfo[] {
  return roots.map((r) => ({ path: r.root, lastActiveAt: r.lastTs, exists: fs.existsSync(r.root) }));
}

/** 给人看的路径:家目录前缀写成 `~`(`~/.cgraphx/projects/<目录名>`);不在家目录下的原样。 */
export function displayPath(p: string): string {
  const raw = os.homedir();
  if (raw === '') return p;
  const home = path.resolve(raw);
  if (p === home) return '~';
  const prefix = home.endsWith(path.sep) ? home : `${home}${path.sep}`;
  return p.startsWith(prefix) ? `~${path.sep}${p.slice(prefix.length)}` : p;
}

/**
 * 认不出项目时的提示(missingDataMessage)。旧库模式下 git 跑不起来时,数据位置照给本地目录、不标原因(标识只给
 * 显示用),这里按 git 出错说。
 */
export function noProjectMessage(loc: DataLocation): string {
  const message = missingDataMessage(loc);
  return message !== '' ? message : missingDataMessage({ ...loc, unavailable: 'git-error' });
}

/**
 * `cgraphx project show`:这个目录属于哪个项目。start 是起点(当前目录、项目根都行)。mode:旧库 → legacy,
 * 项目目录在 → project,还没有数据 → none。
 *
 * @throws ProjectError no_project:没有根、认不出标识、git 跑不起来
 */
export function showProject(start: string): ProjectShowReport {
  const loc = locateData(start);
  if (loc.root === null || loc.identity === null) throw new ProjectError('no_project', noProjectMessage(loc));
  const mode = loc.mode === 'legacy' ? 'legacy' : loc.dataDir !== null ? 'project' : 'none';
  const dir = loc.projectDirName ?? findProjectDir(loc.identity)?.name ?? null;
  return {
    project: projectRefOf(loc.identity, dir),
    dataDir: loc.dataDir,
    mode,
    roots: rootInfosOf(listTimelineRoots(start)),
  };
}
