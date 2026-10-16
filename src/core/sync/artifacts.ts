/**
 * 上报产出(spec §5.5):产物类型映射 + 本会话产出收集。
 *
 * 口径只服务平台上报,与 `src/core/task/artifacts.ts`(本地 web)相互独立,不得互相引用。
 */

import fs from 'node:fs';
import path from 'node:path';

import type { TimelineEvent } from '../timeline';
import { createPathResolver } from './paths';
import type { SyncContext } from './payload';
import type { ArtifactType, IngestArtifact, IngestCommit } from './types';

/** 需求目录前缀 `docs/features/<feature-id>/`。 */
const F = '^docs/features/[^/]+/';

/** 产物类型映射表,先命中先用(spec §5.5 表顺序)。 */
const ARTIFACT_RULES: ReadonlyArray<{ type: ArtifactType; re: RegExp }> = [
  { type: 'ui_test_spec', re: new RegExp(`${F}ui功能测试/[^/]*-ui功能测试-spec\\.md$`) },
  {
    type: 'ui_test_report',
    re: new RegExp(`${F}ui功能测试/([^/]*-ui功能测试报告\\.(xlsx|md)|[^/]*-ui功能测试结果\\.json|[^/]*\\.png)$`),
  },
  { type: 'api_test_spec', re: new RegExp(`${F}[^/]*-接口测试-spec\\.md$`) },
  { type: 'api_test_report', re: new RegExp(`${F}[^/]*(-接口测试报告\\.md|-测试报告\\.md|-接口测试验证\\.jsonl)$`) },
  { type: 'unit_test_spec', re: new RegExp(`${F}[^/]*-单元测试-spec\\.md$`) },
  { type: 'unit_test_report', re: new RegExp(`${F}[^/]*-单元测试报告\\.md$`) },
  { type: 'spec', re: new RegExp(`${F}[^/]*-spec\\.md$`) },
  { type: 'plan', re: new RegExp(`${F}plan/.+`) },
  { type: 'wireframe', re: new RegExp(`${F}[^/]*-线框-v\\d+\\.html$`) },
  { type: 'knowledge', re: /^docs\/knowledge\/.+/ },
  { type: 'code_map', re: /^docs\/code-map\/.+/ },
  { type: 'design_map', re: /^docs\/design-map\/.+/ },
  { type: 'schema_knowledge', re: /^docs\/schema-knowledge\/.+/ },
];

/** 项目相对路径 → 平台产物类型;不命中返回 null(不作为产出上报)。 */
export function classifyArtifactType(projectRelPath: string): ArtifactType | null {
  for (const rule of ARTIFACT_RULES) {
    if (rule.re.test(projectRelPath)) return rule.type;
  }
  return null;
}

const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `tool_result_summary` 解析后 `success !== false`;解析失败按成功处理。 */
function isSuccessful(summary: string | null): boolean {
  if (summary === null) return true;
  try {
    const parsed: unknown = JSON.parse(summary);
    return !(isRecord(parsed) && parsed.success === false);
  } catch {
    return true;
  }
}

/** 编辑工具改动的文件路径(`notebook_path ?? file_path`);取不到返回 null。 */
function editedPath(e: TimelineEvent): string | null {
  if (!isRecord(e.tool_args)) return null;
  const p = e.tool_args.notebook_path ?? e.tool_args.file_path;
  return typeof p === 'string' && p !== '' ? p : null;
}

function laterTs(a: string, b: string): string {
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/**
 * 收集本会话产出。
 *
 * @param events 本会话全部事件(终端会话传空数组)。
 * @param sessionCommits 本会话已构造好的 commit(终端会话传终端 commit)。
 * @returns artifacts:命中映射表的产出;outputPaths:全部候选的项目相对路径(映射前,供参考排除)。
 */
export function collectSessionArtifacts(
  ctx: SyncContext,
  events: TimelineEvent[],
  sessionCommits: IngestCommit[],
): { artifacts: IngestArtifact[]; outputPaths: Set<string> } {
  const resolver = createPathResolver(ctx.projectRoot, ctx.repoRoot);
  // repoRel → { projectRel, lastChangeTs }
  const candidates = new Map<string, { projectRel: string; lastChangeTs: string }>();
  const addCandidate = (rel: { repoRel: string; projectRel: string } | null, ts: string): void => {
    if (rel === null) return;
    const prev = candidates.get(rel.repoRel);
    candidates.set(rel.repoRel, {
      projectRel: rel.projectRel,
      lastChangeTs: prev === undefined ? ts : laterTs(prev.lastChangeTs, ts),
    });
  };

  for (const e of events) {
    if (e.event_type !== 'post_tool_use' || e.tool_name === null || !EDIT_TOOLS.has(e.tool_name)) continue;
    if (!isSuccessful(e.tool_result_summary)) continue;
    const p = editedPath(e);
    if (p === null) continue;
    addCandidate(resolver.fromAbs(p, e.cwd), e.ts);
  }
  for (const c of sessionCommits) {
    for (const f of c.files) addCandidate(resolver.fromRepoRel(f), c.ts);
  }

  const outputPaths = new Set<string>();
  for (const c of candidates.values()) outputPaths.add(c.projectRel);

  const artifacts: IngestArtifact[] = [];
  for (const [repoRel, { projectRel, lastChangeTs }] of candidates) {
    const type = classifyArtifactType(projectRel);
    if (type === null) continue;

    const changeMs = Date.parse(lastChangeTs);
    const commit = ctx.commitEvents.find(
      (ce) => ce.commit_hash !== null && Date.parse(ce.ts) >= changeMs && ce.commit_files.includes(repoRel),
    );

    if (commit !== undefined && commit.commit_hash !== null) {
      const hash = commit.commit_hash;
      artifacts.push({
        type,
        path: repoRel,
        action: ctx.git.fileAddedIn(hash, repoRel) ? 'create' : 'modify',
        commitHash: ctx.git.isOnRemote(hash) ? hash : null,
        branch: typeof commit.metadata.branch === 'string' ? commit.metadata.branch : null,
        ts: lastChangeTs,
      });
      continue;
    }

    // 无 commit:改过又删掉、从未进入 commit 的文件不上报
    if (!fs.existsSync(path.join(ctx.repoRoot, repoRel))) continue;
    artifacts.push({
      type,
      path: repoRel,
      action: ctx.git.isTracked(repoRel) ? 'modify' : 'create',
      commitHash: null,
      branch: null,
      ts: lastChangeTs,
    });
  }

  return { artifacts, outputPaths };
}
