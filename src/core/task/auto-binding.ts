/**
 * 自动绑定派生(spec §3.1、§3.2、§6)。
 *
 * `deriveSessionAutoBinding` 是 R1~R7 的唯一实现(纯函数,不碰 DB):
 * 读 = 暂定、写 = 确定;暂定只在读到日期更新的目录时整段改正;确定后不再切换。
 * `refreshAutoBindings` 把结果落到 task_auto_sessions / task_feature_tasks:
 * 存量会话首轮全量重算并标记被取代的旧绑定,之后按会话最大事件 id 增量刷新。
 *
 * 主目录与副本(版本流程与需求副本 spec D25~D27):一律以主目录为准;路径按「主目录 + 全部
 * 登记过的副本」换算;开在副本里的会话归副本登记的需求,不按读写的文件派生。派生只看
 * roots 和事件本身,不看调用方的项目根(sync 的上报进程也会全量刷新)。
 *
 * 只经 timeline / features / agents / replica 门面取数,不依赖 sync。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { DEFAULT_AGENT_ID, requireAgentProfile } from '../agents';
import { readFeatureTask } from '../features';
import {
  listProjectRoots,
  locateFeatureRoot,
  matchProjectRoot,
  replicaOfCwd,
  resolveMainRoot,
  type ProjectRoot,
  type ReplicaEntry,
} from '../replica';
import {
  extractCommandPathCandidates,
  isKillSwitchOn,
  listSessionEventMaxIds,
  listSessionEventsAfter,
  type TimelineEvent,
} from '../timeline';
import { AUTO_META_KEYS } from './constants';
import { featureDatePrefix, isEligibleFeatureDir, isPlatformTaskValue } from './feature-task';
import { openTaskDb } from './schema-bootstrap';
import { TaskStore } from './store';
import type { AutoSession, AutoStrength, TaskBinding, TaskSource } from './types';

/** 首轮历史派生是否完成的元信息键。 */
const HISTORY_PASS_META_KEY = AUTO_META_KEYS[0]!;

/** 项目相对路径中的产出目录(要求目录下至少还有一段,即指向文件)。 */
const FEATURE_DIR_PATTERN = /^docs\/features\/([^/]+)\/.+/;

/** 一次派生结果。 */
export interface AutoDerivation {
  featureId: string;
  strength: AutoStrength;
  /** 区间起点:本会话最早一条事件的 ts(不受 cutoff 影响)。 */
  boundAt: string;
}

export interface DeriveSessionAutoBindingInput {
  /** 本会话全部事件,id 升序。 */
  events: TimelineEvent[];
  /** 只看 ts < cutoffTs 的事件;null = 不截止。 */
  cutoffTs: string | null;
  /** 主目录 + 全部登记过的副本(listProjectRoots):路径换算与「会话开在哪个副本」都按它判断。 */
  roots: readonly ProjectRoot[];
  isEligible: (featureId: string) => boolean;
}

/** 写类工具集合(按事件 agent 取描述;agent 缺失或未知时按默认 agent)。 */
const writeToolsCache = new Map<string, ReadonlySet<string>>();

function writeToolsFor(agent: TimelineEvent['agent']): ReadonlySet<string> {
  const key = agent ?? DEFAULT_AGENT_ID;
  const cached = writeToolsCache.get(key);
  if (cached !== undefined) return cached;
  let tools: readonly string[];
  try {
    tools = requireAgentProfile(key).writeTools;
  } catch {
    tools = requireAgentProfile(DEFAULT_AGENT_ID).writeTools;
  }
  const set = new Set(tools);
  writeToolsCache.set(key, set);
  return set;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** tool_args 的字符串字段;非字符串或空串返回 null。 */
function argString(e: TimelineEvent, key: string): string | null {
  if (!isRecord(e.tool_args)) return null;
  const v = e.tool_args[key];
  return typeof v === 'string' && v !== '' ? v : null;
}

/** 写工具结果是否成功;解析失败或没有 success 字段都按成功。 */
function isSuccessfulWrite(summary: string | null): boolean {
  if (summary === null) return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(summary);
  } catch {
    return true;
  }
  return !isRecord(parsed) || parsed['success'] !== false;
}

/**
 * 绝对 / 相对路径 → 所在根(主目录或副本)下的项目相对 POSIX 路径;哪个根里都不在返回 null。
 * candidate 相对 base 解析(相对路径基于事件 cwd)。
 */
function toProjectRelative(roots: readonly ProjectRoot[], base: string, candidate: string): string | null {
  return matchProjectRoot(roots, path.resolve(base, candidate))?.rel ?? null;
}

/**
 * 路径 → 合格产出目录的 feature-id。
 * requireExisting 时还要求解析出的文件真实存在(Bash 读口径)。
 */
function featureFromPath(
  roots: readonly ProjectRoot[],
  base: string,
  candidate: string,
  isEligible: (featureId: string) => boolean,
  requireExisting: boolean,
): string | null {
  const rel = toProjectRelative(roots, base, candidate);
  if (rel === null) return null;
  const featureId = FEATURE_DIR_PATTERN.exec(rel)?.[1];
  if (featureId === undefined || !isEligible(featureId)) return null;
  if (requireExisting) {
    try {
      if (!fs.statSync(path.resolve(base, candidate)).isFile()) return null;
    } catch {
      return null;
    }
  }
  return featureId;
}

/** 写事件命中的产出目录;失败调用不算。 */
function writeFeatureId(
  e: TimelineEvent,
  roots: readonly ProjectRoot[],
  isEligible: (featureId: string) => boolean,
): string | null {
  if (!isSuccessfulWrite(e.tool_result_summary)) return null;
  if (!isRecord(e.tool_args)) return null;
  const notebook = e.tool_args['notebook_path'];
  const file = e.tool_args['file_path'];
  const candidate =
    typeof notebook === 'string' && notebook !== ''
      ? notebook
      : typeof file === 'string' && file !== ''
        ? file
        : null;
  if (candidate === null) return null;
  return featureFromPath(roots, e.cwd, candidate, isEligible, false);
}

/** Read 事件命中的产出目录。 */
function readFeatureId(
  e: TimelineEvent,
  roots: readonly ProjectRoot[],
  isEligible: (featureId: string) => boolean,
): string | null {
  const candidate = argString(e, 'file_path');
  if (candidate === null) return null;
  return featureFromPath(roots, e.cwd, candidate, isEligible, false);
}

/**
 * Bash 事件命中的产出目录:复用命令文本推断口径(含 cd 前缀解析、跳过含 $ 的片段),
 * 每个 token 依次用每个候选基准目录解析,解析出的文件存在才算。Grep / Glob 不算。
 */
function bashFeatureId(
  e: TimelineEvent,
  roots: readonly ProjectRoot[],
  isEligible: (featureId: string) => boolean,
): string | null {
  const command = argString(e, 'command');
  if (command === null) return null;
  for (const { bases, token } of extractCommandPathCandidates(command, e.cwd)) {
    for (const base of bases) {
      const featureId = featureFromPath(roots, base, token, isEligible, true);
      if (featureId !== null) return featureId;
    }
  }
  return null;
}

/** 单条事件对状态的贡献;不是读 / 写合格目录的事件返回 null。 */
function classifyEvent(
  e: TimelineEvent,
  roots: readonly ProjectRoot[],
  isEligible: (featureId: string) => boolean,
): { featureId: string; strength: AutoStrength } | null {
  if (e.event_type !== 'post_tool_use' || e.tool_name === null) return null;
  const tool = e.tool_name;

  if (writeToolsFor(e.agent).has(tool)) {
    const featureId = writeFeatureId(e, roots, isEligible);
    return featureId === null ? null : { featureId, strength: 'write' };
  }
  if (tool === 'Read') {
    const featureId = readFeatureId(e, roots, isEligible);
    return featureId === null ? null : { featureId, strength: 'read' };
  }
  if (tool === 'Bash') {
    const featureId = bashFeatureId(e, roots, isEligible);
    return featureId === null ? null : { featureId, strength: 'read' };
  }
  return null;
}

/** D2 的日期段是否晚于 D1;取不到日期视为最早。 */
function isLaterFeature(featureId: string, current: string): boolean {
  const next = featureDatePrefix(featureId);
  const prev = featureDatePrefix(current);
  if (next === null) return false;
  if (prev === null) return true;
  return next > prev;
}

/** 会话开在哪个副本:看本会话 id 最小的一条事件的 cwd;开在主目录里 → null。 */
function sessionReplica(events: readonly TimelineEvent[], roots: readonly ProjectRoot[]): ReplicaEntry | null {
  let first: TimelineEvent | undefined;
  for (const e of events) {
    if (first === undefined || e.id < first.id) first = e;
  }
  return first === undefined ? null : replicaOfCwd(roots, first.cwd);
}

/**
 * 派生单个会话的自动绑定(纯函数)。
 *
 * 会话开在副本里(K2):归副本登记的需求,确定绑定,不按读写的文件派生,也不要求需求目录合格;
 * cutoff 不晚于会话最早一条事件时(显式绑定在先)没有结果。
 * 开在主目录里:按 R1~R7——只看 cutoff 之前的 post_tool_use 事件;写成功 → 确定绑定,D 取最后一次
 * 未确定的写;读 → 暂定,只有日期段更新的目录能整段改正它。
 * 有结果时 boundAt = 会话最早一条事件的 ts(任意类型,不受 cutoff 影响)。
 */
export function deriveSessionAutoBinding(
  input: DeriveSessionAutoBindingInput,
): AutoDerivation | null {
  const first = input.events[0];
  if (first === undefined) return null;
  let boundAt = first.ts;
  for (const e of input.events) {
    if (e.ts < boundAt) boundAt = e.ts;
  }

  const replica = sessionReplica(input.events, input.roots);
  if (replica !== null) {
    if (input.cutoffTs !== null && !(boundAt < input.cutoffTs)) return null;
    return { featureId: replica.featureId, strength: 'write', boundAt };
  }

  let state: { featureId: string; strength: AutoStrength } | null = null;

  for (const e of input.events) {
    if (e.event_type !== 'post_tool_use') continue;
    if (input.cutoffTs !== null && !(e.ts < input.cutoffTs)) continue;
    // R5:确定绑定后任何事件都不再改变归属。
    if (state?.strength === 'write') break;

    const hit = classifyEvent(e, input.roots, input.isEligible);
    if (hit === null) continue;

    if (state === null) {
      state = hit;
    } else if (hit.strength === 'write') {
      // R4:写整段改正(含暂定 → 确定)。
      state = hit;
    } else if (isLaterFeature(hit.featureId, state.featureId)) {
      // R2:暂定只在更新日期的读上改正;R3 同日 / 更早不变。
      state = { featureId: hit.featureId, strength: 'read' };
    }
  }

  if (state === null) return null;
  return { featureId: state.featureId, strength: state.strength, boundAt };
}

// ─── 刷新落表 ──────────────────────────────────────────────────────────────

export interface RefreshAutoBindingsOptions {
  /** 只刷新这些会话(与时间线中有事件的会话取交集);缺省全部会话。 */
  sessionIds?: string[];
}

export interface RefreshAutoBindingsResult {
  recomputed: number;
  historyPass: boolean;
}

/**
 * 首轮历史派生是否已完成(Stop hook 据此决定本次是否全量刷新)。
 * 与 refreshAutoBindings 共用同一个元信息键;DB 未初始化时抛错,由 hook 骨架吞掉。
 */
export function isHistoryPassDone(projectRoot: string): boolean {
  const conn = openTaskDb(path.resolve(projectRoot));
  try {
    return new TaskStore(conn.getDb()).getMeta(HISTORY_PASS_META_KEY) !== null;
  } finally {
    conn.close();
  }
}

/** 保留绑定中最早的 bound_at;predicate 用于首轮只考虑接口任务手动行。 */
function earliestBoundAt(
  bindings: TaskBinding[] | undefined,
  superseded: Set<number>,
  predicate?: (binding: TaskBinding) => boolean,
): string | null {
  let earliest: string | null = null;
  for (const b of bindings ?? []) {
    if (superseded.has(b.id)) continue;
    if (predicate !== undefined && !predicate(b)) continue;
    if (earliest === null || b.boundAt < earliest) earliest = b.boundAt;
  }
  return earliest;
}

/**
 * 需求 → 本机任务行:主 spec 头部声明了平台编号 → 本机没有占位时补建(否则读取 / 上报解析不到任务);
 * 否则 → 目录任务。
 */
function ensureTaskForFeature(store: TaskStore, root: string, featureId: string, now: string): void {
  const declared = readFeatureTask(locateFeatureRoot(root, featureId) ?? root, featureId);
  if (isPlatformTaskValue(declared)) store.ensureApiPlaceholder(declared, now);
  else store.ensureFeatureTask(featureId, now);
}

/**
 * 在用副本登记的需求补本机任务行:需求目录有带负责人的 spec 才建(spec 还没写时不建,免得建出之后
 * 声明了平台编号也不会再改的目录任务);按头部当前的任务声明定任务,先查后写,已有就不开写事务。
 */
function ensureReplicaFeatureTask(
  store: TaskStore,
  root: string,
  featureId: string,
  isEligible: (featureId: string) => boolean,
  now: string,
): void {
  if (!isEligible(featureId)) return;
  const declared = readFeatureTask(locateFeatureRoot(root, featureId) ?? root, featureId);
  if (isPlatformTaskValue(declared)) {
    if (store.findApiTaskByExternalId(declared) === null) store.transaction(() => store.ensureApiPlaceholder(declared, now));
    return;
  }
  if (store.findFeatureTaskByFeatureId(featureId) === null) store.transaction(() => store.ensureFeatureTask(featureId, now));
}

/** 两个可空时间点取较早者。 */
function earlier(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

/**
 * 刷新所有(或指定)会话的自动绑定派生结果。
 *
 * 首轮(history_pass_done 未设置)全量重算:先对「以接口任务手动绑定为 cutoff 仍能派生
 * 出结果」的会话,把旧 feature_dir 行与指向本地手动任务的 cli 行标记为被取代,
 * 再按正式 cutoff 派生。之后只重算最大事件 id 变了的会话。
 * 在副本里调用与在主目录调用结果相同(一律换成主目录)。
 *
 * CGRAPHX_NO_TIMELINE 开启时不读不写;单会话失败写 stderr 并跳过,不中断其它会话。
 */
export async function refreshAutoBindings(
  projectRoot: string,
  opts: RefreshAutoBindingsOptions = {},
): Promise<RefreshAutoBindingsResult> {
  if (isKillSwitchOn()) return { recomputed: 0, historyPass: false };

  const root = resolveMainRoot(projectRoot);
  const maxIds = await listSessionEventMaxIds(root);
  const conn = openTaskDb(root);
  try {
    const store = new TaskStore(conn.getDb());
    const now = new Date().toISOString();
    const historyPass = store.getMeta(HISTORY_PASS_META_KEY) === null;
    const autoBySession = new Map(
      store.listAutoSessions().map((row): [string, AutoSession] => [row.sessionId, row]),
    );
    const allowed = opts.sessionIds === undefined ? null : new Set(opts.sessionIds);

    const targets = maxIds.filter(({ sessionId, maxId }) => {
      if (allowed !== null && !allowed.has(sessionId)) return false;
      if (historyPass) return true;
      const previous = autoBySession.get(sessionId);
      return previous === undefined || maxId > previous.derivedMaxEventId;
    });

    const bindingsBySession = new Map<string, TaskBinding[]>();
    for (const binding of store.listAllBindings()) {
      const list = bindingsBySession.get(binding.sessionId);
      if (list === undefined) bindingsBySession.set(binding.sessionId, [binding]);
      else list.push(binding);
    }
    const superseded = store.listSupersededBindingIds();

    const taskSources = new Map<number, TaskSource | null>();
    const taskSourceOf = (taskId: number): TaskSource | null => {
      if (!taskSources.has(taskId)) taskSources.set(taskId, store.getTaskById(taskId)?.source ?? null);
      return taskSources.get(taskId) ?? null;
    };

    const eligibleCache = new Map<string, boolean>();
    const isEligible = (featureId: string): boolean => {
      const cached = eligibleCache.get(featureId);
      if (cached !== undefined) return cached;
      const value = isEligibleFeatureDir(root, featureId);
      eligibleCache.set(featureId, value);
      return value;
    };
    // 主目录 + 全部登记过的副本(含已删除):取一次,每个会话的派生共用
    const roots = listProjectRoots(root);

    let recomputed = 0;
    for (const { sessionId, maxId } of targets) {
      try {
        const events = await listSessionEventsAfter(root, sessionId, 0);
        const sessionBindings = bindingsBySession.get(sessionId);
        const existing = autoBySession.get(sessionId);

        // 首轮先验证「去掉本地手动任务的截止后仍能派生」,能派生才取代旧行。
        let obsolete: TaskBinding[] = [];
        if (historyPass) {
          const apiCutoff = earliestBoundAt(
            sessionBindings,
            superseded,
            (b) => b.bindSource === 'cli' && taskSourceOf(b.taskId) === 'api',
          );
          const preliminary = deriveSessionAutoBinding({
            events,
            cutoffTs: apiCutoff,
            roots,
            isEligible,
          });
          if (preliminary !== null) {
            obsolete = (sessionBindings ?? []).filter((b) => {
              if (superseded.has(b.id)) return false;
              if (b.bindSource === 'feature_dir') return true;
              return b.bindSource === 'cli' && taskSourceOf(b.taskId) === 'manual';
            });
          }
        }

        // 正式 cutoff:首轮按「取代后仍保留」的绑定计算,手动之后的事件不参与自动派生。
        const retained = new Set(superseded);
        for (const b of obsolete) retained.add(b.id);
        const cutoffTs = earlier(
          earliestBoundAt(sessionBindings, retained),
          existing?.stoppedAt ?? null,
        );
        const auto = deriveSessionAutoBinding({ events, cutoffTs, roots, isEligible });

        // 取代标记、目录任务与派生结果同事务落库;失败时整会话回滚并跳过。
        store.transaction(() => {
          for (const b of obsolete) store.supersedeBinding(b.id, now);
          if (auto !== null) ensureTaskForFeature(store, root, auto.featureId, now);
          store.upsertAutoSession({
            sessionId,
            derivedMaxEventId: maxId,
            featureId: auto?.featureId ?? null,
            strength: auto?.strength ?? null,
            boundAt: auto?.boundAt ?? null,
            stoppedAt: null,
            derivedAt: now,
          });
        });
        for (const b of obsolete) superseded.add(b.id);
        recomputed += 1;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[task] 派生失败 ${sessionId}: ${reason}\n`);
      }
    }

    // 在用副本登记的需求:没有会话派生到它(如副本里只有终端提交)也要有本机任务,task show <需求>
    // 才查得到副本里没对上会话的提交(spec D28)。只在全量刷新(task 命令、sync)里做,Stop hook 只刷新
    // 本会话、不做
    if (opts.sessionIds === undefined) {
      for (const { replica } of roots) {
        if (replica === null || replica.removedAt !== null) continue;
        try {
          ensureReplicaFeatureTask(store, root, replica.featureId, isEligible, now);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[task] 副本需求建任务失败 ${replica.featureId}: ${reason}\n`);
        }
      }
    }

    if (historyPass) store.setMeta(HISTORY_PASS_META_KEY, now);
    return { recomputed, historyPass };
  } finally {
    conn.close();
  }
}
