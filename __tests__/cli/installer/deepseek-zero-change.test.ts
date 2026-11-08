/**
 * DeepSeek 零变化守护测试(2026-11-06-agent看板 单元测试规格 G1–G2;spec D12 🔒、全局约束、验收 2)。
 *
 * D12 的保证是「AGENT_PROFILES 与 AgentId 不动」——安装器、副本带配置、提交门禁全部经它枚举,
 * 守护住登记面就守住了三条链路;会话变量一档直接断言解析结果。
 */

import { describe, expect, it } from 'vitest';

import { listAgentProfiles, listSessionSources, parseAgentList, resolveSessionIdFromEnv } from '../../../src/core/agents';

describe('deepseek read-only source changes nothing else (spec D12, acceptance #2)', () => {
  it('G2: AGENT_PROFILES stays exactly claude-code + codebuddy; deepseek only enters as a read-only session source', () => {
    expect(listAgentProfiles().map((p) => p.id)).toEqual(['claude-code', 'codebuddy']);
    expect(parseAgentList('all').map((p) => p.id)).toEqual(['claude-code', 'codebuddy']); // install -t all 的目标集
    // deepseek 不进任何 agent 配置目录名 → install/副本永远不带 .dsh/
    for (const profile of listAgentProfiles()) expect(profile.configDirName).not.toBe('.dsh');
    // 但会话来源里有它(只读第三家)
    expect(listSessionSources().map((s) => s.id)).toEqual(['claude-code', 'codebuddy', 'deepseek']);
  });

  it('G1: DSH_SESSION_ID resolves as a DeepSeek session; Claude Code still wins when both are set', () => {
    expect(resolveSessionIdFromEnv({ DSH_SESSION_ID: 'session-abc' })).toEqual({
      sessionId: 'session-abc',
      agent: 'deepseek',
      sessionIdEnv: 'DSH_SESSION_ID',
    });
    // 两家已登记的照旧认(基线不回退)
    expect(resolveSessionIdFromEnv({ CLAUDE_CODE_SESSION_ID: 'cc' })).toEqual({
      sessionId: 'cc',
      agent: 'claude-code',
      sessionIdEnv: 'CLAUDE_CODE_SESSION_ID',
    });
    // 两个变量同时存在按登记顺序取 Claude Code
    expect(
      resolveSessionIdFromEnv({ DSH_SESSION_ID: 'session-abc', CLAUDE_CODE_SESSION_ID: 'cc' }),
    ).toMatchObject({ sessionId: 'cc', agent: 'claude-code' });
  });

  // 完整的「install -t all 在真实项目里不部署 .dsh/」与「开副本不带 .dsh/」属安装器/副本的既有
  // 端到端链路(dead-hook-cleanup、replica/create 已覆盖其目标集逻辑);本需求的守护点是登记面,
  // 见上一条。如需端到端断言,在 installer 套件补一条即可(测试规格待确认项已注明可降级)。
});
