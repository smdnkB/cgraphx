/**
 * 项目名称(spec:2026-11-05-数据按项目放用户目录 D3、D19;F2;K2)
 *
 * - renameProject:`cgraphx project name <名称>`。名字只经基础层 writeProjectName 写(根在 git 里写本地 git 配置,
 *   不在 git 里写本地 `project.json`);写完把受影响的根(这个根,加上其余工作区里同一相对位置的根)在用户级
 *   sessions.db 里的开始目录归属清掉,下次补录按新标识重新认;偏移不动,已经记下的不搬(spec 2026-11-06-会话文件
 *   解析替代hooks D2)。之前记的事件留在原项目下,不搬。还有没并过去的旧数据的目录不许改名:先 install 并过去。
 * - planInstallName / applyInstallName:install 时问名字、记名字(K2:按名字认的根,装的时候就把名字记下来,
 *   用默认名字的也记)。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { findProjectRoot, locateData, missingDataMessage } from '../data-location';
import { isInitialized } from '../directory';
import {
  defaultProjectName,
  identityKind,
  identityOfRoot,
  projectDisplayName,
  sameIdentity,
  validateProjectName,
  writeProjectName,
  type ProjectIdentity,
  type RootIdentity,
} from '../project-identity';
import { listSiblingRoots } from '../repo-projects';
import { openSessionIndex } from '../session-index';
import { countEventsUnderRoots, readTimelineSummary, type TimelineRoot } from '../timeline';
import { findProjectDir } from '../user-data-dir';
import { ProjectError } from './errors';
import { displayPath } from './show';
import type { InstallNamePlan, RenameOutcome } from './types';

/** M10:旧库里改名。 */
const LEGACY_RENAME_MESSAGE =
  '这个目录还有没并过去的旧数据,先运行 cgraphx install 并过去再改名(install 时也能直接改名字)';

/** M9:改完标识没变。 */
const UNCHANGED_LINE = '没有变化';

/** 最近活动的根没有记录时写的占位。 */
const NO_ROOT_TEXT = '—';

/** 起点往上没有装过的目录也没有 .git:记不下名字。 */
function cannotRecordMessage(start: string): string {
  return `${start} 不在装过 cgraphx 的目录里,也不在 git 仓库里,记不下项目名称;到项目目录里运行,或先在项目根运行 cgraphx install`;
}

/** 根不在 git 里也没装过(同基础层 writeProjectName 的报错)。 */
function notInstalledMessage(root: string): string {
  return `${root} 没装过 cgraphx,也不在 git 仓库里,记不下项目名称;先在这里运行 cgraphx install`;
}

/** 认根的标识时 git 跑不起来(同数据位置的 git-error 提示)。 */
function gitErrorMessage(root: string): string {
  return missingDataMessage({
    start: root,
    root,
    installed: false,
    identity: null,
    mode: 'project',
    dataDir: null,
    projectDirName: null,
    unavailable: 'git-error',
  });
}

/** 装过(`.cgraphx/cgraphx.db` 在);判断出错按没装过。 */
function isInstalled(dir: string): boolean {
  try {
    return isInitialized(dir);
  } catch {
    return false;
  }
}

function realpathOrResolve(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** 校验并规整名字(去首尾空白);不合法 → invalid_name。 */
function checkedName(rawName: string): string {
  const checked = validateProjectName(rawName);
  if (!checked.ok) throw new ProjectError('invalid_name', checked.reason);
  return checked.name;
}

/** 记下名字以后的标识(spec D3):工作区根、不在 git 里 → 按名字认;子目录项目 → 原 origin 加名字。 */
function identityWithName(info: RootIdentity, name: string): ProjectIdentity {
  if (info.subdir !== null) return { origin: info.identity?.origin ?? null, name };
  return { origin: null, name };
}

/**
 * 清掉受影响的根在 sessions.db 里的开始目录归属(下次补录重新认;偏移不动)。sessions.db 打不开、清不掉都不报错
 * ——名字本身已经记下了,归属下次补录时重新认。
 */
function clearStartDirs(roots: readonly string[]): void {
  try {
    const index = openSessionIndex();
    try {
      index.deleteStartDirsByRoots(roots);
    } finally {
      index.close();
    }
  } catch {
    // 用户目录写不了:不影响改名结果
  }
}

/** 最近活动的根(roots 已按最近活动降序);没有 → `—`。 */
function latestRootOf(roots: readonly TimelineRoot[]): string {
  const latest = roots[0]?.root;
  return latest !== undefined ? displayPath(latest) : NO_ROOT_TEXT;
}

/** 项目目录里最近活动的根;库不在、读不出 → `—`(只是提示里的一处文字,不因此让改名失败)。 */
function latestRootText(dataDir: string): string {
  try {
    return latestRootOf(readTimelineSummary(dataDir)?.roots ?? []);
  } catch {
    return NO_ROOT_TEXT;
  }
}

/** 仓库名:origin 按 `/` 拆后的最后一段。 */
function repoNameOf(origin: string): string {
  const segments = origin.split('/').filter((seg) => seg !== '');
  return segments[segments.length - 1] ?? origin;
}

/** 改名后给人看的几行:新名字已有数据 → M7;原来按 origin 认 → M8;其余 → M6;原来没有标识 → 只有第一行。 */
function renameLines(
  prev: ProjectIdentity | null,
  next: ProjectIdentity,
  nextDir: { dir: string } | null,
  events: number,
): string[] {
  const nextDisplay = projectDisplayName(next);
  if (nextDir !== null) {
    return [
      `${nextDisplay} 已经有数据(在 ${latestRootText(nextDir.dir)} 记的)`,
      `这个目录之后也记到 ${nextDisplay}`,
    ];
  }
  const lines = [`之后记到 ${nextDisplay}`];
  if (prev === null) return lines;
  lines.push(`之前记的 ${events} 条还在 ${projectDisplayName(prev)} 下`);
  if (identityKind(prev) === 'origin' && prev.origin !== null) {
    lines.push(`${repoNameOf(prev.origin)} 的别的 clone 照旧记在那里`);
  }
  return lines;
}

/**
 * `cgraphx project name <名称>`(spec D19):给这个目录的根记下项目名称,之后记到按新标识认的项目。start 是起点。
 * 顺序:校验名字 → 认根 → 旧库不许改 → 认标识 → 标识没变就不写 → 数受影响的根下原项目记的事件 → 写名字 →
 * 清开始目录归属 → 出提示。
 *
 * @throws ProjectError invalid_name(名字不合法)、cannot_record(记不下)、legacy_data(还有没并过去的旧数据)、
 *   no_project(git 跑不起来)
 */
export function renameProject(start: string, rawName: string): RenameOutcome {
  const name = checkedName(rawName);
  const loc = locateData(start);
  if (loc.root === null) throw new ProjectError('cannot_record', cannotRecordMessage(loc.start));
  if (loc.mode === 'legacy') throw new ProjectError('legacy_data', LEGACY_RENAME_MESSAGE);
  const root = loc.root;
  const info = identityOfRoot(root);
  if (info === 'git-error') throw new ProjectError('no_project', gitErrorMessage(root));
  if (info.workTreeRoot === null && !loc.installed) {
    throw new ProjectError('cannot_record', notInstalledMessage(root));
  }

  const prev = info.identity;
  const next = identityWithName(info, name);
  if (prev !== null && sameIdentity(prev, next)) return { lines: [UNCHANGED_LINE] };

  const siblings = listSiblingRoots(root);
  const prevDir = prev !== null ? findProjectDir(prev) : null;
  const events = prevDir !== null ? countEventsUnderRoots(prevDir.dir, siblings) : 0;
  writeProjectName(root, name);
  const nextDir = findProjectDir(next);
  clearStartDirs(siblings);
  return { lines: renameLines(prev, next, nextDir, events) };
}

/**
 * install 要不要问项目名称(spec D3、K2):按 D2 认根;没有根、git 出错 → 不问。needsName 照根的标识;记过名字时
 * defaultName 是记下的名字,否则是默认名字(目录名;子目录项目取子目录名)。
 */
export function planInstallName(start: string): InstallNamePlan {
  const root = findProjectRoot(start);
  if (root === null) return { needsName: false, defaultName: null, recorded: false };
  const info = identityOfRoot(root);
  if (info === 'git-error') return { needsName: false, defaultName: null, recorded: false };
  const recorded = info.nameSource === 'recorded';
  const defaultName = recorded ? (info.identity?.name ?? defaultProjectName(info)) : defaultProjectName(info);
  return { needsName: info.needsName, defaultName, recorded };
}

/** M5:记下的名字本机已有数据、这个目录还没记进去过。项目库读不出时判断不了,不提示。 */
function installNotice(root: string, next: ProjectIdentity): string | null {
  const dir = findProjectDir(next);
  if (dir === null) return null;
  let roots: TimelineRoot[];
  try {
    roots = readTimelineSummary(dir.dir)?.roots ?? [];
  } catch {
    return null;
  }
  const self = realpathOrResolve(root);
  if (roots.some((r) => realpathOrResolve(r.root) === self)) return null;
  return `${projectDisplayName(next)} 已经有数据(在 ${latestRootOf(roots)} 记的),这个目录也记进去`;
}

/**
 * install 时记下项目名称(spec D3、K2)。只有记过同一个名字时不写;其余(包括按默认名字认的)一律写,写完清掉受
 * 影响的根在 sessions.db 里的开始目录归属。notice 为 M5(这个名字已有数据、这个目录还没记进去过),否则 null。
 *
 * @throws ProjectError invalid_name(名字不合法)、cannot_record(记不下)、no_project(git 跑不起来)
 */
export function applyInstallName(start: string, name: string): { notice: string | null } {
  const checked = checkedName(name);
  const root = findProjectRoot(start);
  if (root === null) throw new ProjectError('cannot_record', cannotRecordMessage(path.resolve(start)));
  const info = identityOfRoot(root);
  if (info === 'git-error') throw new ProjectError('no_project', gitErrorMessage(root));
  if (info.workTreeRoot === null && !isInstalled(root)) {
    throw new ProjectError('cannot_record', notInstalledMessage(root));
  }

  const next = identityWithName(info, checked);
  const unchanged = info.nameSource === 'recorded' && info.identity?.name === checked;
  if (!unchanged) {
    const siblings = listSiblingRoots(root);
    writeProjectName(root, checked);
    clearStartDirs(siblings);
  }
  return { notice: installNotice(root, next) };
}
