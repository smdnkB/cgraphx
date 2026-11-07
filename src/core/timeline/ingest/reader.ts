/**
 * 读取器分发(ingest 内部组织,D1)。
 *
 * 分发按来源描述的 sessionReader 标识(agents 的 SESSION_READER_IDS 与 SessionSource.sessionReader);
 * 会话文件根目录与文件列举归 agents 门面的 listSessionSources()(claude/codebuddy 的目录布局
 * 列举也搬了过去),本模块不感知。接新来源 = agents 加一个标识与来源 + 这里登记一个读取器。
 */

import type { SessionReaderId } from '../../agents';
import { readClaudeSessionFacts } from './claude-transcript';
import { readCodebuddySessionFacts } from './codebuddy-transcript';
import { readDeepSeekSessionFacts } from './deepseek-session';
import type { SessionFactsReader } from './types';

/** 读取器标识 → 读取器实现;接新 agent = agents 描述加一个标识 + 这里登记一个读取器。 */
const READERS: Readonly<Record<SessionReaderId, SessionFactsReader>> = {
  'claude-transcript': readClaudeSessionFacts,
  'codebuddy-transcript': readCodebuddySessionFacts,
  'deepseek-session': readDeepSeekSessionFacts,
};

/** 按来源描述的 sessionReader 标识取读取器;未登记的标识抛错。 */
export function sessionFactsReader(readerId: SessionReaderId): SessionFactsReader {
  const reader = READERS[readerId];
  if (reader === undefined) throw new Error(`未知会话文件读取器: ${readerId}`);
  return reader;
}
