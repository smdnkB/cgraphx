/**
 * 只读会话来源(sources 层,plan D12):「有哪些 agent 的会话文件可以读」的统一登记处。
 *
 * 完整安装来源由 AGENT_PROFILES 派生,deepseek 是独立的只读来源——只读它的会话文件进时间线,
 * 不进安装器 / 副本;会话 id 进提交归属、门禁与会话
 * 提示,所以没有 AgentProfile、AGENT_PROFILES 一行不动。补录与重建(timeline/ingest/)只经
 * listSessionSources() 枚举会话文件,不再各自拼「描述 + 根目录 + 列举」;claude/codebuddy 的目录
 * 布局列举(含 subagents/ 递归)也搬到了这里——agents 不再伸手进 timeline 的内部模块。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import type { AgentProfile, SessionSource } from './types';
import type { AgentSessionEnvironmentAdapter } from './adapter';

function sessionEnvironment(name: string | null): AgentSessionEnvironmentAdapter {
  const names = name ? [name] : [];
  return {
    sessionIdEnvNames: names,
    sessionFromEnvironment(context) {
      for (const envName of names) {
        const sessionId = context.env[envName]?.trim();
        if (sessionId) return { sessionId, envName };
      }
      return null;
    },
  };
}

/**
 * 会话文件根目录(如 `~/.claude/projects`):`sessionsDirEnv` 的环境变量设了(非空)以它为根拼 `sessionsDir`,
 * 否则家目录拼;`sessionsDir` 为 null(agent 会话文件不在固定位置)→ null。
 */
export function agentSessionsRoot(profile: AgentProfile, env: Readonly<NodeJS.ProcessEnv> = process.env, userHome: string = os.homedir()): string | null {
  if (profile.sessionsDir === null) return null;
  const override = profile.sessionsDirEnv !== null ? env[profile.sessionsDirEnv]?.trim() : undefined;
  return path.join(override ? override : userHome, ...profile.sessionsDir);
}

// ─── claude / codebuddy 目录布局列举(自 timeline/ingest/reader.ts 整体移入)─────────

/** 递归列出目录下全部 .jsonl(subagents/ 里还有 workflows/ 一层嵌套布局)。 */
function listJsonlRecursive(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // 目录不在 / 不可读:跳过
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listJsonlRecursive(full, out);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full);
  }
}

/**
 * 列出某个 sessionsRoot 下全部会话文件(绝对路径,升序)。
 * 根目录不存在(agent 没装 / 没开过会话)返回空数组,不抛错。
 * 布局:sessionsRoot 下每个项目目录里的 `*.jsonl` 主会话文件,加各会话目录 subagents/ 下
 * (含 workflows/ 嵌套)的全部 `*.jsonl` 子 agent 文件;项目目录名是路径有损编码,归属判定
 * 不看目录名、只看文件行内 cwd,因此这里不做任何目录名反解。升序保证同一会话的主文件排在
 * 它 subagents/ 下的文件前面(会话头先到先得)。
 */
export function listSessionFiles(sessionsRoot: string): string[] {
  const out: string[] = [];
  let projects: fs.Dirent[];
  try {
    projects = fs.readdirSync(sessionsRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue; // .DS_Store 等杂项不进
    const projectDir = path.join(sessionsRoot, project.name);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        out.push(path.join(projectDir, entry.name)); // 主会话文件
      } else if (entry.isDirectory()) {
        const subagentsDir = path.join(projectDir, entry.name, 'subagents');
        if (fs.existsSync(subagentsDir)) listJsonlRecursive(subagentsDir, out);
      }
    }
  }
  out.sort();
  return out;
}

// ─── DeepSeek Harness 只读来源(spec D13)─────────────────────────────────────────

/** DeepSeek 会话文件名(会话目录下固定这个名字,version 4)。列举(sources)与找父会话头
 *  (timeline 的读取器)共用这一份——只在这里改,别处不会漂移。 */
export const DEEPSEEK_SESSION_FILENAME = 'session.v4.jsonl.zstd';

/**
 * DeepSeek 家目录环境变量:和 DeepSeek 自己的约定一致,它指的就是 `~/.dsh` 这一层。设了且非空 →
 * 会话在 `$DSH_HOME/sessions/`;没设 → `~/.dsh/sessions/`。
 */
const DEEPSEEK_HOME_ENV = 'DSH_HOME';

/**
 * 列出 DeepSeek 会话根目录下全部会话文件:`<root>/<一级目录>/<会话编号>/session.v4.jsonl.zstd`,
 * 按路径升序。根目录不存在返回空数组,不抛错。
 */
function listDeepSeekSessionFiles(root: string): string[] {
  const out: string[] = [];
  let groups: fs.Dirent[];
  try {
    groups = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const group of groups) {
    if (!group.isDirectory()) continue;
    const groupDir = path.join(root, group.name);
    let sessions: fs.Dirent[];
    try {
      sessions = fs.readdirSync(groupDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue;
      const file = path.join(groupDir, session.name, DEEPSEEK_SESSION_FILENAME);
      try {
        if (fs.statSync(file).isFile()) out.push(file);
      } catch {
        // 文件不在:跳过
      }
    }
  }
  out.sort();
  return out;
}

/** deepseek 来源实例(单例;读取器在 timeline/ingest/deepseek-session.ts)。 */
export const DEEPSEEK_SOURCE: SessionSource = {
  ...sessionEnvironment('DSH_SESSION_ID'),
  id: 'deepseek',
  displayName: 'DeepSeek',
  sessionsRoot: (env = process.env, userHome = os.homedir()) => {
    const override = env[DEEPSEEK_HOME_ENV]?.trim();
    return override ? path.join(override, 'sessions') : path.join(userHome, '.dsh', 'sessions');
  },
  listFiles: listDeepSeekSessionFiles,
  sessionIdEnv: 'DSH_SESSION_ID',
  sessionReader: 'deepseek-session',
  // zstdDecompressSync 是 Node 22.15+ 才有的实验性 API;engines 下限不抬(全局约束),读不了就跳过并提示
  unavailableReason: () =>
    typeof zlib.zstdDecompressSync === 'function' ? null : 'DeepSeek 会话要 Node 22.15 以上,没有读取',
};

// ─── 登记 ────────────────────────────────────────────────────────────────────

/** 已登记 agent 的会话来源(sessionsRoot 即 agentSessionsRoot 语义,含环境变量覆盖)。 */
export function profileSource(profile: AgentProfile): SessionSource {
  return {
    ...sessionEnvironment(profile.sessionIdEnv),
    id: profile.id,
    displayName: profile.displayName,
    sessionsRoot: (env = process.env, userHome = os.homedir()) => profile.sessionRoot
      ? profile.sessionRoot(env, userHome) : agentSessionsRoot(profile, env, userHome),
    listFiles: profile.sessionFileLayout === 'recursive-jsonl' ? listCodexFiles : listSessionFiles,
    sessionIdEnv: profile.sessionIdEnv,
    sessionReader: profile.sessionReader,
    unavailableReason: () => null,
  };
}

function listCodexFiles(root: string): string[] {
  const files: string[] = [];
  listJsonlRecursive(root, files);
  return files.sort();
}
