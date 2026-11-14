/** Claude Code 兼容导出,实现由统一适配器生成。 */
import { defaultAgentProfile } from '../../../core/agents';
import { createAdapterTarget, createAgentAdapter } from './adapter-target';

const profile = defaultAgentProfile();
export const claudeAdapter = createAgentAdapter(profile);
export const claudeTarget = createAdapterTarget(profile);
export { createAgentTarget } from './agent-target';
