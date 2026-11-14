/**
 * agent 唯一登记处(登记顺序即优先级,claude-code 永远第一)。
 * 每个登记项绑定安装描述、会话来源和会话读取实现;只读来源不提供安装描述。
 */
import * as path from 'node:path';
import type { AgentProfile, SessionSource } from './types';
import type { AgentInstallationAdapter, AgentSessionAdapter } from './adapter';
import { DEEPSEEK_SOURCE, profileSource } from './sources';
import { createSessionAdapter, factSessionId, noParent, parentSessionFile, pathSessionId } from './session/create';
import { readClaudeSessionFacts } from './session/claude-transcript';
import { readCodebuddySessionFacts } from './session/codebuddy-transcript';
import { codexRootSessionId, readCodexSessionFacts } from './session/codex-session';
import { readDeepSeekSessionFacts } from './session/deepseek-session';
import type { SessionFact, SessionFactsReader } from './session/types';

/** Claude Code 描述:取值即改造前的行为基线,改动会破坏零变化保证。 */
const CLAUDE_CODE: AgentProfile = {
  id: 'claude-code',
  displayName: 'Claude Code',
  legacyIds: ['claude'],
  configDirName: '.claude',
  instructionsFileName: 'CLAUDE.md',
  extraConfigFiles: ['.mcp.json'],
  settingsFileName: 'settings.json',
  projectDirEnv: 'CLAUDE_PROJECT_DIR',
  sessionIdEnv: 'CLAUDE_CODE_SESSION_ID',
  sessionsDir: ['.claude', 'projects'],
  sessionsDirEnv: 'CLAUDE_CONFIG_DIR',
  sessionReader: 'claude-transcript',
  capabilities: { statusLine: true, contextMonitor: true },
  assetReplacements: [],
};

/**
 * CodeBuddy 描述:部署到 .codebuddy/,不支持 statusLine 与 context-monitor。
 * - sessionIdEnv:实测 CodeBuddy 2.167.0 向 Bash 子进程注入 CODEBUDDY_SESSION_ID(值即会话文件的 session_id)。
 */
const CODEBUDDY: AgentProfile = {
  id: 'codebuddy',
  displayName: 'CodeBuddy',
  legacyIds: [],
  configDirName: '.codebuddy',
  instructionsFileName: 'CODEBUDDY.md',
  extraConfigFiles: [],
  settingsFileName: 'settings.json',
  projectDirEnv: 'CODEBUDDY_PROJECT_DIR',
  sessionIdEnv: 'CODEBUDDY_SESSION_ID',
  sessionsDir: ['.codebuddy', 'projects'],
  sessionsDirEnv: null,
  sessionReader: 'codebuddy-transcript',
  capabilities: { statusLine: false, contextMonitor: false },
  // 顺序即替换顺序:先替换目录路径,再替换指引文件名与环境变量
  assetReplacements: [
    ['.claude/', '.codebuddy/'],
    ['CLAUDE.md', 'CODEBUDDY.md'],
    ['CLAUDE_PROJECT_DIR', 'CODEBUDDY_PROJECT_DIR'],
    ['CLAUDE_CODE_SESSION_ID', 'CODEBUDDY_SESSION_ID'],
  ],
};

const CODEX: AgentProfile = {
  id: 'codex', displayName: 'Codex', legacyIds: [],
  configDirName: '.agents', instructionsFileName: 'AGENTS.md', instructionsAtRoot: true,
  extraConfigFiles: ['.codex'], settingsFileName: 'settings.json', settingsFormat: 'none', projectDirEnv: 'PWD',
  sessionIdEnv: 'CODEX_THREAD_ID', sessionsDir: ['.codex', 'sessions'], sessionsDirEnv: null,
  sessionReader: 'codex-session', capabilities: { statusLine: false, contextMonitor: false },
  sessionRoot: (env, userHome) => path.join(env['CODEX_HOME']?.trim() || path.join(userHome, '.codex'), 'sessions'),
  sessionFileLayout: 'recursive-jsonl',
  assetTopLevel: ['skills', 'FLOW-MAP.md'],
  excludedAssetPaths: ['skills/knowledge-migrate'],
  managedRootAssets: ['FLOW-MAP.md'],
  transformAssetText: content => content.replace(/(^|[\s`（(：:])\/(dev|init|release|api|ui|unit|doc|knowledge|code|audit|db|cgraphx)-([\w-]+)/gm, '$1$$$2-$3'),
  assetReplacements: [['.claude/CLAUDE.md', 'AGENTS.md'], ['.claude/', '.agents/'], ['CLAUDE.md', 'AGENTS.md'],
    ['`FLOW-MAP.md`', '`.agents/FLOW-MAP.md`'],
    ['CLAUDE_PROJECT_DIR', 'PWD'], ['CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID'],
    ['AskUserQuestion', '用户输入工具']],
};

export interface AgentRegistration {
  readonly profile: AgentProfile | null;
  readonly source: SessionSource;
  readonly sessions: AgentSessionAdapter<SessionFact>;
  /** 宿主需要特殊安装逻辑时覆盖默认安装器;只读来源不提供此项。 */
  readonly installation?: AgentInstallationAdapter;
}

function register(
  profile: AgentProfile | null,
  source: SessionSource,
  read: SessionFactsReader,
  parent: (file: string) => string | null,
  sessionId: AgentSessionAdapter<SessionFact>['sessionIdForFile'],
  root?: AgentSessionAdapter<SessionFact>['resolveRootSessionId'],
  installation?: AgentInstallationAdapter,
): AgentRegistration {
  return { profile, source, sessions: createSessionAdapter(source, read, parent, sessionId, root), installation };
}

/** 要接入新 agent:提供 profile/source 与读取器,并在这里增加一项。 */
export const AGENT_REGISTRATIONS: readonly AgentRegistration[] = [
  register(CLAUDE_CODE, profileSource(CLAUDE_CODE), readClaudeSessionFacts, parentSessionFile, pathSessionId),
  register(CODEBUDDY, profileSource(CODEBUDDY), readCodebuddySessionFacts, parentSessionFile, pathSessionId),
  register(CODEX, profileSource(CODEX), readCodexSessionFacts, noParent, factSessionId,
    async (context, sessionId) => codexRootSessionId(sessionId, context)),
  register(null, DEEPSEEK_SOURCE, readDeepSeekSessionFacts, noParent, factSessionId),
];

/** 启动时校验登记,避免同名来源或读取器被静默遮盖。 */
function validateRegistrations(registrations: readonly AgentRegistration[]): void {
  const ids = new Set<string>();
  const readers = new Set<string>();
  for (const item of registrations) {
    if (item.profile && item.profile.id !== item.source.id) throw new Error(`agent 描述与会话来源 id 不一致: ${item.source.id}`);
    if (!item.profile && item.installation) throw new Error(`只读来源不能提供安装器: ${item.source.id}`);
    if (ids.has(item.source.id)) throw new Error(`重复的 agent id: ${item.source.id}`);
    if (readers.has(item.source.sessionReader)) throw new Error(`重复的会话读取器 id: ${item.source.sessionReader}`);
    ids.add(item.source.id);
    readers.add(item.source.sessionReader);
  }
}
validateRegistrations(AGENT_REGISTRATIONS);

export const AGENT_PROFILES: readonly AgentProfile[] = AGENT_REGISTRATIONS.flatMap(item => item.profile ? [item.profile] : []);
export const AGENT_IDS: readonly string[] = AGENT_PROFILES.map(item => item.id);
export const SESSION_READER_IDS: readonly string[] = AGENT_REGISTRATIONS.map(item => item.source.sessionReader);

export function listSessionSources(): readonly SessionSource[] {
  return AGENT_REGISTRATIONS.map(item => ({
    ...item.source,
    sessionIdEnvNames: item.sessions.sessionIdEnvNames,
    sessionFromEnvironment: context => item.sessions.sessionFromEnvironment(context),
  }));
}

export function sessionAdapterFor(readerId: string): AgentSessionAdapter<SessionFact> {
  const item = AGENT_REGISTRATIONS.find(entry => entry.source.sessionReader === readerId);
  if (!item) throw new Error(`未知会话文件读取器: ${readerId}`);
  return item.sessions;
}
