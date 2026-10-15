/**
 * 兼容导出:Claude Code target 由通用 agent target 生成(既有测试与调用方经此引用)。
 */

import { defaultAgentProfile } from '../../../core/agents';
import { createAgentTarget } from './agent-target';
import type { AgentTarget } from './types';

export const claudeTarget: AgentTarget = createAgentTarget(defaultAgentProfile());
export { createAgentTarget } from './agent-target';
