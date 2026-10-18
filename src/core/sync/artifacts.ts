/**
 * 上报产出(spec §11.1–§11.3、§11.5):类型识别经产物注册表 + 本会话产出收集。
 *
 * 口径只服务平台上报;类型标识与路径规则唯一定义在 `src/core/artifact-registry/`。
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  getBuiltinArtifactType,
  identifyArtifact,
  reportableTypeKeys,
  type ReportTier,
} from '../artifact-registry';
import type { TimelineEvent } from '../timeline';
import { createPathResolver } from './paths';
import type { SyncContext } from './payload';
import type { IngestArtifact, IngestCommit, UnreportedArtifact } from './types';
import type { ServerTier } from './version';

/**
 * 某档位可上报的产出类型集合(spec §11.1)。
 *
 * 1.0 / 1.1 只发 13 个基础类型;1.2 发 18 个固定类型;1.3 以本项目类型表为准
 * (未取到缓存时退回 19 个默认类型)。本地专用类型在任何档位都不在集合内。
 */
export function reportableTypesFor(tier: ServerTier, projectTypes: readonly string[] | null): ReadonlySet<string> {
  if (tier === '1.3' && projectTypes !== null) {
    // 项目类型表是权威集合:去掉本地专用类型(注册表 minTier 为 null),自定义类型保留。
    return new Set(projectTypes.filter((key) => getBuiltinArtifactType(key)?.minTier !== null));
  }
  const reportTier: ReportTier = tier === '1.1' ? '1.0' : tier;
  return reportableTypeKeys(reportTier);
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
 * @returns artifacts:经注册表识别、且在档位可上报集合内的产出;
 *          outputPaths:全部候选的项目相对路径(识别前,供参考排除);
 *          unreported:可上报集合外、本轮不发送的产出(仓库相对路径,spec §11.4)。
 */
export function collectSessionArtifacts(
  ctx: SyncContext,
  events: TimelineEvent[],
  sessionCommits: IngestCommit[],
): { artifacts: IngestArtifact[]; outputPaths: Set<string>; unreported: UnreportedArtifact[] } {
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
  const unreported: UnreportedArtifact[] = [];
  for (const [repoRel, { projectRel, lastChangeTs }] of candidates) {
    const identity = identifyArtifact(ctx.projectRoot, projectRel);
    if (identity === null || identity.localOnly) continue;

    const changeMs = Date.parse(lastChangeTs);
    const commit = ctx.commitEvents.find(
      (ce) => ce.commit_hash !== null && Date.parse(ce.ts) >= changeMs && ce.commit_files.includes(repoRel),
    );
    const hasCommit = commit !== undefined && commit.commit_hash !== null;

    // 无 commit:改过又删掉、从未进入 commit 的文件不上报
    if (!hasCommit && !fs.existsSync(path.join(ctx.repoRoot, repoRel))) continue;

    // 档位可上报集合之外:不发送,记为未上报产出
    if (!ctx.allowedTypes.has(identity.type)) {
      unreported.push({ type: identity.type, path: repoRel });
      continue;
    }

    let artifact: IngestArtifact;
    if (commit !== undefined && commit.commit_hash !== null) {
      const hash = commit.commit_hash;
      artifact = {
        type: identity.type,
        path: repoRel,
        action: ctx.git.fileAddedIn(hash, repoRel) ? 'create' : 'modify',
        commitHash: ctx.git.isOnRemote(hash) ? hash : null,
        branch: typeof commit.metadata.branch === 'string' ? commit.metadata.branch : null,
        ts: lastChangeTs,
      };
    } else {
      artifact = {
        type: identity.type,
        path: repoRel,
        action: ctx.git.isTracked(repoRel) ? 'modify' : 'create',
        commitHash: null,
        branch: null,
        ts: lastChangeTs,
      };
    }

    // 任务键:协议 ≥ 1.2 且产出位于需求目录(spec §11.5)
    if ((ctx.tier === '1.2' || ctx.tier === '1.3') && identity.featureId !== null) {
      artifact.taskKey = identity.featureId;
    }
    artifacts.push(artifact);
  }

  return { artifacts, outputPaths, unreported };
}
