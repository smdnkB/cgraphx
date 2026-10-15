/**
 * 兼容导出:Claude Code target 由通用 agent target 生成(既有测试与调用方经此引用)。
 */

import { getAgentProfile } from '../../../core/agents';
import { createAgentTarget } from './agent-target';
import type { AgentTarget } from './types';

const CLAUDE_CODE_PROFILE = getAgentProfile('claude-code');
if (!CLAUDE_CODE_PROFILE) throw new Error('agent 描述 claude-code 未登记');

export const claudeTarget: AgentTarget = createAgentTarget(CLAUDE_CODE_PROFILE);
export { createAgentTarget } from './agent-target';
