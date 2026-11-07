/**
 * 看板数据装配(2026-11-06-agent看板 plan C-9、C-10、C-12、C-13;spec D5、D6、D7、D10)
 *
 * 只经 project、timeline、features、replica、agents 五个门面与基础层取数(D1 🔒)。三件事:
 *
 * - enumerateBoardGroups:project 门面 listProjects 按项目名分组(C-9),目录取还在的根经 replicaLinkOf
 *   换成主目录后去重(「在用主目录」= 组的 dirs;在副本里启动和在主目录启动看到的一样);
 * - syncProjects:逐组串行补录(C-9 取第一个在用主目录传 ensureTimelineUpToDate),供 CLI 启动与刷新共用;
 * - computeBoardData:纯读装配——任务认定(K1、K13)、认任务(C-11 的 match.ts)、时间窗与列表口径
 *   (K2、K3、K6、K12、K14)、标题(K5)、fileExists(D10)、C-13 提示映射与排序,产出 C-6 的 BoardData。
 *
 * 看板除补录外不写任何东西:项目库按 dataDir 只读打开(board-read),sessions.db 存在才只读打开。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { listSessionSources } from '../agents';
import { listFeatureFiles, listFeatures, parseFeatureId } from '../features';
import { listProjects } from '../project';
import { listReplicas, replicaLinkOf, type ReplicaEntry } from '../replica';
import { createRootMatcher } from '../root-match';
import { DatabaseConnection } from '../db';
import { SESSIONS_DB_FILENAME, SessionIndex } from '../session-index';
import { ensureTimelineUpToDate, readTimelineBoardData } from '../timeline';
import type { BoardTimelineData, TimelineSyncOutcome } from '../timeline';
import { projectsRoot, userDataRoot } from '../user-data-dir';
import {
  DOCS_FEATURES_DIR,
  NOTICE_DIRS_GONE,
  PLAN_DISCUSSION_FILE_PATTERN,
  SPEC_FILE_PATTERN,
  SYNC_NOTICE_BY_STATUS,
  TASK_ACTIVE_WINDOW_MS,
  TITLE_FALLBACK_CHARS,
  UNMATCHED_MIN_PROMPTS,
} from './constants';
import { createDirLabeler, matchSessionsToTasks } from './match';
import type {
  BoardData,
  BoardProject,
  BoardProjectGroup,
  BoardSession,
  BoardSyncItem,
  BoardTask,
  TaskSessionMatch,
} from './types';

// ─── 项目枚举与分组(C-9、K12)──────────────────────────────────────────────

/**
 * listProjects 按项目名分组(C-9):同名(identity.name)的几个目录归并成一组;identity 读不出的按目录名
 * 单独成组(显示名用目录名)。组内 dirs = 各成员 roots 里 exists 的根逐个经 replicaLinkOf 换成主目录后去重
 * (roots 本身按最近活动降序,dirs[0] 是最近活动的主目录,补录取它);roots 全量(含不在的)留给 K8 匹配器。
 */
export function enumerateBoardGroups(): BoardProjectGroup[] {
  const byKey = new Map<string, BoardProjectGroup>();
  for (const item of listProjects()) {
    const { project } = item;
    const key = project.name !== null ? `name:${project.name}` : `dir:${project.dir ?? project.display}`;
    let group = byKey.get(key);
    if (group === undefined) {
      group = { name: project.display, dirs: [], dataDirs: [], roots: [] };
      byKey.set(key, group);
    }
    if (project.dir !== null) group.dataDirs.push(path.join(projectsRoot(), project.dir));
    const seenDirs = new Set(group.dirs);
    for (const root of item.roots) {
      group.roots.push(root.path);
      if (!root.exists) continue;
      const mainRoot = replicaLinkOf(root.path).mainRoot;
      if (!seenDirs.has(mainRoot)) {
        seenDirs.add(mainRoot);
        group.dirs.push(mainRoot);
      }
    }
  }
  return [...byKey.values()];
}

/**
 * 逐组串行补录(C-8 启动顺序的第二步,刷新共用):组内有在用主目录的取第一个传 ensureTimelineUpToDate;
 * 目录全不在的组不补录(outcome 为 null,notice 走「目录已不在」那句)。
 */
export async function syncProjects(groups?: readonly BoardProjectGroup[]): Promise<BoardSyncItem[]> {
  const list = groups ?? enumerateBoardGroups();
  const items: BoardSyncItem[] = [];
  for (const group of list) {
    const first = group.dirs[0];
    const outcome: TimelineSyncOutcome | null =
      first !== undefined ? await ensureTimelineUpToDate(first) : null;
    items.push({ group, outcome });
  }
  return items;
}

// ─── 会话文件还在不在(D10、F2 ①)───────────────────────────────────────────

/**
 * sessions.db 只读现查(D10):按来源聚合 session_files,会话编号 → 它的文件还有没有一个在。
 * 库不在(还没补录过)、打开或读不了(文件损坏等)按「都不知道」(全部 false)降级——一个只读
 * 辅助查询不能拖垮整个看板(同一次启动里项目补录失败也只是 notice);不建库、不写表(只读打开,
 * 不走会建库建表的 openSessionIndex)。
 */
function readSessionFileExistence(): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const dbPath = path.join(userDataRoot(), SESSIONS_DB_FILENAME);
  if (!fs.existsSync(dbPath)) return out;
  let conn: DatabaseConnection;
  try {
    conn = DatabaseConnection.open(dbPath);
  } catch {
    return out; // 库打不开(损坏、被锁死等):按「都不知道」处理,不让 board 拒启
  }
  try {
    const index = new SessionIndex(conn);
    for (const source of listSessionSources()) {
      let rows;
      try {
        rows = index.listSessionFiles(source.id);
      } catch {
        continue; // 表不在等:这个来源按没有进度
      }
      for (const row of rows) {
        if (row.session_id === null) continue;
        out.set(row.session_id, (out.get(row.session_id) ?? false) || fs.existsSync(row.path));
      }
    }
  } catch {
    return out; // 读一半失败:已算出来的留下,其余按没有
  } finally {
    try {
      conn.close();
    } catch {
      // 关不上不影响结果
    }
  }
  return out;
}

// ─── 数据读取与合并(C-5)────────────────────────────────────────────────────

function emptyBoardTimelineData(): BoardTimelineData {
  return { sessions: [], prompts: [], commits: [], tools: [], titles: [] };
}

/** 各成员项目库的看板数据并成一份:会话按 id 去重,事件按 ts 重排(升序),标题按会话去重。 */
function mergeBoardTimelineData(dataDirs: readonly string[]): BoardTimelineData {
  const parts: BoardTimelineData[] = [];
  for (const dir of dataDirs) {
    try {
      const data = readTimelineBoardData(dir);
      if (data !== null) parts.push(data);
    } catch {
      // 一个成员的库读不出来按空,不让一个项目拖垮整份列表
    }
  }
  if (parts.length === 0) return emptyBoardTimelineData();

  const seenSessions = new Set<string>();
  const sessions: BoardTimelineData['sessions'] = [];
  const seenTitles = new Set<string>();
  const titles: BoardTimelineData['titles'] = [];
  for (const part of parts) {
    for (const head of part.sessions) {
      if (seenSessions.has(head.id)) continue;
      seenSessions.add(head.id);
      sessions.push(head);
    }
    for (const title of part.titles) {
      if (seenTitles.has(title.sessionId)) continue;
      seenTitles.add(title.sessionId);
      titles.push(title);
    }
  }
  const byTs = (a: { ts: string }, b: { ts: string }): number => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0);
  return {
    sessions: sessions.sort(byTs),
    prompts: parts.flatMap((p) => p.prompts).sort(byTs),
    commits: parts.flatMap((p) => p.commits).sort(byTs),
    tools: parts.flatMap((p) => p.tools).sort(byTs),
    titles,
  };
}

// ─── 任务认定(K1、K13;C-10)────────────────────────────────────────────────

/** K1:需求目录顶层有讨论稿(`*-功能方案-v*.md`)或 spec(`spec.md` / `*-spec.md`)才算任务。只看顶层。 */
function hasTaskBasis(projectRoot: string, featureId: string): boolean {
  const prefix = `${DOCS_FEATURES_DIR}/${featureId}/`;
  for (const rel of listFeatureFiles(projectRoot, featureId)) {
    if (!rel.startsWith(prefix)) continue;
    const name = rel.slice(prefix.length);
    if (name.includes('/')) continue; // plan/、测试/ 等子目录里的不算
    if (PLAN_DISCUSSION_FILE_PATTERN.test(name) || SPEC_FILE_PATTERN.test(name)) return true;
  }
  return false;
}

/** 任务行的标题与阶段来源(K13):FeatureEntry 优先;目录不在(只有副本登记)取 feature-id 去日期段,阶段 null。 */
interface TaskDef {
  featureId: string;
  title: string;
  stage: string | null;
}

/**
 * 每组任务(C-10):各在用主目录 listFeatures 里满足 K1 的条目(listFeatures 已优先取副本那份),
 * 并上 listReplicas(includeRemoved: true)登记过的 featureId,按 featureId 去重。副本登记(在用 + 已删)
 * 顺带整份带出,给认任务(K9①②)与 dirLabel 用。
 */
function collectTasks(group: BoardProjectGroup): { tasks: TaskDef[]; replicas: ReplicaEntry[] } {
  const byId = new Map<string, TaskDef>();
  const replicas: ReplicaEntry[] = [];
  const seenReplicas = new Set<string>();
  for (const dir of group.dirs) {
    for (const entry of listFeatures(dir)) {
      // 副本里登记过的(listFeatures 带出在用副本那份):登记本身就算任务(K1),不查文件
      if (entry.replica === undefined && !hasTaskBasis(dir, entry.featureId)) continue;
      if (!byId.has(entry.featureId)) {
        byId.set(entry.featureId, { featureId: entry.featureId, title: entry.title, stage: entry.stage });
      }
    }
    for (const replica of listReplicas(dir, { includeRemoved: true })) {
      const key = `${replica.name}\0${replica.path}`;
      if (!seenReplicas.has(key)) {
        seenReplicas.add(key);
        replicas.push(replica);
      }
      if (!byId.has(replica.featureId)) {
        byId.set(replica.featureId, {
          featureId: replica.featureId,
          title: parseFeatureId(replica.featureId).title,
          stage: null,
        });
      }
    }
  }
  return { tasks: [...byId.values()], replicas };
}

// ─── 装配(C-6、C-12)────────────────────────────────────────────────────────

/** 来源 id → 显示名与顺序(agents 门面的登记顺序:claude-code、codebuddy、deepseek)。 */
interface AgentDisplayTable {
  names: Map<string, string>;
  orders: Map<string, number>;
}

function agentDisplayTable(): AgentDisplayTable {
  const names = new Map<string, string>();
  const orders = new Map<string, number>();
  listSessionSources().forEach((source, i) => {
    names.set(source.id, source.displayName);
    orders.set(source.id, i);
  });
  return { names, orders };
}

/** 任务行的 agents:命中会话的来源显示名去重,按登记顺序(claude-code、codebuddy、deepseek)。 */
function agentsOf(hits: ReadonlyArray<{ sessionId: string }>, agentById: Map<string, string>, table: AgentDisplayTable): string[] {
  const ids = new Set<string>();
  for (const hit of hits) {
    const agent = agentById.get(hit.sessionId);
    if (agent !== undefined && agent !== '') ids.add(agent);
  }
  return [...ids].sort(
    (a, b) =>
      (table.orders.get(a) ?? Number.MAX_SAFE_INTEGER) - (table.orders.get(b) ?? Number.MAX_SAFE_INTEGER) ||
      a.localeCompare(b),
  );
}

/** 命中按窗口 to 降序,同值按会话编号(结果稳定;C-12 fixed/maybe 两组内排序)。 */
function hitsByToDesc(a: TaskSessionMatch, b: TaskSessionMatch): number {
  if (a.to !== b.to) return a.to > b.to ? -1 : 1;
  return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0;
}

/** 会话行按 to 降序,同值按会话编号(K3 未归类排序;to 理论上恒有,容 null 排最后)。 */
function sessionsByToDesc(a: BoardSession, b: BoardSession): number {
  const av = a.to ?? '';
  const bv = b.to ?? '';
  if (av !== bv) return av > bv ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 任务排序:lastActiveAt 降序,同值按 featureId(C-12)。 */
function byLastActiveDesc(a: BoardTask, b: BoardTask): number {
  if (a.lastActiveAt !== b.lastActiveAt) {
    if (a.lastActiveAt === null) return 1;
    if (b.lastActiveAt === null) return -1;
    return a.lastActiveAt > b.lastActiveAt ? -1 : 1;
  }
  return a.featureId < b.featureId ? -1 : a.featureId > b.featureId ? 1 : 0;
}

/** 组内最新会话活动(C-9 项目排序键):任务 lastActiveAt(tasks + older)与未归类 to 的最大值。 */
function projectActivityOf(project: BoardProject): string | null {
  let latest: string | null = null;
  const see = (ts: string | null): void => {
    if (ts !== null && (latest === null || ts > latest)) latest = ts;
  };
  for (const task of project.tasks) see(task.lastActiveAt);
  for (const task of project.older) see(task.lastActiveAt);
  for (const session of project.unsorted) see(session.to);
  return latest;
}

function byProjectActivityDesc(a: BoardProject, b: BoardProject): number {
  const av = projectActivityOf(a);
  const bv = projectActivityOf(b);
  if (av !== bv) {
    if (av === null) return 1;
    if (bv === null) return -1;
    return av > bv ? -1 : 1;
  }
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * 数据装配主入口(C-12):全部内存现算。syncs 传 syncProjects 的结果(带补录状态,notice 按 C-13 映射);
 * 不传则自己枚举(没有补录状态,notice 只有「目录已不在」一种)。
 */
export function computeBoardData(syncs?: readonly BoardSyncItem[]): BoardData {
  const items: readonly BoardSyncItem[] =
    syncs ?? enumerateBoardGroups().map((group) => ({ group, outcome: null }));
  const fileExists = readSessionFileExistence();
  const table = agentDisplayTable();
  const projects = items.map(({ group, outcome }) => assembleProject(group, outcome, fileExists, table));
  projects.sort(byProjectActivityDesc);
  return { projects };
}

/** 一个项目组的装配:读数据 → 认任务 → 时间窗与列表口径 → 出 BoardProject(C-6 的形状)。 */
function assembleProject(
  group: BoardProjectGroup,
  outcome: TimelineSyncOutcome | null,
  fileExists: Map<string, boolean>,
  table: AgentDisplayTable,
): BoardProject {
  // F1 ④⑤:目录全不在用 C-9 那句(C-13);其余按补录状态映射(C-13),没补录过为 null
  const notice =
    group.dirs.length === 0
      ? NOTICE_DIRS_GONE
      : outcome !== null
        ? SYNC_NOTICE_BY_STATUS[outcome.status]
        : null;

  const data = mergeBoardTimelineData(group.dataDirs);
  const { tasks, replicas } = collectTasks(group);
  if (tasks.length === 0 && data.sessions.length === 0) {
    return { name: group.name, dirs: group.dirs, notice, tasks: [], older: [], unsorted: [] };
  }

  const match = matchSessionsToTasks({
    data,
    tasks: tasks.map((t) => ({ featureId: t.featureId, title: t.title })),
    replicas,
    rootsMatcher: createRootMatcher([...group.roots, ...replicas.map((r) => r.path)]),
    mainDirs: group.dirs,
  });

  // 每个参与会话的行信息:agent 显示名、标题(K5)、dirLabel(C-11)、fileExists(D10)、提问数(K3)
  const titled = new Map(data.titles.map((t) => [t.sessionId, t.title]));
  const firstPromptText = new Map<string, string>();
  const promptCount = new Map<string, number>();
  for (const prompt of data.prompts) {
    promptCount.set(prompt.sessionId, (promptCount.get(prompt.sessionId) ?? 0) + 1);
    if (!firstPromptText.has(prompt.sessionId) && prompt.text.trim() !== '') {
      firstPromptText.set(prompt.sessionId, prompt.text.trim());
    }
  }
  const dirLabel = createDirLabeler(replicas, group.dirs, group.name);
  const agentById = new Map<string, string>();
  const infoOf = new Map<string, { agent: string; title: string; startCwd: string; dirLabel: string; fileExists: boolean }>();
  for (const { head } of match.sessions.values()) {
    const agent = table.names.get(head.agent) ?? head.agent;
    agentById.set(head.id, agent);
    // K5:标题表有行取行;没有取第一条 user_prompt 前 40 个字;再没有显示 '-'
    const fallback = firstPromptText.get(head.id);
    const title =
      titled.get(head.id) ??
      (fallback !== undefined ? [...fallback].slice(0, TITLE_FALLBACK_CHARS).join('') : '-');
    infoOf.set(head.id, {
      agent,
      title,
      startCwd: head.startCwd,
      dirLabel: dirLabel(head.startCwd),
      fileExists: fileExists.get(head.id) ?? false,
    });
  }

  const toSession = (hit: TaskSessionMatch): BoardSession => {
    const info = infoOf.get(hit.sessionId);
    return {
      agent: info?.agent ?? '',
      id: hit.sessionId,
      title: info?.title ?? '-',
      startCwd: info?.startCwd ?? '',
      dirLabel: info?.dirLabel ?? '',
      from: hit.from,
      to: hit.to,
      reasons: hit.reasons,
      fileExists: info?.fileExists ?? false,
    };
  };

  // K2、K14:本机有挂上会话(定挂或可能相关)的任务才列;lastActiveAt 取各会话窗口 to 的最大值,
  // 定挂优先、没有定挂取可能相关;最近活动在 30 天内进 tasks,其余进 older(页面点「全部」才显示)
  const now = Date.now();
  const allTasks: BoardTask[] = [];
  for (const def of tasks) {
    const hits = match.byTask.get(def.featureId) ?? [];
    if (hits.length === 0) continue;
    const fixed = hits.filter((h) => h.fixed).sort(hitsByToDesc);
    const maybe = hits.filter((h) => !h.fixed).sort(hitsByToDesc);
    let lastActiveAt: string | null = null;
    for (const hit of fixed.length > 0 ? fixed : maybe) {
      if (lastActiveAt === null || hit.to > lastActiveAt) lastActiveAt = hit.to;
    }
    allTasks.push({
      featureId: def.featureId,
      title: def.title,
      stage: def.stage,
      fixedCount: fixed.length,
      maybeCount: maybe.length,
      agents: agentsOf(fixed.concat(maybe), agentById, table),
      lastActiveAt,
      fixed: fixed.map(toSession),
      maybe: maybe.map(toSession),
    });
  }
  const cutoff = now - TASK_ACTIVE_WINDOW_MS;
  const tasks30d: BoardTask[] = [];
  const older: BoardTask[] = [];
  for (const task of allTasks) {
    const ts = task.lastActiveAt === null ? NaN : Date.parse(task.lastActiveAt);
    (Number.isFinite(ts) && ts >= cutoff ? tasks30d : older).push(task);
  }
  tasks30d.sort(byLastActiveDesc);
  older.sort(byLastActiveDesc);

  // K3:参与但没有任何定挂、任何可能相关,且 user_prompt ≥ 5 条的会话;按窗口 to 降序,无依据栏
  const unsorted: BoardSession[] = match.unmatched
    .filter((sessionId) => (promptCount.get(sessionId) ?? 0) >= UNMATCHED_MIN_PROMPTS)
    .flatMap((sessionId) => {
      const info = match.sessions.get(sessionId);
      if (info === undefined) return [];
      return [{
        agent: infoOf.get(sessionId)?.agent ?? '',
        id: sessionId,
        title: infoOf.get(sessionId)?.title ?? '-',
        startCwd: info.head.startCwd,
        dirLabel: infoOf.get(sessionId)?.dirLabel ?? path.basename(info.head.startCwd),
        from: info.wholeFrom,
        to: info.wholeTo,
        reasons: [],
        fileExists: infoOf.get(sessionId)?.fileExists ?? false,
      }];
    })
    .sort(sessionsByToDesc);

  return { name: group.name, dirs: group.dirs, notice, tasks: tasks30d, older, unsorted };
}
