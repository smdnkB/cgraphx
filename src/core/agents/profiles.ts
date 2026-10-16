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
  settingsFileName: 'settings.json',
  projectDirEnv: 'CLAUDE_PROJECT_DIR',
  sessionIdEnv: 'CLAUDE_CODE_SESSION_ID',
  cliCommands: ['claude'],
  writeTools: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
  capabilities: { statusLine: true, contextMonitor: true, postToolUseFailure: true },
  assetReplacements: [],
};

/**
 * CodeBuddy 描述:部署到 .codebuddy/,不支持 statusLine 与 context-monitor。
 * - sessionIdEnv:实测 CodeBuddy 2.167.0 向 Bash 子进程注入 CODEBUDDY_SESSION_ID(值即 hook payload 的 session_id)。
 * - cliCommands / writeTools:实测命令名为 codebuddy;写类工具与 Claude Code 同名(另有别名 NotebookWrite,本批不覆盖)。
 * - postToolUseFailure:实测 2.167.0 没有该事件,失败调用走 PostToolUse 并带 is_error。
 */
const CODEBUDDY: AgentProfile = {
  id: 'codebuddy',
  displayName: 'CodeBuddy',
  legacyIds: [],
  configDirName: '.codebuddy',
  instructionsFileName: 'CODEBUDDY.md',
  settingsFileName: 'settings.json',
  projectDirEnv: 'CODEBUDDY_PROJECT_DIR',
  sessionIdEnv: 'CODEBUDDY_SESSION_ID',
  cliCommands: ['codebuddy'],
  writeTools: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
  capabilities: { statusLine: false, contextMonitor: false, postToolUseFailure: false },
  // 顺序即替换顺序:先替换目录路径,再替换指引文件名与环境变量
  assetReplacements: [
    ['.claude/', '.codebuddy/'],
    ['CLAUDE.md', 'CODEBUDDY.md'],
    ['CLAUDE_PROJECT_DIR', 'CODEBUDDY_PROJECT_DIR'],
    ['CLAUDE_CODE_SESSION_ID', 'CODEBUDDY_SESSION_ID'],
  ],
};

export const AGENT_PROFILES: readonly AgentProfile[] = [CLAUDE_CODE, CODEBUDDY];
