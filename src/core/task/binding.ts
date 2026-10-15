/**
 * 会话绑定(spec §2 术语「绑定」、§3.2 首次绑定回溯、§5.2 绑定结果、§5.3、§5.4)。
 *
 * 同一会话最多一条生效绑定,由 task_sessions_open_idx 在存储层强制;
 * 绑定 / 切换 / 关闭各自在一个事务里完成。
 */

import { resolveSessionIdFromEnv } from '../agents';
import { getSessionStats } from '../timeline';
import { TaskArgError, TaskError, TaskStoreError } from './errors';
import { openTaskDb } from './schema-bootstrap';
import { TaskStore } from './store';
import type { BindResult, BindSource, CurrentBinding, TaskItem } from './types';

/** 会话判定:非空的显式值 ?? 各 agent 会话环境变量(按登记顺序)?? null。 */
export function resolveSessionId(explicit?: string): string | null {
  const fromArg = explicit?.trim();
  if (fromArg) return fromArg;
  return resolveSessionIdFromEnv()?.sessionId ?? null;
}

/** 当前会话的生效绑定及其任务;未绑定返回 null。 */
export function getCurrentBinding(projectRoot: string, sessionId: string): CurrentBinding | null {
  const conn = openTaskDb(projectRoot);
  try {
    const store = new TaskStore(conn.getDb());
    const binding = store.getOpenBinding(sessionId);
    if (!binding) return null;
    return { binding, task: requireTask(store, binding.taskId) };
  } finally {
    conn.close();
  }
}

/** 关闭当前会话的生效绑定(unbound_at = now);没有生效绑定返回 false。 */
export function clearBinding(projectRoot: string, sessionId: string): boolean {
  const conn = openTaskDb(projectRoot);
  try {
    const store = new TaskStore(conn.getDb());
    const now = new Date().toISOString();
    return store.transaction(() => store.closeOpenBinding(sessionId, now));
  } finally {
    conn.close();
  }
}

/**
 * 把会话绑定到任务:
 *   - 已绑定同一任务 → already(无变化);
 *   - 已绑定其它任务 → 旧绑定 unbound_at = now、新绑定 bound_at = now → switched;
 *   - 未绑定 → bound;会话首次绑定时 bound_at 回溯到该会话最早一条 timeline 事件(没有则 now)。
 */
export async function bindSession(
  projectRoot: string,
  sessionId: string,
  taskId: number,
  bindSource: BindSource,
): Promise<BindResult> {
  const outcome = await bindSessionCore(projectRoot, sessionId, taskId, bindSource, 'switch');
  if (outcome.kind !== 'done') {
    // switch 模式不会产生 occupied,防御性兜底
    throw new TaskStoreError('绑定未完成:会话已被其它任务占用');
  }
  return outcome.result;
}

/** bindSessionCore 的结果:完成绑定,或(ifUnbound 模式下)会话已绑定其它任务而未动。 */
export type BindCoreOutcome =
  | { kind: 'done'; result: BindResult }
  | { kind: 'occupied'; current: CurrentBinding };

/**
 * 绑定核心(内部使用)。mode = 'switch' 时按 bindSession 语义切换;
 * mode = 'ifUnbound' 时只在会话无生效绑定时新建,已绑定其它任务则原样返回 occupied
 * (需求目录自动绑定不得切换已有绑定)。
 */
export async function bindSessionCore(
  projectRoot: string,
  sessionId: string,
  taskId: number,
  bindSource: BindSource,
  mode: 'switch' | 'ifUnbound',
): Promise<BindCoreOutcome> {
  const sid = sessionId.trim();
  if (!sid) throw new TaskArgError('会话 id 为空;用 --session <id> 指定会话');

  const conn = openTaskDb(projectRoot);
  try {
    const store = new TaskStore(conn.getDb());
    const task = store.getTaskById(taskId);
    if (!task) throw new TaskArgError(`找不到本地任务 ${taskId};用 cgraphx task list 查看可用任务`);

    // 首次绑定的回溯时间:getSessionStats 自己开连接,必须在事务外先取到
    let firstEventTs: string | null = null;
    if (!store.hasAnyBinding(sid)) {
      firstEventTs = await loadFirstEventTs(projectRoot, sid);
    }

    // 撞上生效绑定唯一约束(并发)时,重新读取后再走一遍流程,只重试一次
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return store.transaction(() => tryBind(store, sid, task, bindSource, mode, firstEventTs));
      } catch (err) {
        if (!(err instanceof RetryBind)) throw err;
      }
    }
    throw new TaskStoreError(`会话 ${sid} 并发绑定冲突,重试后仍未完成;请重新执行`);
  } finally {
    conn.close();
  }
}

/** 一次绑定尝试(在事务内调用)。插入撞上唯一约束时抛 RetryBind,由调用方回滚整个事务后重试。 */
function tryBind(
  store: TaskStore,
  sessionId: string,
  task: TaskItem,
  bindSource: BindSource,
  mode: 'switch' | 'ifUnbound',
  firstEventTs: string | null,
): BindCoreOutcome {
  const now = new Date().toISOString();
  const open = store.getOpenBinding(sessionId);

  if (open && open.taskId === task.id) {
    return { kind: 'done', result: { status: 'already', task, previous: null, binding: open } };
  }

  if (open) {
    const previous = requireTask(store, open.taskId);
    if (mode === 'ifUnbound') {
      return { kind: 'occupied', current: { binding: open, task: previous } };
    }
    store.closeOpenBinding(sessionId, now);
    const binding = store.insertBinding(sessionId, task.id, now, bindSource);
    if (!binding) throw new RetryBind();
    return { kind: 'done', result: { status: 'switched', task, previous, binding } };
  }

  // 首次绑定(会话在 task_sessions 里没有任何记录)按 §3.2 回溯,否则取 now
  const boundAt = store.hasAnyBinding(sessionId) ? now : (firstEventTs ?? now);
  const binding = store.insertBinding(sessionId, task.id, boundAt, bindSource);
  if (!binding) throw new RetryBind();
  return { kind: 'done', result: { status: 'bound', task, previous: null, binding } };
}

/** 插入撞上生效绑定唯一约束的内部信号:用异常撤销整个事务(含已关闭的旧绑定)后重试。 */
class RetryBind extends Error {}

function requireTask(store: TaskStore, taskId: number): TaskItem {
  const task = store.getTaskById(taskId);
  if (!task) throw new TaskStoreError(`绑定引用的任务 ${taskId} 不存在,task 数据可能已损坏`);
  return task;
}

/** 该会话最早一条 timeline 事件的时间;timeline 读取失败包成 TaskStoreError。 */
async function loadFirstEventTs(projectRoot: string, sessionId: string): Promise<string | null> {
  try {
    return (await getSessionStats(projectRoot, sessionId)).first_ts;
  } catch (err) {
    if (err instanceof TaskError) throw err;
    throw new TaskStoreError(
      `读取会话 ${sessionId} 的 timeline 事件失败:${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}
