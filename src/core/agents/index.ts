/**
 * agents 门面:timeline / task / cli 统一经此读取 agent 差异。
 * 本模块不依赖任何其它 core 子系统,也不依赖 cli / web。
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AGENT_PROFILES, AGENT_REGISTRATIONS, listSessionSources } from './profiles';
import type { AgentId, AgentProfile, SessionFromEnv } from './types';

export { AGENT_IDS, SESSION_READER_IDS } from './profiles';
export type { AgentId, AgentProfile, SessionFromEnv, SessionReaderId, SessionSource, SessionSourceId } from './types';
export type {
  AgentAdapter, AgentAdapterContext, AgentFileChange, AgentHostCapabilities, AgentInstallationAdapter,
  AgentInstallationResult, AgentInstallationState, AgentInstallInput, AgentSessionAdapter,
  AgentSessionEnvironmentAdapter, AgentSessionFromEnvironment, AgentSessionReadResult,
} from './adapter';
export { agentSessionsRoot, DEEPSEEK_SESSION_FILENAME, listSessionFiles } from './sources';
export { AGENT_REGISTRATIONS, listSessionSources, sessionAdapterFor } from './profiles';
export { readClaudeSessionFacts } from './session/claude-transcript';
export { readCodebuddySessionFacts } from './session/codebuddy-transcript';
export { readDeepSeekSessionFacts } from './session/deepseek-session';
export { codexRootSessionId, readCodexSessionFacts } from './session/codex-session';
export { classifyAutoMessage } from './session/auto-message';
export type { AutoMessageSource } from './session/auto-message';
export { readJsonlLinesFrom } from './session/jsonl-lines';
export type { JsonlLine } from './session/jsonl-lines';
export type { SessionFact, SessionFactTs, PromptFact, PromptSource, ToolFact, TurnEndFact, SessionHeadFact, SessionTitleFact, SessionFileReadResult, SessionFactsReader } from './session/types';

/** 已存在的项目级 agent 配置,仅提供相对路径。 */
export function agentReplicaPaths(projectRoot: string, profile: AgentProfile): string[] {
  const custom = AGENT_REGISTRATIONS.find(item => item.profile?.id === profile.id)?.installation;
  if (custom) return [...custom.replicaPaths({ projectRoot, userHome: os.homedir(), env: process.env })];
  return [profile.configDirName, profile.instructionsFileName, ...profile.extraConfigFiles]
    .filter(rel => fs.existsSync(path.join(projectRoot, rel)));
}

export const DEFAULT_AGENT_ID: AgentId = 'claude-code';
export const AGENT_OPTION_FLAG = '--agent' as const;
export const CGRAPHX_SECTION_START = '<!-- CGRAPHX_START -->' as const;
export const CGRAPHX_SECTION_END = '<!-- CGRAPHX_END -->' as const;

/** settings 中判定为 cgraphx 写入的 hook 命令子串。 */
const CGRAPHX_HOOK_MARKERS: readonly string[] = [
  '/hooks/precommit-check/precommit-check.cjs',
  '/hooks/context-monitor/context-monitor.cjs',
  'cgraphx timeline-',
  'cgraphx task-',
];

/** 按登记顺序返回全部描述(claude-code 永远第一)。 */
export function listAgentProfiles(): readonly AgentProfile[] {
  return AGENT_PROFILES;
}

/** 按 id 或别名查描述;未登记返回 undefined。 */
export function getAgentProfile(idOrLegacy: string): AgentProfile | undefined {
  return AGENT_PROFILES.find((p) => p.id === idOrLegacy || p.legacyIds.includes(idOrLegacy));
}

/** 默认描述(claude-code)。 */
export function defaultAgentProfile(): AgentProfile {
  const p = getAgentProfile(DEFAULT_AGENT_ID);
  if (!p) throw new Error(`默认 agent 描述 ${DEFAULT_AGENT_ID} 未登记`);
  return p;
}

/** 可用 agent id 列表(含 legacy 别名),用于报错提示,如 `claude-code (claude), codebuddy`。 */
function availableAgentIdsHelp(): string {
  return AGENT_PROFILES
    .map((p) => (p.legacyIds.length > 0 ? `${p.id} (${p.legacyIds.join(', ')})` : p.id))
    .join(', ');
}

/** 按 id 或别名取描述;未登记抛 Error,消息列出可用 id 与别名。 */
export function requireAgentProfile(idOrLegacy: string): AgentProfile {
  const p = getAgentProfile(idOrLegacy);
  if (!p) throw new Error(`Unknown agent: ${idOrLegacy}. Available: ${availableAgentIdsHelp()}`);
  return p;
}

/**
 * 解析 agent 列表参数(install / timeline 的 `-t`):
 *   - `all` / `auto` —— 全部已登记 agent;
 *   - `none` —— 返回 `'none'`(调用方不处理任何 agent);
 *   - 逗号分隔 id 或 legacy 别名 —— 按出现顺序去重(空列表返回 `[]`);
 *     未知 id 抛 Error,消息列出可用 id 与别名。
 */
export function parseAgentList(value: string): AgentProfile[] | 'none' {
  if (value === 'none') return 'none';
  if (value === 'all' || value === 'auto') return [...AGENT_PROFILES];

  const ids = value.split(',').map((s) => s.trim()).filter(Boolean);
  const resolved: AgentProfile[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    const p = getAgentProfile(id);
    if (!p) unknown.push(id);
    else if (!resolved.includes(p)) resolved.push(p);
  }
  if (unknown.length > 0) {
    throw new Error(
      `Unknown --target id(s): ${unknown.join(', ')}. Known: ${availableAgentIdsHelp()}, plus 'auto' / 'all' / 'none'.`,
    );
  }
  return resolved;
}

/** 全部「已装」的 agent(登记顺序);一个都没装时取 `[claude-code]`。 */
export function selectInstalledAgents(projectRoot: string): AgentProfile[] {
  const installed = AGENT_PROFILES.filter((p) => isAgentInstalled(projectRoot, p));
  return installed.length > 0 ? installed : [defaultAgentProfile()];
}

export function agentConfigDir(projectRoot: string, profile: AgentProfile): string {
  return path.join(path.resolve(projectRoot), profile.configDirName);
}

export function agentSettingsPath(projectRoot: string, profile: AgentProfile): string {
  return path.join(agentConfigDir(projectRoot, profile), profile.settingsFileName);
}

export function agentInstructionsPath(projectRoot: string, profile: AgentProfile): string {
  return path.join(profile.instructionsAtRoot ? path.resolve(projectRoot) : agentConfigDir(projectRoot, profile), profile.instructionsFileName);
}

/** 按规则顺序做字面全量替换;空规则原样返回。 */
export function applyAssetReplacements(content: string, profile: AgentProfile): string {
  let out = content;
  for (const [from, to] of profile.assetReplacements) {
    out = out.split(from).join(to);
  }
  return profile.transformAssetText?.(out) ?? out;
}

/** 按会话来源的登记顺序从环境变量取会话 id;都没有返回 null。只读来源(deepseek)也认。 */
export function resolveSessionIdFromEnv(env: NodeJS.ProcessEnv = process.env): SessionFromEnv | null {
  for (const source of listSessionSources()) {
    const found = source.sessionFromEnvironment({ projectRoot: process.cwd(), userHome: os.homedir(), env });
    if (found) return { sessionId: found.sessionId, agent: source.id, sessionIdEnv: found.envName };
  }
  return null;
}

/** 全部会话来源的会话变量名(按登记顺序,过滤掉不提供变量的来源);提交门禁片段的探针名单按它生成。 */
export function listSessionIdEnvNames(): string[] {
  return listSessionSources().flatMap(source => [...source.sessionIdEnvNames]);
}

/** 读取文件文本;不存在或读取失败返回 null。 */
function readTextOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** settings JSON 中是否存在 cgraphx 写入的 hook 或 statusLine。 */
function settingsHasCgraphxMarker(settings: unknown): boolean {
  if (!isRecord(settings)) return false;
  const hooks = settings['hooks'];
  if (isRecord(hooks)) {
    for (const groups of Object.values(hooks)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        const inner = isRecord(group) ? group['hooks'] : undefined;
        if (!Array.isArray(inner)) continue;
        for (const h of inner) {
          const cmd = isRecord(h) ? h['command'] : undefined;
          if (typeof cmd === 'string' && CGRAPHX_HOOK_MARKERS.some((m) => cmd.includes(m))) return true;
        }
      }
    }
  }
  const statusLine = settings['statusLine'];
  if (isRecord(statusLine)) {
    const cmd = statusLine['command'];
    if (typeof cmd === 'string' && cmd.includes('claude-hud')) return true;
  }
  return false;
}

/** 已装:settings 有 cgraphx hook / statusLine,或指引文件含 cgraphx 块标记。失败一律 false。 */
export function isAgentInstalled(projectRoot: string, profile: AgentProfile): boolean {
  const custom = AGENT_REGISTRATIONS.find(item => item.profile?.id === profile.id)?.installation;
  if (custom) return custom.detect({ projectRoot, userHome: os.homedir(), env: process.env }).installed;
  const settingsText = readTextOrNull(agentSettingsPath(projectRoot, profile));
  if (settingsText !== null) {
    try {
      if (settingsHasCgraphxMarker(JSON.parse(settingsText))) return true;
    } catch {
      // settings 解析失败视为无标记,继续看指引文件
    }
  }
  const instructions = readTextOrNull(agentInstructionsPath(projectRoot, profile));
  return instructions !== null && instructions.includes(CGRAPHX_SECTION_START);
}

/** 检测到:项目内存在该 agent 的配置目录。CLI 装在机器上不算——那会导致交互安装默认全选、误装项目没用过的 agent(spec:2026-11-07-安装默认勾选已配置的agent K1)。 */
export function isAgentDetected(projectRoot: string, profile: AgentProfile): boolean {
  const custom = AGENT_REGISTRATIONS.find(item => item.profile?.id === profile.id)?.installation;
  if (custom) return custom.detect({ projectRoot, userHome: os.homedir(), env: process.env }).detected;
  try {
    return fs.existsSync(agentConfigDir(projectRoot, profile));
  } catch {
    return false;
  }
}
