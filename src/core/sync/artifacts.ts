/**
 * 上报产出(spec §11.1–§11.3、§11.5):类型识别经产物注册表 + 本会话产出收集。
 *
 * 口径只服务平台上报;类型标识与路径规则唯一定义在 `src/core/artifact-registry/`。
 * 路径按「主目录 + 全部登记过的副本」换算(spec D26):读文件头、判断文件在不在、查跟踪状态
 * 都在路径所在的根里做;提交相关的 git 查询先用主目录,主目录还没有的副本提交改到副本仓库查(D29)。
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
import type { GitCache } from './git';
import { createPathResolver, rootOrMain, type RelPaths } from './paths';
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
 * 提交 hash → 提交所在副本的根(绝对路径);在主目录里做的提交不放。同一 hash 以第一条提交事件为准
 * (与 payload 里 commit 去重保留首条一致)。没有副本里的提交时为空表。
 */
function commitRootsOf(ctx: SyncContext): Map<string, string> {
  const roots = new Map<string, string>();
  if (ctx.commitReplicas.size === 0) return roots;
  const seen = new Set<string>();
  for (const e of ctx.commitEvents) {
    if (e.commit_hash === null || seen.has(e.commit_hash)) continue;
    seen.add(e.commit_hash);
    const replica = ctx.commitReplicas.get(e.id);
    if (replica !== undefined) roots.set(e.commit_hash, path.resolve(replica.path));
  }
  return roots;
}

/**
 * 提交相关的查询用哪个仓库:先用主目录;提交在副本里做、主目录里还没有(没合入),
 * 且副本目录还在 → 用副本仓库。
 */
function gitForCommit(ctx: SyncContext, hash: string, commitRoot: string | undefined): GitCache {
  if (commitRoot === undefined || ctx.git.hasCommit(hash)) return ctx.git;
  return ctx.gitFor(rootOrMain(commitRoot, ctx.projectRoot));
}

/** 提交事件在哪个根里做的:副本里做的 → 副本根(与 commitRootsOf 同一口径);其余 → 主目录。 */
function commitEventRoot(ctx: SyncContext, e: TimelineEvent): string {
  const replica = ctx.commitReplicas.get(e.id);
  return replica === undefined ? ctx.projectRoot : path.resolve(replica.path);
}

/**
 * 提交推送过没有:主目录的远程跟踪分支里有就算;副本里做的提交再到副本仓库查一次——列副本时主目录
 * 已取回这个提交的对象,但副本推送出去的远程分支,主目录要等自己 fetch 之后才知道。
 */
function isPushed(ctx: SyncContext, hash: string, commitRoot: string | undefined): boolean {
  if (ctx.git.isOnRemote(hash)) return true;
  if (commitRoot === undefined) return false;
  const root = rootOrMain(commitRoot, ctx.projectRoot);
  return root !== ctx.projectRoot && ctx.gitFor(root).isOnRemote(hash);
}

/** 文件在不在:主目录照原来按仓库根拼仓库相对路径;副本按副本根拼项目内路径。 */
function fileExistsIn(ctx: SyncContext, base: string, repoRel: string, projectRel: string): boolean {
  return fs.existsSync(base === ctx.projectRoot ? path.join(ctx.repoRoot, repoRel) : path.join(base, projectRel));
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
  const resolver = createPathResolver(ctx.projectRoot, ctx.repoRoot, ctx.roots);
  const commitRoots = commitRootsOf(ctx);
  // repoRel → { projectRel, root, lastChangeTs }
  const candidates = new Map<string, { projectRel: string; root: string; lastChangeTs: string }>();
  const addCandidate = (rel: RelPaths | null, ts: string): void => {
    if (rel === null) return;
    const prev = candidates.get(rel.repoRel);
    candidates.set(rel.repoRel, {
      projectRel: rel.projectRel,
      root: rel.root,
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
    // 提交里的文件落在提交所在的根(副本里做的提交 → 副本)
    const root = commitRoots.get(c.hash);
    for (const f of c.files) addCandidate(resolver.fromRepoRel(f, root), c.ts);
  }

  const outputPaths = new Set<string>();
  for (const c of candidates.values()) outputPaths.add(c.projectRel);

  const artifacts: IngestArtifact[] = [];
  const unreported: UnreportedArtifact[] = [];
  for (const [repoRel, { projectRel, root, lastChangeTs }] of candidates) {
    // 读文件头、判断文件在不在都在路径所在的根里做;那个副本已不在就退回主目录
    const base = rootOrMain(root, ctx.projectRoot);
    const identity = identifyArtifact(base, projectRel);
    if (identity === null || identity.localOnly) continue;

    const changeMs = Date.parse(lastChangeTs);
    // 提交要和产出在同一个根里:主目录和各副本的仓库相对路径相同,只比路径会对上别的根里的提交
    const commit = ctx.commitEvents.find(
      (ce) =>
        ce.commit_hash !== null &&
        Date.parse(ce.ts) >= changeMs &&
        ce.commit_files.includes(repoRel) &&
        commitEventRoot(ctx, ce) === root,
    );
    const hasCommit = commit !== undefined && commit.commit_hash !== null;

    // 无 commit:改过又删掉、从未进入 commit 的文件不上报
    if (!hasCommit && !fileExistsIn(ctx, base, repoRel, projectRel)) continue;

    // 档位可上报集合之外:不发送,记为未上报产出
    if (!ctx.allowedTypes.has(identity.type)) {
      unreported.push({ type: identity.type, path: repoRel });
      continue;
    }

    let artifact: IngestArtifact;
    if (commit !== undefined && commit.commit_hash !== null) {
      const hash = commit.commit_hash;
      const commitRoot = commitRoots.get(hash);
      const git = gitForCommit(ctx, hash, commitRoot);
      artifact = {
        type: identity.type,
        path: repoRel,
        action: git.fileAddedIn(hash, repoRel) ? 'create' : 'modify',
        commitHash: isPushed(ctx, hash, commitRoot) ? hash : null,
        branch: typeof commit.metadata.branch === 'string' ? commit.metadata.branch : null,
        ts: lastChangeTs,
      };
    } else {
      artifact = {
        type: identity.type,
        path: repoRel,
        action: ctx.gitFor(base).isTracked(repoRel) ? 'modify' : 'create',
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
