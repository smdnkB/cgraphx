/**
 * agent 描述登记处:新增 agent 只需在此追加一份描述(登记顺序即优先级,claude-code 永远第一)。
 */
import type { AgentProfile } from './types';

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

export const AGENT_PROFILES: readonly AgentProfile[] = [CLAUDE_CODE, CODEBUDDY];
