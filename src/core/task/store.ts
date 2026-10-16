/**
 * TaskStore —— task 子系统的持久化层。
 *
 * 包装一个 SqliteDatabase(共享的 .cgraphx/cgraphx.db),只碰 `task_*` 表。
 * 连接归调用方所有,由调用方关闭。行类型(XxxRow)到领域类型的映射在这里完成,
 * 原始行不外泄;SQL 全部参数化;DB 异常统一包成 TaskStoreError。
 */

import type { SqliteDatabase } from '../db';
import { TaskError, TaskStoreError } from './errors';
import type { BindSource, RemoteTask, TaskBinding, TaskItem, TaskSource } from './types';

// ─── 行类型与映射 ──────────────────────────────────────────────────────────

interface TaskItemRow {
  id: number;
  source: string;
  external_id: string | null;
  name: string;
  url: string | null;
  status: string | null;
  raw: string | null; // JSON
  created_at: string;
  updated_at: string;
}

interface TaskSessionRow {
  id: number;
  session_id: string;
  task_id: number;
  bound_at: string;
  unbound_at: string | null;
  bind_source: string;
}

function rowToTask(row: TaskItemRow): TaskItem {
  return {
    id: row.id,
    source: row.source as TaskSource,
    externalId: row.external_id,
    name: row.name,
    url: row.url,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToBinding(row: TaskSessionRow): TaskBinding {
  return {
    id: row.id,
    sessionId: row.session_id,
    taskId: row.task_id,
    boundAt: row.bound_at,
    unboundAt: row.unbound_at,
    bindSource: row.bind_source as BindSource,
  };
}

const TASK_COLUMNS = 'id, source, external_id, name, url, status, raw, created_at, updated_at';
const BINDING_COLUMNS = 'id, session_id, task_id, bound_at, unbound_at, bind_source';

/** 是否为「同一会话已有生效绑定」的唯一约束冲突(task_sessions_open_idx)。 */
function isOpenBindingConflict(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('UNIQUE constraint failed') && msg.includes('task_sessions');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Store ─────────────────────────────────────────────────────────────────

export class TaskStore {
  constructor(private readonly db: SqliteDatabase) {}

  /**
   * 在 `BEGIN IMMEDIATE` 事务里执行:开事务即拿写锁,并发写者在 busy_timeout 内排队,
   * 避免 deferred 事务「先读后写」升级写锁时的快照冲突。fn 抛错则回滚并原样抛出。
   */
  transaction<T>(fn: () => T): T {
    this.guard('开启事务', () => this.db.exec('BEGIN IMMEDIATE'));
    try {
      const result = fn();
      this.guard('提交事务', () => this.db.exec('COMMIT'));
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // 事务可能已被 SQLite 自动回滚,忽略
      }
      throw err;
    }
  }

  // ── 任务 ──

  getTaskById(id: number): TaskItem | null {
    const row = this.guard('按 id 查任务', () =>
      this.db.prepare(`SELECT ${TASK_COLUMNS} FROM task_items WHERE id = ?`).get(id),
    ) as TaskItemRow | undefined;
    return row ? rowToTask(row) : null;
  }

  findApiTaskByExternalId(externalId: string): TaskItem | null {
    const row = this.guard('按外部编号查任务', () =>
      this.db
        .prepare(`SELECT ${TASK_COLUMNS} FROM task_items WHERE source = 'api' AND external_id = ?`)
        .get(externalId),
    ) as TaskItemRow | undefined;
    return row ? rowToTask(row) : null;
  }

  findManualTaskByName(name: string): TaskItem | null {
    const row = this.guard('按名称查手动任务', () =>
      this.db
        .prepare(`SELECT ${TASK_COLUMNS} FROM task_items WHERE source = 'manual' AND name = ?`)
        .get(name),
    ) as TaskItemRow | undefined;
    return row ? rowToTask(row) : null;
  }

  /** 全部接口任务(按 id 排序),供按名称规整匹配。 */
  listApiTasks(): TaskItem[] {
    const rows = this.guard('列出接口任务', () =>
      this.db.prepare(`SELECT ${TASK_COLUMNS} FROM task_items WHERE source = 'api' ORDER BY id`).all(),
    ) as TaskItemRow[];
    return rows.map(rowToTask);
  }

  /** 全部任务,按 source、id 排序。 */
  listTasks(): TaskItem[] {
    const rows = this.guard('列出任务', () =>
      this.db.prepare(`SELECT ${TASK_COLUMNS} FROM task_items ORDER BY source, id`).all(),
    ) as TaskItemRow[];
    return rows.map(rowToTask);
  }

  /**
   * 接口任务按 external_id upsert:已有则更新 name / url / status / raw / updated_at,
   * 没有则新建。接口不再返回的任务不在这里处理(保留不删)。
   */
  upsertApiTask(task: RemoteTask, now: string): TaskItem {
    const raw = safeJson(task.raw);
    this.guard('写入接口任务', () => {
      const inserted = this.db
        .prepare(
          `INSERT OR IGNORE INTO task_items
             (source, external_id, name, url, status, raw, created_at, updated_at)
           VALUES ('api', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(task.id, task.name, task.url, task.status, raw, now, now);
      if (inserted.changes === 0) {
        this.db
          .prepare(
            `UPDATE task_items SET name = ?, url = ?, status = ?, raw = ?, updated_at = ?
             WHERE source = 'api' AND external_id = ?`,
          )
          .run(task.name, task.url, task.status, raw, now, task.id);
      }
    });
    return this.requireApiTask(task.id);
  }

  /** 接口任务占位:external_id = name = value;已存在则原样返回(不覆盖名称)。 */
  ensureApiPlaceholder(value: string, now: string): TaskItem {
    this.guard('写入接口任务占位', () =>
      this.db
        .prepare(
          `INSERT OR IGNORE INTO task_items
             (source, external_id, name, url, status, raw, created_at, updated_at)
           VALUES ('api', ?, ?, NULL, NULL, NULL, ?, ?)`,
        )
        .run(value, value, now, now),
    );
    return this.requireApiTask(value);
  }

  /** 手动任务按名称 upsert:同名复用,不重复建。 */
  ensureManualTask(name: string, now: string): TaskItem {
    this.guard('写入手动任务', () =>
      this.db
        .prepare(
          `INSERT OR IGNORE INTO task_items
             (source, external_id, name, url, status, raw, created_at, updated_at)
           VALUES ('manual', NULL, ?, NULL, NULL, NULL, ?, ?)`,
        )
        .run(name, now, now),
    );
    const task = this.findManualTaskByName(name);
    if (!task) throw new TaskStoreError(`手动任务「${name}」写入后未能读回`);
    return task;
  }

  private requireApiTask(externalId: string): TaskItem {
    const task = this.findApiTaskByExternalId(externalId);
    if (!task) throw new TaskStoreError(`接口任务 ${externalId} 写入后未能读回`);
    return task;
  }

  // ── 绑定 ──

  getOpenBinding(sessionId: string): TaskBinding | null {
    const row = this.guard('查生效绑定', () =>
      this.db
        .prepare(
          `SELECT ${BINDING_COLUMNS} FROM task_sessions
           WHERE session_id = ? AND unbound_at IS NULL`,
        )
        .get(sessionId),
    ) as TaskSessionRow | undefined;
    return row ? rowToBinding(row) : null;
  }

  /** 该会话在 task_sessions 中是否有过任何绑定(含已关闭的)。 */
  hasAnyBinding(sessionId: string): boolean {
    const row = this.guard('查会话绑定历史', () =>
      this.db.prepare('SELECT 1 AS hit FROM task_sessions WHERE session_id = ? LIMIT 1').get(sessionId),
    );
    return row !== undefined;
  }

  /**
   * 新建生效绑定。撞上 task_sessions_open_idx(该会话已有生效绑定,并发写入)时返回 null,
   * 由调用方重新读取后决定;其它失败抛 TaskStoreError。
   */
  insertBinding(
    sessionId: string,
    taskId: number,
    boundAt: string,
    bindSource: BindSource,
  ): TaskBinding | null {
    let id: number;
    try {
      const r = this.db
        .prepare(
          `INSERT INTO task_sessions (session_id, task_id, bound_at, unbound_at, bind_source)
           VALUES (?, ?, ?, NULL, ?)`,
        )
        .run(sessionId, taskId, boundAt, bindSource);
      id = Number(r.lastInsertRowid);
    } catch (err) {
      if (isOpenBindingConflict(err)) return null;
      throw new TaskStoreError(`新建绑定失败:${errorMessage(err)}`, { cause: err });
    }
    return { id, sessionId, taskId, boundAt, unboundAt: null, bindSource };
  }

  /** 关闭该会话的生效绑定;返回是否有绑定被关闭。 */
  closeOpenBinding(sessionId: string, unboundAt: string): boolean {
    const r = this.guard('关闭绑定', () =>
      this.db
        .prepare(
          `UPDATE task_sessions SET unbound_at = ?
           WHERE session_id = ? AND unbound_at IS NULL`,
        )
        .run(unboundAt, sessionId),
    );
    return r.changes > 0;
  }

  /** 全部绑定,按 task_id、bound_at、id 升序。 */
  listAllBindings(): TaskBinding[] {
    const rows = this.guard('列出全部绑定', () =>
      this.db
        .prepare(`SELECT ${BINDING_COLUMNS} FROM task_sessions ORDER BY task_id, bound_at, id`)
        .all(),
    ) as TaskSessionRow[];
    return rows.map(rowToBinding);
  }

  /** 任务的全部绑定,按 bound_at、id 升序。 */
  listBindingsForTask(taskId: number): TaskBinding[] {
    const rows = this.guard('列出任务绑定', () =>
      this.db
        .prepare(
          `SELECT ${BINDING_COLUMNS} FROM task_sessions
           WHERE task_id = ? ORDER BY bound_at, id`,
        )
        .all(taskId),
    ) as TaskSessionRow[];
    return rows.map(rowToBinding);
  }

  // ── 提醒去重 ──

  /** 记录 (session, A, B) 已提醒;返回 true 表示首次记录(应当提醒)。 */
  recordReminder(sessionId: string, boundTaskId: number, otherTaskId: number, now: string): boolean {
    const r = this.guard('记录提醒', () =>
      this.db
        .prepare(
          `INSERT OR IGNORE INTO task_reminders (session_id, bound_task_id, other_task_id, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(sessionId, boundTaskId, otherTaskId, now),
    );
    return r.changes > 0;
  }

  /** 执行一次 DB 操作,非 TaskError 的异常包成 TaskStoreError。 */
  private guard<T>(action: string, fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      if (err instanceof TaskError) throw err;
      throw new TaskStoreError(`task 存储${action}失败:${errorMessage(err)}`, { cause: err });
    }
  }
}

/** 序列化接口原始条目;无法序列化时记为 null(raw 仅作留档,不参与判断)。 */
function safeJson(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
}
