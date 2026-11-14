/** 将已登记的宿主能力接入统一 AgentAdapter 和现有安装器。 */
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AGENT_REGISTRATIONS, agentReplicaPaths, agentSettingsPath,
  type AgentAdapter, type AgentAdapterContext, type AgentInstallationAdapter, type AgentInstallationResult,
  type AgentInstallInput, type AgentProfile,
} from '../../../core/agents';
import { getCliVersion } from '../../../core/skill-version';
import { sessionAdapterFor, type SessionFact } from '../../../core/timeline';
import { readTemplateClaudeMd, resolveTemplateDir } from '../claude-assets';
import { createAgentTarget } from './agent-target';
import type { AgentTarget, WriteResult } from './types';

function resultAt(context: AgentAdapterContext, result: WriteResult): AgentInstallationResult {
  return {
    files: result.files.map(file => ({ ...file, path: path.resolve(context.projectRoot, file.path) })),
    notices: result.notes ?? [],
  };
}

export function createAgentAdapter(profile: AgentProfile, installation?: AgentInstallationAdapter): AgentAdapter<SessionFact> {
  return {
    id: profile.id,
    displayName: profile.displayName,
    aliases: profile.legacyIds,
    installation: installation ?? {
      capabilities: profile.capabilities,
      detect(context) {
        const state = createAgentTarget(profile, context.projectRoot).detect('local');
        return { detected: state.detected, installed: state.installed };
      },
      install(context, input) {
        return resultAt(context, createAgentTarget(profile, context.projectRoot, input).install('local', {}));
      },
      uninstall(context, assetsDir) {
        const input: AgentInstallInput = { assetsDir, instructions: null, version: null };
        return resultAt(context, createAgentTarget(profile, context.projectRoot, input).uninstall('local'));
      },
      replicaPaths(context) {
        return agentReplicaPaths(context.projectRoot, profile);
      },
    },
    sessions: sessionAdapterFor(profile.sessionReader),
  };
}

/** 同一登记入口也返回只读会话来源,但它们没有安装能力。 */
export function listAgentAdapters(): readonly AgentAdapter<SessionFact>[] {
  return AGENT_REGISTRATIONS.map(({ profile, source, sessions, installation }) => {
    return profile ? createAgentAdapter(profile, installation) : {
      id: source.id,
      displayName: source.displayName,
      aliases: [],
      installation: null,
      sessions,
    };
  });
}

function context(): AgentAdapterContext {
  return { projectRoot: process.cwd(), userHome: os.homedir(), env: process.env };
}
function input(): AgentInstallInput {
  return { assetsDir: resolveTemplateDir(), instructions: readTemplateClaudeMd(), version: getCliVersion() };
}

/** 兼容现有同步 target API,所有已安装 agent 均通过适配器执行。 */
export function createAdapterTarget(profile: AgentProfile, adapter: AgentAdapter<SessionFact> = createAgentAdapter(profile)): AgentTarget {
  const installation = adapter.installation!;
  return {
    id: profile.id,
    profile,
    displayName: adapter.displayName,
    supportsLocation: () => true,
    detect: () => ({ ...installation.detect(context()), configPath: agentSettingsPath(process.cwd(), profile) }),
    install: () => {
      const result = installation.install(context(), input());
      return { files: [...result.files], notes: [...result.notices] };
    },
    uninstall: () => {
      const result = installation.uninstall(context(), resolveTemplateDir());
      return { files: [...result.files], notes: [...result.notices] };
    },
    describePaths: loc => createAgentTarget(profile).describePaths(loc),
  };
}
