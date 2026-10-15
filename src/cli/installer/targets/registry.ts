/**
 * 安装器 target 注册表:每个已登记的 agent 描述生成一个 target(登记顺序,claude-code 第一)。
 * 新增 agent 只需在 `src/core/agents/profiles.ts` 登记描述,本文件无需改动。
 */

import { getAgentProfile, listAgentProfiles } from '../../../core/agents';
import type { AgentTarget, Location, TargetId } from './types';
import { createAgentTarget } from './agent-target';

export const ALL_TARGETS: readonly AgentTarget[] = Object.freeze(
  listAgentProfiles().map(createAgentTarget),
);

/** 按 id 或 legacy 别名(如 `claude`)取 target。 */
export function getTarget(id: string): AgentTarget | undefined {
  const profile = getAgentProfile(id);
  return profile ? ALL_TARGETS.find((t) => t.id === profile.id) : undefined;
}

export function listTargetIds(): TargetId[] {
  return ALL_TARGETS.map((t) => t.id);
}

/** 对全部 target 执行 detect(),与注册表逐一配对返回。 */
export function detectAll(loc: Location): Array<{
  target: AgentTarget;
  detection: ReturnType<AgentTarget['detect']>;
}> {
  return ALL_TARGETS.map((target) => ({
    target,
    detection: target.detect(loc),
  }));
}

/**
 * 解析 `--target=` 参数:
 *   - `auto` / `all` —— 注册表全部 target;
 *   - `none` —— 空列表(调用方跳过 agent 配置写入);
 *   - 逗号分隔 id 列表 —— 支持 legacy 别名,重复项去重;未知 id 报错并列出可用 id。
 */
export function resolveTargetFlag(value: string, loc: Location): AgentTarget[] {
  void loc;
  if (value === 'none') return [];
  if (value === 'all' || value === 'auto') return [...ALL_TARGETS];

  const ids = value.split(',').map((s) => s.trim()).filter(Boolean);
  const resolved: AgentTarget[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    const t = getTarget(id);
    if (!t) unknown.push(id);
    else if (!resolved.includes(t)) resolved.push(t);
  }
  if (unknown.length > 0) {
    const known = listTargetIds().join(', ');
    throw new Error(
      `Unknown --target id(s): ${unknown.join(', ')}. Known: ${known}, plus 'auto' / 'all' / 'none'.`,
    );
  }
  return resolved;
}
