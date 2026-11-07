/**
 * 认任务(K8–K11;spec F4 / D14,plan C-11)
 *
 * 纯函数:输入一个项目的看板数据(C-5)、任务清单、副本登记与 K8 根匹配器,输出每个任务定挂 / 可能相关的
 * 会话集合(含依据文案与命中事件时间)和未归类清单。每次补录后现算,不写绑定、不落任何库表——规则一改
 * 老会话重新算就对得上。标题、路径一律按原文比较(含 `-`、`_`),不做任何归一化(D14)。
 *
 * K11(只在 Bash 命令文字里出现过的需求路径不算)不在本函数:C-5 的查询就不取 Bash 事件,天然成立。
 */

import * as path from 'node:path';

import { createRootMatcher, type RootMatcher } from '../root-match';
import type { BoardCommit, BoardPrompt, BoardSessionHead, BoardToolEvent } from '../timeline';
import {
  FLOW_COMMAND_PATTERN,
  REASON_COMMIT_BRANCH,
  REASON_COMMIT_FILES,
  REASON_FLOW_COMMAND,
  REASON_PROMPT_PATH,
  REASON_PROMPT_TITLE,
  REASON_READ_FEATURE,
  REASON_REPLICA_CWD,
  REASON_WROTE_FEATURE,
  TITLE_MENTION_MIN_CHARS,
  featureDirPrefix,
} from './constants';
import type { ReplicaRef, TaskMatchInput, TaskMatchOutput, TaskSessionMatch } from './types';

/** K9④:写类工具(filePath 含需求目录前缀即定挂)。 */
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** 按码点数标题长度(K10 的「4 个字」)。 */
function charLength(s: string): number {
  return [...s].length;
}

/** 一个参与会话的分组事件与全事件窗(K6:只挂一个任务 / K9① / 未归类用)。 */
interface SessionEvents {
  head: BoardSessionHead;
  prompts: BoardPrompt[];
  commits: BoardCommit[];
  tools: BoardToolEvent[];
  wholeFrom: string;
  wholeTo: string;
}

/** 一个任务在一个会话上的命中累计(K9 先算,没有定挂才算 K10)。 */
interface TaskHitDraft {
  featureId: string;
  sessionId: string;
  fixed: boolean;
  reasons: string[];
  /** 命中该任务的事件时间(K6 多任务时的窗口素材;K9① 不记事件、走整个会话) */
  hitTs: string[];
  /** K9① 挂上的:窗口一律算整个会话 */
  replicaCwd: boolean;
}

/** 任务级预计算:路径前缀、副本匹配器(K9①)、需求分支集合(K9②)、标题可否用于消息匹配(K10)。 */
interface TaskContext {
  featureId: string;
  title: string;
  prefix: string;
  replicaMatcher: RootMatcher | null;
  branches: Set<string>;
  mentionable: boolean;
}

function taskContextsOf(
  tasks: ReadonlyArray<{ featureId: string; title: string }>,
  replicas: readonly ReplicaRef[],
): TaskContext[] {
  return tasks.map((task) => {
    const own = replicas.filter((r) => r.featureId === task.featureId);
    return {
      featureId: task.featureId,
      title: task.title,
      prefix: featureDirPrefix(task.featureId),
      // K9①:单独一个只含该需求副本路径(在用 + 已删)的匹配器,allowSelf
      replicaMatcher: own.length > 0 ? createRootMatcher(own.map((r) => r.path)) : null,
      branches: new Set(own.map((r) => r.branch)),
      mentionable: task.title !== '' && charLength(task.title) >= TITLE_MENTION_MIN_CHARS,
    };
  });
}

/**
 * K8 + 事件分组:开始目录经根匹配器命中(allowSelf true)的会话参与;Windows 路径等非本机绝对路径
 * 自然不命中(createRootMatcher 的 path.isAbsolute 语义)。同 id 只留最早一条(ts 升序已排)。
 */
function participatingEventsOf(input: TaskMatchInput): Map<string, SessionEvents> {
  const bySession = new Map<string, SessionEvents>();
  for (const head of input.data.sessions) {
    if (bySession.has(head.id)) continue;
    if (input.rootsMatcher.match(head.startCwd, { allowSelf: true }) === null) continue;
    bySession.set(head.id, {
      head,
      prompts: [],
      commits: [],
      tools: [],
      wholeFrom: head.ts,
      wholeTo: head.ts,
    });
  }
  for (const prompt of input.data.prompts) {
    bySession.get(prompt.sessionId)?.prompts.push(prompt);
  }
  for (const commit of input.data.commits) {
    if (commit.sessionId !== null) bySession.get(commit.sessionId)?.commits.push(commit);
  }
  for (const tool of input.data.tools) {
    bySession.get(tool.sessionId)?.tools.push(tool);
  }
  // 全事件窗:该会话全部事件(看板列集合内的)的最早 / 最晚 ts
  for (const ev of bySession.values()) {
    const see = (ts: string): void => {
      if (ts < ev.wholeFrom) ev.wholeFrom = ts;
      if (ts > ev.wholeTo) ev.wholeTo = ts;
    };
    for (const p of ev.prompts) see(p.ts);
    for (const c of ev.commits) see(c.ts);
    for (const t of ev.tools) see(t.ts);
  }
  return bySession;
}

/** 一个会话对一个任务的 K9(定挂)判定;返回依据文案与命中事件时间。 */
function matchFixedRules(task: TaskContext, ev: SessionEvents): { reasons: Set<string>; hitTs: string[] } {
  const reasons = new Set<string>();
  const hitTs: string[] = [];
  // ① 开始目录在该需求的副本登记 path 下(含已删)——整个会话算它的
  if (task.replicaMatcher !== null && task.replicaMatcher.match(ev.head.startCwd, { allowSelf: true }) !== null) {
    reasons.add(REASON_REPLICA_CWD);
  }
  // ②③ 提交:分支等于需求分支 / 提交文件里有需求目录(DeepSeek 与早就记下的提交没有会话编号,认不到)
  for (const commit of ev.commits) {
    if (commit.branch !== null && task.branches.has(commit.branch)) {
      reasons.add(REASON_COMMIT_BRANCH);
      hitTs.push(commit.ts);
    }
    if (commit.files.some((f) => f.includes(task.prefix))) {
      reasons.add(REASON_COMMIT_FILES);
      hitTs.push(commit.ts);
    }
  }
  // ④ 写类工具的 filePath 含需求目录
  for (const tool of ev.tools) {
    if (WRITE_TOOLS.has(tool.tool) && tool.filePath !== null && tool.filePath.includes(task.prefix)) {
      reasons.add(REASON_WROTE_FEATURE);
      hitTs.push(tool.ts);
    }
  }
  // ⑤ 流程命令:命令参数含任务标题,或 Skill 工具的 args 含任务标题
  for (const prompt of ev.prompts) {
    const params = FLOW_COMMAND_PATTERN.exec(prompt.text)?.[1];
    if (params !== undefined && params.includes(task.title)) {
      reasons.add(REASON_FLOW_COMMAND);
      hitTs.push(prompt.ts);
    }
  }
  for (const tool of ev.tools) {
    if (tool.tool === 'Skill' && tool.args !== null && tool.args.includes(task.title)) {
      reasons.add(REASON_FLOW_COMMAND);
      hitTs.push(tool.ts);
    }
  }
  // ⑥ 人发的消息里有需求目录路径
  for (const prompt of ev.prompts) {
    if (prompt.text.includes(task.prefix)) {
      reasons.add(REASON_PROMPT_PATH);
      hitTs.push(prompt.ts);
    }
  }
  return { reasons, hitTs };
}

/** K10(可能相关;没有定挂才算):读过需求目录,或消息里提到需求名。 */
function matchMaybeRules(task: TaskContext, ev: SessionEvents): { reasons: Set<string>; hitTs: string[] } {
  const reasons = new Set<string>();
  const hitTs: string[] = [];
  for (const tool of ev.tools) {
    if (tool.tool === 'Read' && tool.filePath !== null && tool.filePath.includes(task.prefix)) {
      reasons.add(REASON_READ_FEATURE);
      hitTs.push(tool.ts);
    }
  }
  if (task.mentionable) {
    for (const prompt of ev.prompts) {
      if (prompt.text.includes(task.title)) {
        reasons.add(REASON_PROMPT_TITLE);
        hitTs.push(prompt.ts);
      }
    }
  }
  return { reasons, hitTs };
}

/** 认任务主入口(plan C-11)。 */
export function matchSessionsToTasks(input: TaskMatchInput): TaskMatchOutput {
  const contexts = taskContextsOf(input.tasks, input.replicas);
  const bySession = participatingEventsOf(input);

  const byTask = new Map<string, TaskSessionMatch[]>();
  const unmatched: string[] = [];

  for (const ev of bySession.values()) {
    const drafts: TaskHitDraft[] = [];
    for (const task of contexts) {
      const fixed = matchFixedRules(task, ev);
      const fixedHit = fixed.reasons.size > 0;
      const maybe = fixedHit ? { reasons: new Set<string>(), hitTs: [] as string[] } : matchMaybeRules(task, ev);
      if (!fixedHit && maybe.reasons.size === 0) continue;
      const chosen = fixedHit ? fixed : maybe;
      drafts.push({
        featureId: task.featureId,
        sessionId: ev.head.id,
        fixed: fixedHit,
        reasons: [...chosen.reasons],
        hitTs: chosen.hitTs,
        replicaCwd: fixed.reasons.has(REASON_REPLICA_CWD),
      });
    }
    if (drafts.length === 0) {
      unmatched.push(ev.head.id);
      continue;
    }
    // K6 窗口:只挂一个任务、或靠 K9① 挂上的,一律算整个会话;否则取命中该任务的事件最早 / 最晚
    const single = drafts.length === 1;
    for (const draft of drafts) {
      let from = ev.wholeFrom;
      let to = ev.wholeTo;
      if (!single && !draft.replicaCwd && draft.hitTs.length > 0) {
        // hitTs 按规则评估顺序累计,不保证时间序,这里取真正的最早 / 最晚
        const first = draft.hitTs[0];
        if (first !== undefined) {
          from = first;
          to = first;
          for (const ts of draft.hitTs) {
            if (ts < from) from = ts;
            if (ts > to) to = ts;
          }
        }
      }
      const list = byTask.get(draft.featureId) ?? [];
      list.push({ sessionId: draft.sessionId, fixed: draft.fixed, reasons: draft.reasons, from, to });
      byTask.set(draft.featureId, list);
    }
  }

  return {
    sessions: new Map(
      [...bySession].map(([id, ev]) => [id, { head: ev.head, wholeFrom: ev.wholeFrom, wholeTo: ev.wholeTo }]),
    ),
    byTask,
    unmatched,
  };
}

/**
 * dirLabel(C-11):开始目录在某个副本登记(在用 + 已删)下 → `副本 <副本目录名>`;在该项目的某个
 * 在用主目录下 → `主目录 <项目名>`;否则取目录名。匹配器只建一次,供 compute 按会话调用。
 */
export function createDirLabeler(
  replicas: readonly ReplicaRef[],
  mainDirs: readonly string[],
  projectName: string,
): (startCwd: string) => string {
  const replicaByRoot = new Map<string, ReplicaRef>();
  for (const replica of replicas) {
    const root = path.resolve(replica.path);
    if (!replicaByRoot.has(root)) replicaByRoot.set(root, replica);
  }
  const replicaMatcher = replicaByRoot.size > 0 ? createRootMatcher([...replicaByRoot.keys()]) : null;
  const mainMatcher = mainDirs.length > 0 ? createRootMatcher([...mainDirs]) : null;
  return (startCwd: string): string => {
    const replicaHit = replicaMatcher?.match(startCwd, { allowSelf: true }) ?? null;
    if (replicaHit !== null) {
      const entry = replicaByRoot.get(replicaHit.root);
      if (entry !== undefined) return `副本 ${entry.name}`;
    }
    if (mainMatcher !== null && mainMatcher.match(startCwd, { allowSelf: true }) !== null) {
      return `主目录 ${projectName}`;
    }
    return path.basename(startCwd);
  };
}
