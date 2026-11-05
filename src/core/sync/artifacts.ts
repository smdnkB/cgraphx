/**
 * 上报产出(spec §11.1–§11.3、§11.5):类型识别经产物注册表 + 本会话产出收集。
 *
 * 口径只服务平台上报;类型标识与路径规则唯一定义在 `src/core/artifact-registry/`。
 * 路径按「timeline 记下的根 + 当前根 + 副本登记」换算(spec:2026-11-05-数据按项目放用户目录 D11):读文件头、
 * 判断文件在不在、查跟踪状态都在路径所在的根里做,那个根已不在退回当前根;提交在哪个根做的按提交事件的 cwd 认。
 * 提交相关的 git 查询先在当前根的仓库查,查不到再到提交事件 cwd 所在的仓库查。
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  getBuiltinArtifactType,
  identifyArtifact,
  reportableTypeKeys,
  type ReportTier,
} from '../artifact-registry';
import { matchProjectRoot } from '../replica';
import type { TimelineEvent } from '../timeline';
import type { GitCache } from './git';
import { createPathResolver, isDirectory, rootOrCurrent, type RelPaths } from './paths';
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

/** 提交所在的根;在当前根里做的不放。 */
interface CommitRoots {
  /** 提交事件 id → 根 */
  byEvent: Map<number, string>;
  /** 提交 hash → 根;同一 hash 以第一条提交事件为准(与 payload 里 commit 去重保留首条一致) */
  byHash: Map<string, string>;
}

/**
 * 各提交在哪个根里做的(rootOfCommitCwd);`projectInRepo` 是项目根在仓库内的相对位置(PathResolver 的同名字段)。
 * 项目只有当前根一个根时都是空表。
 */
function commitRootsOf(ctx: SyncContext, projectInRepo: string): CommitRoots {
  const byEvent = new Map<number, string>();
  const byHash = new Map<string, string>();
  if (ctx.roots.every((r) => r.root === ctx.projectRoot)) return { byEvent, byHash };
  // 提交事件的 cwd 是工作区根,一轮里只有少数几个:每个 cwd 只认一次根
  const byCwd = new Map<string, string>();
  const seen = new Set<string>();
  for (const e of ctx.commitEvents) {
    let root = byCwd.get(e.cwd);
    if (root === undefined) {
      root = rootOfCommitCwd(ctx, e.cwd, projectInRepo);
      byCwd.set(e.cwd, root);
    }
    if (root !== ctx.projectRoot) byEvent.set(e.id, root);
    if (e.commit_hash === null || seen.has(e.commit_hash)) continue;
    seen.add(e.commit_hash);
    if (root !== ctx.projectRoot) byHash.set(e.commit_hash, root);
  }
  return { byEvent, byHash };
}

/**
 * 提交在哪个根里做的,不只看副本;认出的根和哪个根跑这一轮无关(spec:2026-11-05-数据按项目放用户目录 D13)。
 * 提交事件的 cwd(记的是工作区根)落在 ctx.roots 的哪个根里(matchProjectRoot,取最长的根),不中再看 cwd 等于哪个根;
 * 还不中、项目根不是工作区根(子目录项目)时,再看 cwd 拼上项目根在仓库内的相对位置等于哪个根——别的 worktree、
 * clone 里同一子目录项目的提交也认得出。都不是、cwd 为空 → 当前根。
 */
function rootOfCommitCwd(ctx: SyncContext, cwd: string, projectInRepo: string): string {
  if (cwd === '') return ctx.projectRoot;
  const hit = matchProjectRoot(ctx.roots, cwd);
  if (hit !== null) return hit.root.root;
  return (
    rootAt(ctx, cwd) ??
    (projectInRepo === '' ? null : rootAt(ctx, path.join(cwd, ...projectInRepo.split('/')))) ??
    ctx.projectRoot
  );
}

/** dir 等于 ctx.roots 里哪个根(原样路径相同,或 realpath 与根的 realpath 相同);都不是 → null。 */
function rootAt(ctx: SyncContext, dir: string): string | null {
  const resolved = path.resolve(dir);
  const same = ctx.roots.find((r) => r.root === resolved);
  if (same !== undefined) return same.root;
  const real = realDirOf(resolved);
  return ctx.roots.find((r) => r.realRoot === real)?.root ?? null;
}

/** 目录的 realpath;目录不在时取最近一级在的上级的 realpath 拼回(和 replica 给根算 realRoot 同一口径)。 */
function realDirOf(dir: string): string {
  try {
    return fs.realpathSync(dir);
  } catch {
    const parent = path.dirname(dir);
    return parent === dir ? dir : path.join(realDirOf(parent), path.basename(dir));
  }
}

/**
 * 以前的登记(没有 movedFiles)按文件此刻在哪推断移进副本的需求文件:路径在这类副本登记的需求目录下、文件
 * 在那个副本里 → 那个副本的根;否则 null。
 */
function movedToReplica(ctx: SyncContext, projectRel: string): string | null {
  const featureId = /^docs\/features\/([^/]+)\//.exec(projectRel)?.[1];
  if (featureId === undefined) return null;
  for (const { root, replica } of ctx.roots) {
    if (replica === null || replica.movedFiles !== null || replica.featureId !== featureId) continue;
    if (fs.existsSync(path.join(root, projectRel))) return root;
  }
  return null;
}

/** 这个根是副本登记的根(ctx.roots 里这条根的 replica 不为 null);当前根、timeline 记下的根不算。 */
function isReplicaRoot(ctx: SyncContext, root: string): boolean {
  return ctx.roots.some((r) => r.root === root && r.replica !== null);
}

/**
 * /dev-start 把主目录里没提交的需求文件移进副本(版本流程与需求副本 spec D21⑥、D29)。调用方只对改它的根不是副本
 * 的文件调(sync 认不出哪个是主目录,不是副本的根都算):列在副本登记的 movedFiles 里、最后一次改早于开副本 → 那个
 * 副本的根(改过之后最早开的那个;副本删了也算),不看文件此刻在不在——合入后文件回到主目录,归属不变。以前的登记
 * 没有 movedFiles:文件此刻不在改它的根(editedRoot)时按 movedToReplica 推断。都不是 → null。这些产出读文件头、
 * 找提交都按副本算。只看改它的根、不看当前根,哪个根跑这一轮都一样(spec:2026-11-05-数据按项目放用户目录 D13);
 * 只有主目录加副本时,结果和原来按主目录跑的一样。
 */
function movedRootOf(
  ctx: SyncContext,
  editedRoot: string,
  repoRel: string,
  projectRel: string,
  lastChangeTs: string,
): string | null {
  const changeMs = Date.parse(lastChangeTs);
  let hit: { root: string; createdMs: number } | null = null;
  for (const { root, replica } of ctx.roots) {
    if (replica === null || replica.movedFiles === null || !replica.movedFiles.includes(projectRel)) continue;
    const createdMs = Date.parse(replica.createdAt);
    if (createdMs > changeMs && (hit === null || createdMs < hit.createdMs)) hit = { root, createdMs };
  }
  if (hit !== null) return hit.root;
  return fileExistsIn(ctx, editedRoot, repoRel, projectRel) ? null : movedToReplica(ctx, projectRel);
}

/** 提交事件 cwd 所在仓库的查询缓存;cwd 为空或目录已不在 → null。 */
function commitCwdGit(ctx: SyncContext, cwd: string): GitCache | null {
  return cwd !== '' && isDirectory(cwd) ? ctx.gitFor(cwd) : null;
}

/**
 * 提交相关的查询用哪个仓库:当前根的仓库有这个提交 → 当前根;否则这条提交事件的 cwd 目录还在 → cwd 所在的
 * 仓库(别的 clone、副本里做的、当前根的仓库还没取回的提交);否则当前根。
 */
function gitForCommit(ctx: SyncContext, hash: string, cwd: string): GitCache {
  if (ctx.git.hasCommit(hash)) return ctx.git;
  return commitCwdGit(ctx, cwd) ?? ctx.git;
}

/**
 * 提交推送过没有:当前根仓库的远程跟踪分支里有就算;没有再到提交事件 cwd 所在的仓库查一次——别的 clone、
 * 副本推送出去的远程分支,当前根的仓库要等自己 fetch 之后才知道。
 */
function isPushed(ctx: SyncContext, hash: string, cwd: string): boolean {
  if (ctx.git.isOnRemote(hash)) return true;
  const git = commitCwdGit(ctx, cwd);
  return git !== null && git !== ctx.git && git.isOnRemote(hash);
}

/** 文件在不在:当前根照原来按仓库根拼仓库相对路径;别的根按那个根拼项目内路径。 */
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
  const commitRoots = commitRootsOf(ctx, resolver.projectInRepo);
  const commitRootOf = (e: TimelineEvent): string => commitRoots.byEvent.get(e.id) ?? ctx.projectRoot;
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
    // 提交里的文件落在提交所在的根(别的根里做的提交 → 那个根)
    const root = commitRoots.byHash.get(c.hash);
    for (const f of c.files) addCandidate(resolver.fromRepoRel(f, root), c.ts);
  }

  const outputPaths = new Set<string>();
  for (const c of candidates.values()) outputPaths.add(c.projectRel);

  const artifacts: IngestArtifact[] = [];
  const unreported: UnreportedArtifact[] = [];
  for (const [repoRel, { projectRel, root: editedRoot, lastChangeTs }] of candidates) {
    // 文件所在的根:一般就是改它时所在的根;在不是副本的根里写、/dev-start 时移进副本的需求文件算那个副本
    const root = isReplicaRoot(ctx, editedRoot)
      ? editedRoot
      : (movedRootOf(ctx, editedRoot, repoRel, projectRel, lastChangeTs) ?? editedRoot);
    // 读文件头、判断文件在不在都在文件所在的根里做;那个根已不在就退回当前根
    const base = rootOrCurrent(root, ctx.projectRoot);
    const identity = identifyArtifact(base, projectRel);
    if (identity === null || identity.localOnly) continue;

    const changeMs = Date.parse(lastChangeTs);
    // 提交要和产出在同一个根里:同一项目各根的仓库相对路径相同,只比路径会对上别的根里的提交
    const commit = ctx.commitEvents.find(
      (ce) =>
        ce.commit_hash !== null &&
        Date.parse(ce.ts) >= changeMs &&
        ce.commit_files.includes(repoRel) &&
        commitRootOf(ce) === root,
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
      const git = gitForCommit(ctx, hash, commit.cwd);
      artifact = {
        type: identity.type,
        path: repoRel,
        action: git.fileAddedIn(hash, repoRel) ? 'create' : 'modify',
        commitHash: isPushed(ctx, hash, commit.cwd) ? hash : null,
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
