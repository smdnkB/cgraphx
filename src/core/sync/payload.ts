/**
 * 上报内容构造(spec §5.1–§5.4、§6):从本地数据正向构造白名单内的 `IngestSession`。
 *
 * 每个协议字段只取自 plan T-3「字段来源表」,逐字段赋值,不展开 / 透传任何本地对象。
 * 从不读取 prompt 原文(仅 parseSlashSkill 内部取命令名)、命令原文、工具结果摘要(仅判断 success)、
 * cwd(仅推断路径解析与提交在哪个副本里做)。
 *
 * 一轮上报以主目录为准(spec D25):上下文带「主目录 + 全部登记过的副本」,路径按它换算(D26);
 * 副本里没对上会话的提交不进仓库终端会话,每个副本单独成一个带绑定的会话(D28)。
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { agentConfigDir, listAgentProfiles } from '../agents';
import { ARTIFACT_MAPPING_VERSION } from '../artifact-registry';
import { listProjectRoots, replicaOfCwd, type ProjectRoot, type ReplicaEntry } from '../replica';
import {
  featureBindingTarget,
  listEffectiveBindings,
  listMyFeatureTaskDeclarations,
  type EffectiveBinding,
} from '../task';
import { listCommitEvents, listSessionEventsAfter, type TimelineEvent } from '../timeline';
import { collectSessionArtifacts, reportableTypesFor } from './artifacts';
import { REPLICA_SESSION_PREFIX, TERMINAL_SESSION_PREFIX } from './constants';
import { SyncArgError } from './errors';
import { createGitCache, getOriginUrl, getRepoToplevel, type GitCache } from './git';
import { isSafeRelPath } from './paths';
import { collectSessionReferences } from './references';
import { openSyncDb } from './schema-bootstrap';
import { listAllReferenceRecords } from './store';
import type {
  IngestBinding,
  IngestCommit,
  IngestEvent,
  IngestSession,
  IngestTaskDeclaration,
  UnreportedArtifact,
} from './types';
import { getClientVersion, type ServerTier } from './version';

export interface SyncContext {
  projectRoot: string;
  repoRoot: string;
  remoteUrl: string;
  clientVersion: string;
  /** 服务端协议档位(spec §11.1)。 */
  tier: ServerTier;
  /** 服务端是否支持任务声明与任务键(协议 ≥ 1.1,即 tier !== '1.0');参与绑定段哈希。 */
  supportsTaskKey: boolean;
  /** 本档位可上报的产出类型集合(spec §11.1)。 */
  allowedTypes: ReadonlySet<string>;
  /** 是否重新评估全部会话;createSyncContext 恒置 false,由 runner 改写。 */
  reevaluateAll: boolean;
  /** 全部 git_commit 事件(listCommitEvents,ts、id 升序)。 */
  commitEvents: TimelineEvent[];
  /** 有效绑定(含被取代段),按会话分组。 */
  bindingsBySession: Map<string, EffectiveBinding[]>;
  /** 主目录仓库的 git 查询缓存。 */
  git: GitCache;
  /** 按根取 git 查询缓存:主目录返回 `git`,副本按根懒建、一轮内复用(spec D29)。 */
  gitFor(root: string): GitCache;
  /** 主目录 + 全部登记过的副本(含已删除),按根路径长度降序;没有登记副本时只有主目录(spec D26)。 */
  roots: ProjectRoot[];
  /** 提交事件 id → cwd 所在的副本;只放在副本里做的提交,没有登记副本时为空。一轮开始时算一次。 */
  commitReplicas: Map<number, ReplicaEntry>;
  /** 各已登记 agent 的项目级与用户级 `<configDir>/skills`。 */
  skillDirs: string[];
  /** 参考精确记录按会话分组(各组内 id 升序);一轮同步开始时一次性预载。 */
  referenceRecords: Map<string, Array<{ kind: 'concept' | 'file'; value: string; ts: string }>>;
}

export interface BuiltSession {
  session: IngestSession;
  maxEventId: number;
  bindingsHash: string;
  extrasHash: string;
  /** 存在 `commitHash = null` 的产出(未提交或未推送),推送后需重新上报。 */
  pendingPush: boolean;
  /** 档位过滤后不发送的产出(不参与上报与哈希)。 */
  unreported: UnreportedArtifact[];
  recordCount: number;
}

/**
 * 构造一轮同步的上下文。
 *
 * @throws SyncArgError 取不到 origin 远程地址或仓库根。
 */
export async function createSyncContext(
  projectRoot: string,
  opts?: { tier?: ServerTier; projectTypes?: readonly string[] | null },
): Promise<SyncContext> {
  const root = path.resolve(projectRoot);
  const remoteUrl = getOriginUrl(root);
  if (remoteUrl === null) {
    throw new SyncArgError('当前仓库没有 origin 远程地址,请先运行 `git remote add origin <url>`');
  }
  const repoRoot = getRepoToplevel(root);
  if (repoRoot === null) {
    throw new SyncArgError(`${root} 不在 git 仓库内,请在 git 仓库内运行`);
  }

  const bindingsBySession = new Map<string, EffectiveBinding[]>();
  for (const entry of listEffectiveBindings(root, { includeSuperseded: true })) {
    const list = bindingsBySession.get(entry.binding.sessionId);
    if (list === undefined) bindingsBySession.set(entry.binding.sessionId, [entry]);
    else list.push(entry);
  }

  const skillDirs: string[] = [];
  for (const profile of listAgentProfiles()) {
    skillDirs.push(path.join(agentConfigDir(root, profile), 'skills'));
    skillDirs.push(path.join(os.homedir(), profile.configDirName, 'skills'));
  }

  const tier = opts?.tier ?? '1.0';
  const commitEvents = await listCommitEvents(root);
  const roots = listProjectRoots(root);

  const git = createGitCache(repoRoot);
  const replicaGits = new Map<string, GitCache>();
  const gitFor = (gitRoot: string): GitCache => {
    if (gitRoot === root) return git;
    let cache = replicaGits.get(gitRoot);
    if (cache === undefined) {
      cache = createGitCache(getRepoToplevel(gitRoot) ?? gitRoot);
      replicaGits.set(gitRoot, cache);
    }
    return cache;
  };

  return {
    projectRoot: root,
    repoRoot,
    remoteUrl,
    clientVersion: getClientVersion(),
    tier,
    supportsTaskKey: tier !== '1.0',
    allowedTypes: reportableTypesFor(tier, opts?.projectTypes ?? null),
    reevaluateAll: false,
    commitEvents,
    bindingsBySession,
    git,
    gitFor,
    roots,
    commitReplicas: mapCommitReplicas(roots, commitEvents),
    skillDirs,
    referenceRecords: loadReferenceRecords(root),
  };
}

/**
 * 提交事件 id → cwd 所在的副本(replica 门面 replicaOfCwd)。没有登记副本时直接返回空表;
 * cwd 为空的事件不知道在哪做的,按主目录算。
 */
function mapCommitReplicas(
  roots: readonly ProjectRoot[],
  commitEvents: readonly TimelineEvent[],
): Map<number, ReplicaEntry> {
  const map = new Map<number, ReplicaEntry>();
  if (!roots.some((r) => r.replica !== null)) return map;
  for (const e of commitEvents) {
    if (e.cwd === '') continue;
    const replica = replicaOfCwd(roots, e.cwd);
    if (replica !== null) map.set(e.id, replica);
  }
  return map;
}

/** 一次开库预载全部参考精确记录并按会话分组;库未初始化等异常 → 空 Map,不抛。 */
function loadReferenceRecords(projectRoot: string): SyncContext['referenceRecords'] {
  const grouped: SyncContext['referenceRecords'] = new Map();
  let rows: ReturnType<typeof listAllReferenceRecords>;
  try {
    const conn = openSyncDb(projectRoot);
    try {
      rows = listAllReferenceRecords(conn.getDb());
    } finally {
      conn.close();
    }
  } catch {
    return grouped;
  }
  for (const { sessionId, kind, value, ts } of rows) {
    const list = grouped.get(sessionId);
    if (list === undefined) grouped.set(sessionId, [{ kind, value, ts }]);
    else list.push({ kind, value, ts });
  }
  return grouped;
}

// ─── 字段构造 ───────────────────────────────────────────────────────────────

const SLASH_COMMAND_RE = /^\/([A-Za-z0-9][\w.:-]*)(\s|$)/;

/** 斜杠命令 → skill 名;只返回命令名,不返回 prompt 其余内容。内置命令(如 `/clear`)返回 undefined。 */
export function parseSlashSkill(prompt: string, skillDirs: string[]): string | undefined {
  const m = SLASH_COMMAND_RE.exec(prompt.trim());
  const name = m?.[1];
  if (name === undefined) return undefined;
  if (name.includes(':')) return name;
  return skillDirs.some((dir) => fs.existsSync(path.join(dir, name, 'SKILL.md'))) ? name : undefined;
}

function skillNameOf(e: TimelineEvent, skillDirs: string[]): string | undefined {
  if (e.tool_name === 'Skill') {
    const args = e.tool_args;
    if (typeof args === 'object' && args !== null && !Array.isArray(args)) {
      const skill = (args as Record<string, unknown>).skill;
      if (typeof skill === 'string') return skill;
    }
    return undefined;
  }
  if (e.event_type === 'user_prompt' && e.prompt_text !== null) return parseSlashSkill(e.prompt_text, skillDirs);
  return undefined;
}

function toIngestEvent(e: TimelineEvent, skillDirs: string[]): IngestEvent {
  const event: IngestEvent = { eventId: String(e.id), ts: e.ts, type: e.event_type };
  if (e.tool_name !== null) event.toolName = e.tool_name;
  const skillName = skillNameOf(e, skillDirs);
  if (skillName !== undefined) event.skillName = skillName;
  return event;
}

/**
 * 有效绑定 → 协议绑定段。
 *
 * - 被取代段按零长度区间(end = start)重报,平台以段 id 最新为准,避免与派生段重叠双算;
 * - 目录任务带任务键(服务端支持 1.1 时),有回执映射时同时带平台任务 id;
 * - 头部关联的平台任务只带平台任务 id;本地手动任务都不带(平台算未归属)。
 */
function toIngestBinding(entry: EffectiveBinding, supportsTaskKey: boolean): IngestBinding {
  const { binding, task } = entry;
  const out: IngestBinding = {
    bindingId: entry.bindingKey,
    taskId: task.source === 'api' || task.source === 'feature' ? task.externalId : null,
    start: binding.boundAt,
    end: entry.superseded ? binding.boundAt : binding.unboundAt,
  };
  if (supportsTaskKey && task.source === 'feature' && task.featureId !== null) {
    out.taskKey = task.featureId;
  }
  return out;
}

/** commit 事件 → IngestCommit;无 hash 的跳过,按 hash 去重保留首条。 */
function toIngestCommits(commitEvents: TimelineEvent[]): IngestCommit[] {
  const seen = new Set<string>();
  const commits: IngestCommit[] = [];
  for (const e of commitEvents) {
    if (e.commit_hash === null || seen.has(e.commit_hash)) continue;
    seen.add(e.commit_hash);
    commits.push({
      hash: e.commit_hash,
      message: e.commit_message ?? '',
      branch: typeof e.metadata.branch === 'string' ? e.metadata.branch : null,
      files: e.commit_files.filter(isSafeRelPath),
      insertions: e.commit_insertions ?? 0,
      deletions: e.commit_deletions ?? 0,
      ts: e.ts,
    });
  }
  return commits;
}

// ─── 哈希 ───────────────────────────────────────────────────────────────────

/** 稳定 JSON:对象键按字典序;数组保持调用方给定顺序。 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

/**
 * 重新评估基准(spec §11.6):映射版本、档位、可上报类型集合任一变化 → 基准变化,
 * 下一轮重新评估全部会话的产出。
 */
export function basisOf(ctx: SyncContext): string {
  return sha256(
    stableStringify({
      mapping: ARTIFACT_MAPPING_VERSION,
      tier: ctx.tier,
      allowed: [...ctx.allowedTypes].sort(),
    }),
  );
}

function byKey<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function sortedBindings(bindings: IngestBinding[]): IngestBinding[] {
  return byKey(bindings, (b) => b.bindingId);
}

/** 协议绑定段的哈希(有效绑定的会话与副本会话共用一个口径)。 */
function ingestBindingsHash(bindings: IngestBinding[], supportsTaskKey: boolean): string {
  return sha256(stableStringify({ supportsTaskKey, bindings: sortedBindings(bindings) }));
}

/**
 * 绑定段哈希:先映射成 IngestBinding 再求(任务名 / 状态变化不触发重发)。
 * 输入包含「服务端是否支持任务键」:支持与否变化时(如服务端升级到 1.1 及以上)各会话哈希变化,自动重报一次。
 */
export function bindingsHashOf(entries: EffectiveBinding[], supportsTaskKey: boolean): string {
  return ingestBindingsHash(
    entries.map((entry) => toIngestBinding(entry, supportsTaskKey)),
    supportsTaskKey,
  );
}

/**
 * 本批的任务声明:本人负责、且任务键出现在本批任一绑定段上的目录任务。
 * 服务端不支持 1.1 或本批没有可声明的任务时返回 undefined(请求体不带该字段)。
 */
export function taskDeclarationsFor(
  ctx: SyncContext,
  bindings: IngestBinding[],
): IngestTaskDeclaration[] | undefined {
  if (!ctx.supportsTaskKey) return undefined;
  const keys = new Set<string>();
  for (const binding of bindings) {
    if (binding.taskKey !== undefined) keys.add(binding.taskKey);
  }
  if (keys.size === 0) return undefined;
  const declarations = listMyFeatureTaskDeclarations(ctx.projectRoot)
    .filter((d) => keys.has(d.featureId))
    .map((d) => ({ taskKey: d.featureId, name: d.name, declaredAt: d.declaredAt }));
  return declarations.length > 0 ? declarations : undefined;
}

/** bindings / commits / artifacts / references 的哈希(不含 events)。 */
export function extrasHashOf(session: IngestSession): string {
  return sha256(
    stableStringify({
      bindings: sortedBindings(session.bindings),
      commits: byKey(session.commits, (c) => c.hash),
      artifacts: byKey(session.artifacts, (a) => `${a.type}\0${a.path}`),
      references: byKey(session.references, (r) => `${r.kind}\0${r.value}`),
    }),
  );
}

function finish(
  session: IngestSession,
  maxEventId: number,
  bindingsHash: string,
  unreported: UnreportedArtifact[],
): BuiltSession {
  return {
    session,
    maxEventId,
    bindingsHash,
    extrasHash: extrasHashOf(session),
    pendingPush: session.artifacts.some((a) => a.commitHash === null),
    unreported,
    recordCount:
      session.events.length +
      session.bindings.length +
      session.commits.length +
      session.artifacts.length +
      session.references.length,
  };
}

// ─── 会话构造 ───────────────────────────────────────────────────────────────

/**
 * 构造一个 agent 会话的上报内容。`events` 只放 `id > afterEventId` 的;bindings / commits / artifacts / references 放全量。
 */
export async function buildSessionPayload(
  ctx: SyncContext,
  sessionId: string,
  afterEventId: number,
): Promise<BuiltSession> {
  const allEvents = await listSessionEventsAfter(ctx.projectRoot, sessionId, 0);
  const entries = ctx.bindingsBySession.get(sessionId) ?? [];
  const commits = toIngestCommits(ctx.commitEvents.filter((e) => e.session_id === sessionId));
  const { artifacts, outputPaths, unreported } = collectSessionArtifacts(ctx, allEvents, commits);
  const references = collectSessionReferences(ctx, sessionId, allEvents, outputPaths);

  let maxEventId = afterEventId;
  for (const e of allEvents) if (e.id > maxEventId) maxEventId = e.id;

  const session: IngestSession = {
    clientSessionId: sessionId,
    events: allEvents.filter((e) => e.id > afterEventId).map((e) => toIngestEvent(e, ctx.skillDirs)),
    bindings: entries.map((entry) => toIngestBinding(entry, ctx.supportsTaskKey)),
    commits,
    artifacts,
    references,
  };
  return finish(session, maxEventId, bindingsHashOf(entries, ctx.supportsTaskKey), unreported);
}

/** 本仓库终端会话 id:前缀 + sha256(origin 远程地址) 前 16 位十六进制。 */
export function terminalSessionId(remoteUrl: string): string {
  return TERMINAL_SESSION_PREFIX + sha256(remoteUrl).slice(0, 16);
}

/**
 * 构造仓库终端会话(session_id 为空、不在副本里做的 commit);没有这样的 commit 返回 null。
 * 副本里做的归各自的副本会话(buildReplicaSessionPayloads)。
 */
export function buildTerminalPayload(ctx: SyncContext): BuiltSession | null {
  const terminalEvents = ctx.commitEvents.filter((e) => e.session_id === null && !ctx.commitReplicas.has(e.id));
  const commits = toIngestCommits(terminalEvents);
  if (commits.length === 0) return null;
  const { artifacts, unreported } = collectSessionArtifacts(ctx, [], commits);

  let maxEventId = 0;
  for (const e of terminalEvents) if (e.id > maxEventId) maxEventId = e.id;

  const session: IngestSession = {
    clientSessionId: terminalSessionId(ctx.remoteUrl),
    events: [],
    bindings: [],
    commits,
    artifacts,
    references: [],
  };
  return finish(session, maxEventId, bindingsHashOf([], ctx.supportsTaskKey), unreported);
}

/** 副本会话 id:前缀 + sha256(origin 远程地址) 前 16 位 + `-` + sha256(副本目录名) 前 8 位(十六进制)。 */
export function replicaSessionId(remoteUrl: string, replicaName: string): string {
  return `${REPLICA_SESSION_PREFIX}${sha256(remoteUrl).slice(0, 16)}-${sha256(replicaName).slice(0, 8)}`;
}

/** 这些 commit 里最早的 ts(调用方保证非空)。 */
function earliestCommitTs(commits: IngestCommit[]): string {
  let earliest: string | null = null;
  for (const c of commits) {
    if (earliest === null || Date.parse(c.ts) < Date.parse(earliest)) earliest = c.ts;
  }
  return earliest ?? '';
}

/**
 * 副本会话的那一条绑定:指向副本需求对应的平台任务(只经 task 门面 featureBindingTarget 取),
 * 从这些提交里最早的一条起、不设结束;任务键只在有、且服务端支持任务键时带(同 toIngestBinding)。
 */
function replicaBinding(ctx: SyncContext, sessionId: string, featureId: string, commits: IngestCommit[]): IngestBinding {
  const target = featureBindingTarget(ctx.projectRoot, featureId);
  const binding: IngestBinding = {
    bindingId: `${sessionId}:replica`,
    taskId: target.taskId,
    start: earliestCommitTs(commits),
    end: null,
  };
  if (ctx.supportsTaskKey && target.taskKey !== null) binding.taskKey = target.taskKey;
  return binding;
}

/**
 * 构造副本会话(spec D28):session_id 为空、在副本里做的 commit 按副本分组,每个副本一个会话。
 * events / references 为空;commits、artifacts 照仓库终端会话构造(产出只看提交里的文件,路径按提交
 * 所在的根换算);绑定一条(replicaBinding)。没有登记副本、或副本里没有这样的 commit 时返回空数组。
 */
export function buildReplicaSessionPayloads(ctx: SyncContext): BuiltSession[] {
  // 副本目录名 → 该副本里没对上会话的提交事件(保持 commitEvents 的 ts、id 升序)
  const groups = new Map<string, { replica: ReplicaEntry; events: TimelineEvent[] }>();
  for (const e of ctx.commitEvents) {
    if (e.session_id !== null) continue;
    const replica = ctx.commitReplicas.get(e.id);
    if (replica === undefined) continue;
    const group = groups.get(replica.name);
    if (group === undefined) groups.set(replica.name, { replica, events: [e] });
    else group.events.push(e);
  }

  const built: BuiltSession[] = [];
  for (const { replica, events } of groups.values()) {
    const commits = toIngestCommits(events);
    if (commits.length === 0) continue;
    const { artifacts, unreported } = collectSessionArtifacts(ctx, [], commits);

    let maxEventId = 0;
    for (const e of events) if (e.id > maxEventId) maxEventId = e.id;

    const clientSessionId = replicaSessionId(ctx.remoteUrl, replica.name);
    const bindings = [replicaBinding(ctx, clientSessionId, replica.featureId, commits)];
    const session: IngestSession = {
      clientSessionId,
      events: [],
      bindings,
      commits,
      artifacts,
      references: [],
    };
    built.push(finish(session, maxEventId, ingestBindingsHash(bindings, ctx.supportsTaskKey), unreported));
  }
  return built;
}
