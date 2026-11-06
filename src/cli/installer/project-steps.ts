/**
 * 安装器中每个目录只做一次的项目级步骤(spec:2026-11-05-数据按项目放用户目录 D3、D25、D30、D31):
 * install 时问项目名称、把本地旧库并进用户目录;uninstall 时按同一仓库还有没有装着的目录处理版本分支提交拦截,
 * 删本地 `.cgraphx/` 前先并没并过的旧数据,收尾说明项目数据在哪、怎么删。按 agent 执行的步骤见 `agent-steps.ts`。
 */

import * as fs from 'node:fs';

import { getCodeGraphDir, removeDirectory } from '../../core/directory';
import { locateData } from '../../core/data-location';
import { projectDisplayName, validateProjectName } from '../../core/project-identity';
import { listOtherInstalledDirs } from '../../core/repo-projects';
import {
  applyInstallName,
  checkDuplicateName,
  hasUnmergedLegacyData,
  mergeLegacyData,
  planInstallName,
  type MergeOutcome,
} from '../../core/project';
import { removeReleaseGuard } from '../../core/release';

/** clack.d.ts 只声明了用到的那部分 @clack/prompts;问项目名称用的 text 在这里补上签名。 */
interface ClackTextPrompt {
  text(opts: {
    message: string;
    initialValue?: string;
    validate?: (value: string | undefined) => string | undefined;
  }): Promise<string | symbol>;
}
export type Clack = typeof import('@clack/prompts') & ClackTextPrompt;

/** 并旧数据这一步的名字:spinner 转着时后面接「…」,停下时原样留在屏幕上。 */
const MERGE_STEP = '把这个目录的旧数据并进用户目录';

/** mergeLegacyData 是同步的:先让 spinner 画出第一帧(clack 每 80ms 画一帧),并的过程中屏幕上才有字。 */
const SPINNER_FIRST_FRAME_MS = 100;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * install 第 ⑦ 步:记下项目名称(每个项目都问;`-y` 用默认名,交互时问,默认名打底;取消就退出安装,记不下只
 * 提示),再把本地旧库并进用户目录。不受子系统勾选影响;失败只提示,安装照常往下走(D30)。
 */
export async function settleProjectData(clack: Clack, projectRoot: string, useDefaults: boolean): Promise<void> {
  await recordProjectName(clack, projectRoot, useDefaults);
  await mergeLegacyAndReport(clack, projectRoot, hasUnmergedLegacyData(projectRoot));
}

async function recordProjectName(clack: Clack, projectRoot: string, useDefaults: boolean): Promise<void> {
  try {
    const plan = planInstallName(projectRoot);
    if (plan.defaultName === null) return;
    let name = plan.defaultName;
    if (!useDefaults) {
      const answer = await clack.text({
        message: '项目名称(同名的目录记进同一个项目)',
        initialValue: plan.defaultName,
        validate: (value) => {
          const checked = validateProjectName(value ?? '');
          return checked.ok ? undefined : checked.reason;
        },
      });
      if (clack.isCancel(answer)) {
        clack.cancel('安装已取消。');
        process.exit(0);
      }
      name = answer;
    }
    applyInstallName(projectRoot, name);
    reportDuplicateName(clack, projectRoot);
  } catch (err) {
    clack.log.warn(`没记下项目名称:${errorMessage(err)}`);
  }
}

/**
 * install 里的重名提示(spec F3、C-8):名字记下之后判断一次,命中就用 clack 打一句。判断或提示自己失败静默——
 * 名字已经记下了,这里只是顺带提示,不能落进外层变成「没记下项目名称」。
 */
function reportDuplicateName(clack: Clack, projectRoot: string): void {
  try {
    const notice = checkDuplicateName(projectRoot);
    if (notice !== null) clack.log.info(notice);
  } catch {
    // 提示不影响安装
  }
}

/**
 * 把本地旧库并进用户目录并按 M1~M4 打出结果。`pending`(有没并过的旧数据)时转着 spinner 并;没有旧数据也调
 * 一次——确保项目目录和项目库的 schema 在。mergeLegacyData 不抛,失败返回 failed。
 */
async function mergeLegacyAndReport(clack: Clack, root: string, pending: boolean): Promise<MergeOutcome> {
  let outcome: MergeOutcome;
  if (pending) {
    const s = clack.spinner();
    s.start(`${MERGE_STEP}…`);
    await new Promise((resolve) => setTimeout(resolve, SPINNER_FIRST_FRAME_MS));
    outcome = mergeLegacyData(root);
    s.stop(MERGE_STEP);
  } else {
    outcome = mergeLegacyData(root);
  }
  switch (outcome.kind) {
    case 'merged': {
      const duplicates = outcome.duplicates > 0 ? `\n其中 ${outcome.duplicates} 笔之前已经并过,只留一份` : '';
      clack.log.success(`已把 ${outcome.events} 笔提交并进项目 ${outcome.display}${duplicates}`);
      for (const notice of outcome.notices) clack.log.warn(notice);
      break;
    }
    case 'already':
      clack.log.info(outcome.mergedAt !== null ? `已经并过(${localMinute(outcome.mergedAt)})` : '已经并过');
      break;
    case 'nothing':
      break;
    case 'failed':
      clack.log.warn(`并到用户目录没成功:${outcome.reason ?? '原因不明'}`);
      break;
  }
  return outcome;
}

/** ISO 时间 → 本地时区 `YYYY-MM-DD HH:mm`;解析不了原样返回。 */
function localMinute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 卸载 ② 版本分支提交拦截(spec D12、D31):同一仓库还有装着的目录就留着——钩子目录是各个工作区共用的。 */
export function removeReleaseGuardIfAlone(clack: Clack, cwd: string): void {
  try {
    if (listOtherInstalledDirs(cwd).length > 0) return;
    const guard = removeReleaseGuard(cwd);
    if (guard.status === 'removed') {
      clack.log.success(`已移除版本分支提交拦截:${guard.hookPath}`);
    } else if (guard.notice !== undefined) {
      clack.log.warn(guard.notice);
    }
  } catch (err) {
    clack.log.warn(`移除版本分支提交拦截失败:${errorMessage(err)}(可稍后执行 cgraphx release guard --remove)`);
  }
}

/** 卸载时记下的项目数据位置(项目目录没建时 dirName 为 null)。 */
export interface ProjectDataRef { dirName: string | null; display: string | null }

function projectDataOf(start: string): ProjectDataRef {
  try {
    const loc = locateData(start);
    return { dirName: loc.projectDirName, display: loc.identity !== null ? projectDisplayName(loc.identity) : null };
  } catch {
    // 认不出数据位置只影响提示里写不写项目目录
    return { dirName: null, display: null };
  }
}

/**
 * 卸载 ③④ 本地 `.cgraphx/`:有没并过的旧数据先并进用户目录,并不过去就留着不删;删之前(并完以后)记下项目数据
 * 位置——并之前还是旧库模式拿不到项目目录,删了以后这个目录可能就认不出了。删除照 M11 确认(`-y` 不问),
 * `--keep-data` 保留。返回记下的项目数据位置。
 */
export async function removeLocalDir(
  clack: Clack,
  cwd: string,
  opts: { keepData: boolean; useDefaults: boolean },
): Promise<ProjectDataRef> {
  const localDir = getCodeGraphDir(cwd);
  if (!fs.existsSync(localDir)) return projectDataOf(cwd);
  if (opts.keepData) {
    clack.log.info(`保留 ${localDir}(--keep-data)。如需删除:rm -rf ${localDir}`);
    return projectDataOf(cwd);
  }
  if (hasUnmergedLegacyData(cwd)) {
    const outcome = await mergeLegacyAndReport(clack, cwd, true);
    if (outcome.kind === 'failed') {
      clack.log.warn(`保留 ${localDir}:旧数据没并过去,删了会丢;按提示处理后再卸载`);
      return projectDataOf(cwd);
    }
  }
  const project = projectDataOf(cwd);
  let confirmed = opts.useDefaults;
  if (!confirmed) {
    const kept = project.dirName !== null
      ? `这个目录的知识库索引和「我的需求」;项目的数据留在 ~/.cgraphx/projects/${project.dirName}/`
      : '这个目录的知识库索引和「我的需求」';
    const ans = await clack.confirm({ message: `删除 ${localDir}?(${kept})`, initialValue: true });
    if (clack.isCancel(ans)) {
      clack.cancel('卸载已取消。');
      process.exit(0);
    }
    confirmed = ans;
  }
  if (confirmed) {
    removeDirectory(cwd);
    clack.log.success(`已删除 ${localDir}`);
  } else {
    clack.log.info(`保留 ${localDir}。如需删除:rm -rf ${localDir}`);
  }
  return project;
}

/** 卸载 ⑤ 收尾:git 钩子留着 → M13;删了 → M12(项目目录不在时不打)。 */
export function reportProjectDataKept(clack: Clack, project: ProjectDataRef, gitHookKeptFor: readonly string[]): void {
  const { dirName } = project;
  if (gitHookKeptFor.length > 0) {
    const kept = `${gitHookKeptFor.join('、')} 还装着,提交照样记`;
    clack.log.info(dirName !== null ? `${kept}\n项目的数据留在 ~/.cgraphx/projects/${dirName}/` : kept);
  } else if (dirName !== null) {
    clack.log.info(
      `项目 ${project.display ?? dirName} 的数据留在 ~/.cgraphx/projects/${dirName}/\n` +
        `要删数据,用清理命令 cgraphx project remove ${dirName}`,
    );
  }
}
