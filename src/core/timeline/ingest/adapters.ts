/** 会话适配器从 agents 唯一登记处获取。 */
import * as os from 'node:os';
import type { AgentAdapterContext } from '../../agents';
export { sessionAdapterFor } from '../../agents';

export function sessionAdapterContext(projectRoot: string): AgentAdapterContext {
  return { projectRoot, userHome: os.homedir(), env: process.env };
}
