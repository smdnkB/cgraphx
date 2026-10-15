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
  capabilities: { statusLine: true, contextMonitor: true },
  assetReplacements: [],
};

export const AGENT_PROFILES: readonly AgentProfile[] = [CLAUDE_CODE];
