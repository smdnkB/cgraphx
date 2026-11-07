/**
 * 会话提示:撤掉会话开始 hook 后,原来会话开始给的三条提示改由「这个会话第一条 cgraphx 命令」输出
 * (spec 2026-11-06-会话文件解析替代hooks F4 / D16、K17–K20)。判断函数与提示原文原出自会话开始
 * hook(hook 体系已随本需求整体删除):
 *   ① skill 版本落后(K18):有会话变量看那家 agent,没有看各家;只看在这个项目里装过的,任一家落后出一条(提示里带具体版本);
 *   ② 自动记忆去向(K19):仅 Claude Code 会话且本人本地设置关了自动记忆;终端里自己跑不算;
 *   ③ 按登记补回缺了的 git 钩子片段(K20),补不上的说一次原因(登记已由基础层删掉,不会每次重试)。
 *
 * scope 与频控(C-9):有会话变量 → `session:<会话编号>`,同一会话只提示一次;没有 →
 * `day:<项目根>:<本地日期>`,每个项目每天第一条一次。记录存 sessions.db 的 notices_shown
 * (打开时顺手删 30 天前的行,在 session-index 里)。排除「不算一条」的命令是调用方的事
 * (cli/index.ts 的 postAction 挂点按名单排除)。
 *
 * 整体 try/catch:提示绝不影响命令——哪条判断出错哪条不出,其余照出;输出只写 stderr,
 * `--json` 的 stdout 不混入。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { resolveProjectRoot } from './directory';
import { hookNotice, repairHookSnippets } from './git-hooks';
import {
  agentConfigDir,
  DEFAULT_AGENT_ID,
  isAgentInstalled,
  listAgentProfiles,
  requireAgentProfile,
  resolveSessionIdFromEnv,
  type AgentProfile,
  type SessionFromEnv,
} from './agents';
import { skillVersionNotice } from './skill-version';
import { openSessionIndex } from './session-index';

/** 本地日期(YYYY-MM-DD):day scope 按本地日历天,不按 UTC(和人们说的「今天」一致)。 */
function localDateString(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 本次调用的提示 scope(C-9):有会话变量按会话,没有按项目根 + 本地日期。 */
function noticeScope(session: SessionFromEnv | null, projectRoot: string): string {
  return session !== null ? `session:${session.sessionId}` : `day:${projectRoot}:${localDateString()}`;
}

/**
 * 版本落后提示(直接调 skill-version 门面):无需提示或任何异常都 → null,不拖累其他提示。
 * 只看这个项目里装过 cgraphx 的 agent:命令在哪个目录都能跑,没装过的目录、没装过的那家 agent
 * 没有版本记录,不能当成「2.0.11 之前装的」。
 */
function skillVersionNoticeSafe(session: SessionFromEnv | null, projectRoot: string): string | null {
  try {
    // 命令没有「会话开始类型」一说,source 恒 undefined(按 startup 处理,不静默)。
    const candidates = session !== null ? [requireAgentProfile(session.agent)] : listAgentProfiles();
    const profiles = candidates.filter((profile) => isAgentInstalled(projectRoot, profile));
    for (const profile of profiles) {
      const notice = skillVersionNotice(projectRoot, profile, undefined);
      if (notice !== null) return notice;
    }
    return null;
  } catch (err) {
    process.stderr.write(`[cgraphx] skill version notice failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return null;
  }
}

/** Claude Code 本人的本地设置文件(不签入),`autoMemoryEnabled` 写在这里。 */
const CLAUDE_LOCAL_SETTINGS_FILE = 'settings.local.json';

/**
 * 本项目是否关了 Claude Code 自动记忆:只看本人本地设置里 `autoMemoryEnabled` 是否为 false;
 * 其他 agent、文件不存在、读不出或不是 JSON 对象一律按没关处理。
 */
function isAutoMemoryOff(projectRoot: string, profile: AgentProfile): boolean {
  if (profile.id !== DEFAULT_AGENT_ID) return false;
  try {
    const file = path.join(agentConfigDir(projectRoot, profile), CLAUDE_LOCAL_SETTINGS_FILE);
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    return (parsed as { autoMemoryEnabled?: unknown }).autoMemoryEnabled === false;
  } catch {
    return false;
  }
}

/** 关了自动记忆以后,用户说「以后都这样做」时先问去向;只讲去向,不提还有没迁的记忆。 */
function autoMemoryOffContext(): string {
  return (
    '本项目已关 Claude Code 自动记忆:用户要你以后都照某个做法来时,先问记到哪——' +
    '知识库(项目里的决策、规则、教训,走 /knowledge-write)/ 项目约定(每轮都要守的,写进项目根目录 CLAUDE.md)/ ' +
    '你个人的设置(只关于本人的偏好,写进 ~/.claude/CLAUDE.md)。'
  );
}

/** 自动记忆去向提示:仅 Claude Code 会话且本人关了自动记忆时给出原文;终端里自己跑不算;任何异常 → null。 */
function autoMemoryOffNotice(session: SessionFromEnv | null, projectRoot: string): string | null {
  if (session === null) return null;
  try {
    const profile = requireAgentProfile(session.agent);
    return isAutoMemoryOff(projectRoot, profile) ? autoMemoryOffContext() : null;
  } catch (err) {
    process.stderr.write(`[cgraphx] auto memory notice failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return null;
  }
}

/**
 * spec K20:按登记补回缺了的 git 钩子片段(husky 9 每次装依赖都重写 `.husky/_/`、新开的
 * worktree、被别的工具覆盖)。补不上的(登记已由基础层删掉)返回给人看的原因,只说一次;不在 git
 * 仓库、没有登记或任何异常都返回 [],不影响命令。
 */
function repairGitHookSnippets(cwd: string): string[] {
  try {
    return repairHookSnippets(cwd)
      .map((r) => hookNotice(
        r,
        // commit-msg 里是提交门禁片段和版本分支拦截片段(补回结果分不出是哪个,说法并提);其余是提交记录片段
        path.basename(r.hookPath) === 'commit-msg'
          ? '提交门禁、版本分支拦截片段没补上'
          : '提交记录片段没补上',
      ))
      .filter((n): n is string => n !== null);
  } catch {
    // 补装失败只等下一条命令或 cgraphx install 再补
    return [];
  }
}

/**
 * 出会话提示(这个会话 / 今天的第一条 cgraphx 命令):判 scope → 已提示过直接返回 → 三条判断 →
 * 有就逐行写 stderr(带 `[cgraphx]` 前缀)→ 记 scope。一条都没有就什么都不写、不记(下次命令照查,
 * 免得一次空跑把当天真正该提示的压掉);补片段的动作只要还没提示过就照做。整体 try/catch,
 * 任何失败只是不出提示,绝不影响命令本身。
 */
export function emitSessionNotices(cwd: string): void {
  try {
    const session = resolveSessionIdFromEnv();
    const projectRoot = resolveProjectRoot(cwd);
    const scope = noticeScope(session, projectRoot);
    const index = openSessionIndex(); // 打开时顺手删 30 天前的提示记录(C-3)
    try {
      if (index.noticeShownAt(scope) !== null) return;
      const notices = [
        skillVersionNoticeSafe(session, projectRoot),
        autoMemoryOffNotice(session, projectRoot),
        ...repairGitHookSnippets(cwd),
      ].filter((n): n is string => n !== null);
      if (notices.length === 0) return;
      for (const notice of notices) {
        process.stderr.write(`[cgraphx] ${notice}\n`);
      }
      index.recordNoticeShown(scope);
    } finally {
      index.close();
    }
  } catch {
    // 提示不影响命令,吞掉
  }
}
