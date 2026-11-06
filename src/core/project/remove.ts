/**
 * 删除用户目录里一个项目的数据(spec:2026-11-05-数据按项目放用户目录 D33;F5;设计验收 10)
 *
 * 只删 `~/.cgraphx/projects/` 下的一级真实目录:目录名含路径分隔符、以 `.` 开头(含 `.`、`..`、临时目录)的不认;
 * 链接、文件、按 realpath 不在 `projects/` 下的一律拒绝。planRemoval 出预览,executeRemoval 删之前再核一遍目标。
 * 删的时候有 hook 在写照样删;还装着的目录之后再干活会重新建项目目录记起来(M17 提示)。
 * 删完整项目数据后把标识记进用户级 sessions.db 的 removed_projects(K3:补录按它过滤,删掉的内容不再捡回来;
 * spec 2026-11-06-会话文件解析替代hooks D2)。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { isInitialized } from '../directory';
import { projectDisplayName, type ProjectIdentity } from '../project-identity';
import { openSessionIndex } from '../session-index';
import { BACKUPS_DIRNAME, projectsRoot, readIdentityFile } from '../user-data-dir';
import { DB_PROFILES_FILENAME, REMOVE_MAX_RETRIES } from './constants';
import { ProjectError } from './errors';
import { backupsSummary, readSummaryQuietly } from './list';
import { displayPath } from './show';
import type { RemovalPlan } from './types';

/** 预览里列的配置文件(在的才列)。项目里的残留 `task-source.json` 由升级清理删,不列。 */
const CONFIG_FILENAMES = [DB_PROFILES_FILENAME] as const;

/** 删目录:碰上正在写的 hook(目录非空、文件被占)重试几次。 */
const RM_OPTIONS: fs.RmOptions = { recursive: true, force: true, maxRetries: REMOVE_MAX_RETRIES };

function realpathOrResolve(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** 装过(`.cgraphx/cgraphx.db` 在);判断出错按没装过。 */
function isInstalled(dir: string): boolean {
  try {
    return isInitialized(dir);
  } catch {
    return false;
  }
}

/** lstat;不在(含上级不是目录)→ undefined,其余错误照抛。 */
function lstatOrUndefined(p: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(p, { throwIfNoEntry: false });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOTDIR') return undefined;
    throw err;
  }
}

/** 只是一级目录名:非空,不含路径分隔符和 NUL,不以 `.` 开头(`.`、`..`、建目录用的临时目录都算)。 */
function isPlainDirName(dirName: string): boolean {
  return (
    dirName !== '' &&
    !dirName.includes('/') &&
    !dirName.includes('\\') &&
    !dirName.includes('\0') &&
    !dirName.startsWith('.')
  );
}

/**
 * 核对删除目标:`projects/` 下的一级真实目录,返回它的绝对路径。
 *
 * @throws ProjectError unsafe_target(不是一级目录名、是链接或文件、不在 projects/ 下)、not_found(不在)
 */
function resolveTarget(dirName: string): string {
  const root = projectsRoot();
  const shownRoot = `${displayPath(root)}${path.sep}`;
  if (!isPlainDirName(dirName)) {
    throw new ProjectError(
      'unsafe_target',
      `${dirName} 不是项目数据目录名,只能删 ${shownRoot} 下的一级目录;用 cgraphx project list 查看目录名`,
    );
  }
  const target = path.join(root, dirName);
  const stat = lstatOrUndefined(target);
  if (stat === undefined) {
    throw new ProjectError('not_found', `没有项目数据目录 ${dirName};用 cgraphx project list 查看`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new ProjectError(
      'unsafe_target',
      `${displayPath(target)} 不是真实目录(是链接或文件),不删;用 cgraphx project list 查看项目数据目录`,
    );
  }
  if (realpathOrResolve(path.dirname(target)) !== realpathOrResolve(root)) {
    throw new ProjectError('unsafe_target', `${displayPath(target)} 不在 ${shownRoot} 下,不删`);
  }
  return target;
}

/**
 * `cgraphx project remove <目录名>` 的预览:显示名(identity.json 读不出用目录名)、事件数、会话数、在的配置文件、
 * 备份;lines 照 C-13。只读。
 *
 * @throws ProjectError unsafe_target、not_found
 */
export function planRemoval(dirName: string, opts: { backupsOnly: boolean }): RemovalPlan {
  const dir = resolveTarget(dirName);
  const identity = readIdentityFile(dir);
  const display = identity !== null ? projectDisplayName(identity) : dirName;
  const summary = readSummaryQuietly(dir);
  const events = summary?.events ?? 0;
  const sessions = summary?.sessions ?? 0;
  const configs: string[] = CONFIG_FILENAMES.filter((name) => fs.existsSync(path.join(dir, name)));
  const backups = backupsSummary(dir);
  const configText = configs.length > 0 ? configs.join('、') : '无';
  const lines = opts.backupsOnly
    ? [`将删除 ${display} 的 ${backups.count} 份备份`]
    : [
        `将删除 ${display}(${displayPath(dir)}${path.sep}):${events} 条事件、${sessions} 个会话、配置(${configText})、${backups.count} 份备份`,
      ];
  return { dirName, dir, display, backupsOnly: opts.backupsOnly, events, sessions, configs, backups, lines };
}

/** timeline 记下的根里目录还在、还装着 cgraphx 的(删完之后再干活会重新记)。 */
function stillInstalledRoots(dir: string): string[] {
  const roots = readSummaryQuietly(dir)?.roots ?? [];
  return roots.map((r) => r.root).filter((root) => fs.existsSync(root) && isInstalled(root));
}

/**
 * 把删掉的项目标识记进 sessions.db 的 removed_projects(K3)。删完整项目数据后调;sessions.db 打不开、写不上
 * 都不报错——删除本身已经完成,只是之后补录可能把会话再捡回来。
 */
function recordRemovedProject(identity: ProjectIdentity): void {
  try {
    const index = openSessionIndex();
    try {
      index.recordRemovedProject(identity);
    } finally {
      index.close();
    }
  } catch {
    // 用户目录写不了:不影响删除结果
  }
}

/**
 * 按预览删:backupsOnly 只删 `backups/`,否则删整个项目目录。删之前再核一遍目标(预览到确认之间目录可能换成了链接)。
 * lines 为 M16 / M17 / 只删备份那句。
 *
 * @throws ProjectError unsafe_target、not_found
 */
export function executeRemoval(plan: RemovalPlan): { lines: string[] } {
  const dir = resolveTarget(plan.dirName);
  if (path.resolve(plan.dir) !== dir) {
    throw new ProjectError(
      'unsafe_target',
      `预览里的目录 ${displayPath(plan.dir)} 和 ${plan.dirName} 对不上,不删;重新运行 cgraphx project remove ${plan.dirName}`,
    );
  }
  if (plan.backupsOnly) {
    fs.rmSync(path.join(dir, BACKUPS_DIRNAME), RM_OPTIONS);
    return { lines: [`已删除 ${plan.display} 的 ${plan.backups.count} 份备份`] };
  }
  const stillInstalled = stillInstalledRoots(dir);
  // 标识在删之前读:identity.json 在被删的目录里;读不出(没有、坏了)不记,不报错
  const identity = readIdentityFile(dir);
  fs.rmSync(dir, RM_OPTIONS);
  if (identity !== null) recordRemovedProject(identity);
  const lines = [`已删除 ${plan.display} 的数据`];
  if (stillInstalled.length === 0) {
    lines.push(`${plan.events} 条事件、${plan.sessions} 个会话、配置和备份`);
  } else {
    lines.push(`这 ${stillInstalled.length} 个目录还装着 cgraphx,之后再干活会重新记`);
    for (const root of stillInstalled) lines.push(`  ${displayPath(root)}`);
  }
  return { lines };
}
