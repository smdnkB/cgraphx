/**
 * commit-gate 判定主体与片段装卸(spec F2:agent 提交走 git commit-msg 钩子门禁)。
 *
 * 隐藏命令 `commit-gate-hook <说明文件>`(cli.ts)在本进程里按 D12 钉死的顺序判定:
 *   K26 版本分支 → K13 合并收尾放行 → K27 无暂存放行 → K14 产物检查 → K15 提交说明自查。
 * 打回只有三种来源(K26 / K14 / K15),退出码 0(放行)与 3(打回)之外没有别的;任何一步跑
 * 不起来(git 失败、产物检查子进程超时、输出不可解析、自身异常)都放行 —— 门禁挂了不能让人
 * 提交不了(全局约束)。只要没打回,就把 `git write-tree` 的输出写进
 * `<git 目录>/cgraphx/commit-gate-pass`(D13 记号,post-commit 链路据此判「这条提交过过门禁」)。
 *
 * 装卸(installCommitGate / removeCommitGate)经基础层 git-hooks 写/删 commit-msg 片段(C-6):
 * 片段先看会话变量(人手动提交不起 node),只有隐藏命令退出码 3 才打回。
 *
 * 只依赖 release、agents 门面与基础层 git-hooks;产物检查经子进程跑 `cgraphx features check`,
 * 不 import features 门面(spec D12)。
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { listAgentProfiles } from '../agents';
import {
  hookNotice,
  hookRemoveNotice,
  installHookSnippet,
  removeHookSnippet,
  resolveHooksDir,
  type HookSnippetResult,
} from '../git-hooks';
import { RELEASE_FLOW_CONFIG_KEY, VERSION_BRANCH_PATTERN } from '../release';
import { CommitGateError } from './errors';
import {
  artifactCheckRejectText,
  type ArtifactCheckReport,
  COMMIT_GATE_HOOK,
  COMMIT_GATE_HOOK_COMMAND,
  COMMIT_GATE_MARKER,
  FEATURES_CHECK_ARGS,
  FEATURES_CHECK_TIMEOUT_MS,
  GIT_GUIDE_RELPATH,
  noGuideRejectText,
  PASS_MARK_DIRNAME,
  PASS_MARK_FILENAME,
  PRECOMMIT_REVIEWED_ENV,
  RELEASE_COMMIT_PREFIX,
  selfCheckRejectText,
  versionBranchRejectText,
} from './constants';

// ---------- 类型 ----------

/** 判定结果:passed 放行(含一切降级与放行分支)/ rejected 打回。 */
export interface CommitGateOutcome {
  decision: 'passed' | 'rejected';
  /** rejected 时:打回提示原文(cli 写 stderr)。 */
  reason?: string;
}

/** installCommitGate 的结果:基础层的写入结果,unsupported 时带给人看的提示(hookNotice)。 */
export interface CommitGateInstallResult extends HookSnippetResult {
  notice?: string;
}

/** removeCommitGate 的结果:删过 / 没装过 / 片段提交在被跟踪的钩子文件里没删。 */
export interface CommitGateRemoveResult {
  /** 本次查看的 commit-msg 钩子文件绝对路径;不在 git 仓库时为 null */
  hookPath: string | null;
  status: 'removed' | 'absent' | 'unsupported';
  reason?: 'tracked';
  /** unsupported 时:给人看的那句提示(hookRemoveNotice) */
  notice?: string;
}

// ---------- 判定主体 ----------

/**
 * 门禁判定入口:按 D12 钉死的顺序跑五道,每道「不足以打回」就进下一道,全部走完没打回 → 放行。
 * 外层兜底:任何异常都放行;放行的出口统一写 D13 记号。
 */
export function runCommitGate(cwd: string, messageFile: string): CommitGateOutcome {
  let outcome: CommitGateOutcome;
  try {
    outcome = judge(cwd, messageFile);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[commit-gate] 门禁检查没跑成,放行:${msg}\n`);
    outcome = { decision: 'passed' };
  }
  if (outcome.decision === 'passed') writePassMark(cwd);
  return outcome;
}

function judge(cwd: string, messageFile: string): CommitGateOutcome {
  // 说明文件读不到(路径不对、权限等)→ 无从判定,放行
  const message = readMessageFile(cwd, messageFile);
  if (message === null) return { decision: 'passed' };

  // ① K26 版本分支:规则常量共用 release 门面导出的那份,与 release 拦截片段同一套判定
  const versionReason = versionBranchReject(cwd, message);
  if (versionReason !== null) return { decision: 'rejected', reason: versionReason };

  // ② K13 合并收尾:`git merge` / 冲突解决后的 `git commit` 传的说明文件就是 MERGE_MSG,说明是
  // git 生成的合并说明,不进产物检查与自查(记号照写)
  if (path.basename(messageFile) === 'MERGE_MSG') return { decision: 'passed' };

  // ③ K27 无暂存内容(`git commit --amend --no-edit` 等):没产物可查,交给 git 自己;git 跑不动也放行
  const staged = gitOutput(cwd, ['diff', '--cached', '--name-status']);
  if (staged === null || staged === '') return { decision: 'passed' };

  // ④ K14 产物检查:跑不起来(旧版 CLI / 超时 / 输出不可解析)当没查、往下走;只有 failures > 0 才打回
  const report = runArtifactCheck(cwd);
  if (report !== null && report.failures > 0) {
    return { decision: 'rejected', reason: artifactCheckRejectText(report) };
  }

  // ⑤ K15 提交说明自查:agent 已按 guide 自查过(带变量重试)→ 放行
  if (process.env[PRECOMMIT_REVIEWED_ENV] === '1') return { decision: 'passed' };
  const top = gitOutput(cwd, ['rev-parse', '--show-toplevel']);
  const hasGuide = top !== null && fs.existsSync(path.join(top, GIT_GUIDE_RELPATH));
  return { decision: 'rejected', reason: hasGuide ? selfCheckRejectText() : noGuideRejectText() };
}

/**
 * K26 版本分支:项目按版本走(release 门面的 RELEASE_FLOW_CONFIG_KEY 为 true)、当前分支匹配
 * VERSION_BRANCH_PATTERN、不在合并(没有 MERGE_HEAD)、说明第一个有内容的行不以
 * `chore(release):` 开头 → 打回,原文同 release 拦截片段那一句。配置读不到就是没按版本走,不拦。
 */
function versionBranchReject(cwd: string, message: string): string | null {
  if (gitOutput(cwd, ['config', '--bool', '--get', RELEASE_FLOW_CONFIG_KEY]) !== 'true') return null;
  const branch = gitOutput(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']);
  if (branch === null || branch === '' || !VERSION_BRANCH_PATTERN.test(branch)) return null;
  // MERGE_HEAD 读不到(ref 不在,或 git 出错)都当不在合并里 —— 与 release 拦截片段同一判定
  if (gitOutput(cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']) !== null) return null;
  const firstLine = firstMeaningfulLine(message);
  if (firstLine !== null && firstLine.startsWith(RELEASE_COMMIT_PREFIX)) return null;
  return versionBranchRejectText(branch);
}

/** 说明里第一个有内容的行(跳过 `#` 注释行与空白行 —— 编辑器里写说明时注释还没被 git 去掉)。 */
function firstMeaningfulLine(message: string): string | null {
  for (const line of message.split(/\r?\n/)) {
    if (line.startsWith('#') || /^\s*$/.test(line)) continue;
    return line;
  }
  return null;
}

/** 读提交说明文件(路径按钩子的 cwd 解析);读不到 → null。 */
function readMessageFile(cwd: string, messageFile: string): string | null {
  try {
    return fs.readFileSync(path.resolve(cwd, messageFile), 'utf8');
  } catch {
    return null;
  }
}

// ---------- K14 产物检查(经子进程,spec D12) ----------

/**
 * 子进程跑 `cgraphx features check --staged --json`,收 stdout。跑不起来(cgraphx 不在 PATH、
 * 旧版不认 `--staged`、15 秒超时、输出不可解析)→ null,当没查、往下走。写法照原
 * precommit-check.cjs;钩子环境里 GIT_INDEX_FILE 指向实际索引,子命令自己看得到暂存区,不用动它。
 */
function runArtifactCheck(cwd: string): ArtifactCheckReport | null {
  try {
    const result = spawnSync('cgraphx', FEATURES_CHECK_ARGS, {
      cwd,
      encoding: 'utf8',
      timeout: FEATURES_CHECK_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      // Windows 上 cgraphx 是 .cmd / .ps1,得经 shell 才找得到
      shell: process.platform === 'win32',
    });
    if (result.error !== undefined) return null; // 含超时(ETIMEDOUT)
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    if (stdout.trim() === '') return null; // 旧版 cgraphx 不认 --staged 时 stdout 为空
    return parseArtifactReport(stdout);
  } catch {
    return null;
  }
}

/** 解析并校验产物检查的 JSON 输出(failures 是数字、findings 是数组);不合法 → null。 */
function parseArtifactReport(stdout: string): ArtifactCheckReport | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const failures = record['failures'];
  const findings = record['findings'];
  if (typeof failures !== 'number' || !Array.isArray(findings)) return null;
  const items: ArtifactCheckReport['findings'][number][] = [];
  for (const raw of findings) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    items.push({
      level: typeof item['level'] === 'string' ? item['level'] : '',
      path: typeof item['path'] === 'string' ? item['path'] : '',
      message: typeof item['message'] === 'string' ? item['message'] : '',
      fix: typeof item['fix'] === 'string' ? item['fix'] : null,
    });
  }
  return { failures, findings: items };
}

// ---------- D13 过门禁记号 ----------

/**
 * 把 `git write-tree` 的输出(暂存区对应的 tree,只写对象、不动索引)写进
 * `<git 目录>/cgraphx/commit-gate-pass`。写失败只 stderr 一句,不影响放行。
 */
function writePassMark(cwd: string): void {
  try {
    const gitDir = gitOutput(cwd, ['rev-parse', '--absolute-git-dir']);
    const tree = gitOutput(cwd, ['write-tree']);
    if (gitDir === null || tree === null) {
      process.stderr.write('[commit-gate] 没写成过门禁记号:取不到 git 目录或 write-tree 输出,不影响提交\n');
      return;
    }
    fs.mkdirSync(path.join(gitDir, PASS_MARK_DIRNAME), { recursive: true });
    fs.writeFileSync(path.join(gitDir, PASS_MARK_DIRNAME, PASS_MARK_FILENAME), `${tree}\n`, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[commit-gate] 没写成过门禁记号,不影响提交:${msg}\n`);
  }
}

// ---------- commit-msg 片段与装卸(C-5、C-6) ----------

/**
 * 门禁的 commit-msg 片段:先看会话变量(名单来自 agents 描述的 sessionIdEnv)—— 一个都没设就是
 * 人手动提交,不起 node(人每次提交多等约 90ms 是 spec 明确不要的);有才经 PATH 调隐藏命令,输出
 * 收进变量、只有退出码 3 才回显打回原文并 exit 1(command not found、旧版报未知命令、任何异常都
 * 放行)。命令替换后接 `|| 赋值`:钩子是 `#!/bin/sh -e` 这类写法时命令失败不会让整个钩子提前
 * 退出,同现有片段;会话变量探针带 `:-` 默认值,`set -u` 下也不炸。没有任何已登记变量时探针串
 * 为空,`[ -n "" ]` 恒假,node 永远不起。每行带 marker,重装按 marker 先删旧行(基础层负责)。
 */
function commitGateSnippetLines(sessionVars: readonly string[]): string[] {
  const probe = sessionVars.map((name) => `\${${name}:-}`).join('');
  return [
    `${COMMIT_GATE_MARKER} — agent 提交的门禁(版本分支拦截 + 产物检查 + 提交说明自查);没有任何会话变量时不起 node`,
    `if [ -n "${probe}" ]; then __cgx_gate=0; __cgx_msg=$(cgraphx ${COMMIT_GATE_HOOK_COMMAND} "$1" 2>&1) || __cgx_gate=$?; if [ "$__cgx_gate" -eq 3 ]; then printf '%s\n' "$__cgx_msg" >&2; exit 1; fi; fi ${COMMIT_GATE_MARKER}`,
  ];
}

/**
 * 在 cwd 所在仓库的 commit-msg 钩子里装上门禁片段。不在 git 仓库 → 抛
 * CommitGateError(not_git_repo)。没写入 → 原样返回 unsupported(带 reason、要用户自己加的
 * 几行和 hookNotice 提示),由 install / uninstall 消费。
 */
export function installCommitGate(cwd: string): CommitGateInstallResult {
  if (resolveHooksDir(cwd) === null) {
    throw new CommitGateError('not_git_repo', `${path.resolve(cwd)} 不在 git 仓库里,装不了提交门禁`);
  }
  const sessionVars = listAgentProfiles()
    .map((profile) => profile.sessionIdEnv)
    .filter((name): name is string => name !== null);
  const snippet = installHookSnippet(cwd, COMMIT_GATE_HOOK, COMMIT_GATE_MARKER, commitGateSnippetLines(sessionVars));
  if (snippet === null) throw new CommitGateError('not_git_repo');
  if (snippet.status !== 'unsupported') return { ...snippet };
  const notice = hookNotice(snippet, '没装上提交门禁');
  return notice === null ? { ...snippet } : { ...snippet, notice };
}

/**
 * 从 cwd 所在仓库的 commit-msg 钩子删掉门禁片段。删过 → removed;没装过 / 不在 git 仓库 →
 * absent(hookPath 为 null 时是不在仓库);片段提交在被跟踪的钩子文件里 → unsupported
 * (reason tracked,带 hookRemoveNotice 提示)。
 */
export function removeCommitGate(cwd: string): CommitGateRemoveResult {
  const hooksDir = resolveHooksDir(cwd);
  if (hooksDir === null) return { hookPath: null, status: 'absent' };
  const removed = removeHookSnippet(cwd, COMMIT_GATE_HOOK, COMMIT_GATE_MARKER);
  if (removed === null) return { hookPath: path.join(hooksDir, COMMIT_GATE_HOOK), status: 'absent' };
  if (removed.status === 'unsupported') {
    const notice = hookRemoveNotice(removed, '门禁那几行');
    return {
      hookPath: removed.hookPath,
      status: 'unsupported',
      reason: 'tracked',
      ...(notice !== null ? { notice } : {}),
    };
  }
  return { hookPath: removed.hookPath, status: removed.status };
}

// ---------- 基础 git 调用 ----------

/** 在 cwd 下跑 git,返回去掉首尾空白的 stdout;失败(不在仓库、git 不可用、非零退出)→ null。 */
function gitOutput(cwd: string, args: readonly string[]): string | null {
  try {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (result.error !== undefined || result.status !== 0) return null;
    return typeof result.stdout === 'string' ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}
