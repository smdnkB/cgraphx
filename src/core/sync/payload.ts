/**
 * 上报内容构造(spec §5.1–§5.4、§6):从本地数据正向构造白名单内的 `IngestSession`。
 *
 * 每个协议字段只取自 plan T-3「字段来源表」,逐字段赋值,不展开 / 透传任何本地对象。
 * 从不读取 prompt 原文(仅 parseSlashSkill 内部取命令名)、命令原文、工具结果摘要(仅判断 success)、cwd(仅推断路径解析)。
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { agentConfigDir, listAgentProfiles } from '../agents';
import { listEffectiveBindings, listMyFeatureTaskDeclarations, type EffectiveBinding } from '../task';
import { listCommitEvents, listSessionEventsAfter, type TimelineEvent } from '../timeline';
import { collectSessionArtifacts } from './artifacts';
import { TERMINAL_SESSION_PREFIX } from './constants';
import { SyncArgError } from './errors';
import { createGitCache, getOriginUrl, getRepoToplevel, type GitCache } from './git';
import { isSafeRelPath } from './paths';
import { collectSessionReferences } from './references';
import { openSyncDb } from './schema-bootstrap';
import { listAllReferenceRecords } from './store';
import type { IngestBinding, IngestCommit, IngestEvent, IngestSession, IngestTaskDeclaration } from './types';
import { getClientVersion } from './version';

export interface SyncContext {
  projectRoot: string;
  repoRoot: string;
  remoteUrl: string;
  clientVersion: string;
  /** 服务端是否支持任务声明与任务键(协议 1.1);参与绑定段哈希。 */
  supportsTaskKey: boolean;
  /** 全部 git_commit 事件(listCommitEvents,ts、id 升序)。 */
  commitEvents: TimelineEvent[];
  /** 有效绑定(含被取代段),按会话分组。 */
  bindingsBySession: Map<string, EffectiveBinding[]>;
  git: GitCache;
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
  recordCount: number;
}

/**
 * 构造一轮同步的上下文。
 *
 * @throws SyncArgError 取不到 origin 远程地址或仓库根。
 */
export async function createSyncContext(
  projectRoot: string,
  opts: { supportsTaskKey?: boolean } = {},
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

  return {
    projectRoot: root,
    repoRoot,
    remoteUrl,
    clientVersion: getClientVersion(),
    supportsTaskKey: opts.supportsTaskKey === true,
    commitEvents: await listCommitEvents(root),
    bindingsBySession,
    git: createGitCache(repoRoot),
    skillDirs,
    referenceRecords: loadReferenceRecords(root),
  };
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

/**
 * 绑定段哈希:先映射成 IngestBinding 再求(任务名 / 状态变化不触发重发)。
 * 输入包含「服务端是否支持任务键」:服务端首次升级到 1.1 时各会话哈希变化,自动重报一次。
 */
export function bindingsHashOf(entries: EffectiveBinding[], supportsTaskKey: boolean): string {
  return sha256(
    stableStringify({
      supportsTaskKey,
      bindings: sortedBindings(entries.map((entry) => toIngestBinding(entry, supportsTaskKey))),
    }),
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

function finish(session: IngestSession, maxEventId: number, bindingsHash: string): BuiltSession {
  return {
    session,
    maxEventId,
    bindingsHash,
    extrasHash: extrasHashOf(session),
    pendingPush: session.artifacts.some((a) => a.commitHash === null),
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
  const { artifacts, outputPaths } = collectSessionArtifacts(ctx, allEvents, commits);
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
  return finish(session, maxEventId, bindingsHashOf(entries, ctx.supportsTaskKey));
}

/** 本仓库终端会话 id:前缀 + sha256(origin 远程地址) 前 16 位十六进制。 */
export function terminalSessionId(remoteUrl: string): string {
  return TERMINAL_SESSION_PREFIX + sha256(remoteUrl).slice(0, 16);
}

/** 构造终端会话(session_id 为空的 commit);没有终端 commit 返回 null。 */
export function buildTerminalPayload(ctx: SyncContext): BuiltSession | null {
  const terminalEvents = ctx.commitEvents.filter((e) => e.session_id === null);
  const commits = toIngestCommits(terminalEvents);
  if (commits.length === 0) return null;
  const { artifacts } = collectSessionArtifacts(ctx, [], commits);

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
  return finish(session, maxEventId, bindingsHashOf([], ctx.supportsTaskKey));
}
