/** 会话适配器共用装配,保留各宿主自己的解析和父子关系规则。 */
import * as path from 'node:path';
import type { AgentSessionAdapter } from '../adapter';
import type { SessionSource } from '../types';
import type { SessionFact, SessionFactsReader } from './types';

export function parentSessionFile(file: string): string | null {
  const parts = file.split(path.sep);
  const index = parts.lastIndexOf('subagents');
  if (index < 1 || !parts[index - 1]) return null;
  return path.join(...parts.slice(0, index - 1), `${parts[index - 1]}.jsonl`);
}

export const pathSessionId: AgentSessionAdapter<SessionFact>['sessionIdForFile'] = file =>
  path.basename(parentSessionFile(file) ?? file, '.jsonl');
export const factSessionId: AgentSessionAdapter<SessionFact>['sessionIdForFile'] = (_file, facts, previous) =>
  facts[0]?.sessionId ?? previous;
export const noParent = (): null => null;

export function createSessionAdapter(
  source: SessionSource,
  read: SessionFactsReader,
  parent: (file: string) => string | null,
  sessionIdForFile: AgentSessionAdapter<SessionFact>['sessionIdForFile'],
  resolveRootSessionId: AgentSessionAdapter<SessionFact>['resolveRootSessionId'] = async () => null,
): AgentSessionAdapter<SessionFact> {
  return {
    sessionIdEnvNames: source.sessionIdEnvNames,
    sessionFromEnvironment: context => source.sessionFromEnvironment(context),
    resolveRootSessionId,
    unavailableReason: () => source.unavailableReason(),
    async listSessionFiles(context) {
      const root = source.sessionsRoot(context.env, context.userHome);
      return root === null ? [] : source.listFiles(root);
    },
    readSessionFile: async (_context, file, offset) => read(file, offset),
    parentSessionFile: parent,
    sessionIdForFile,
  };
}
