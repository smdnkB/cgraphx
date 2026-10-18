/**
 * TaskStore —— task 子系统的持久化层。
 *
 * 包装一个 SqliteDatabase(共享的 .cgraphx/cgraphx.db),只碰 `task_*` 表。
 * 连接归调用方所有,由调用方关闭。行类型(XxxRow)到领域类型的映射在这里完成,
 * 原始行不外泄;SQL 全部参数化;DB 异常统一包成 TaskStoreError。
 */

import type { SqliteDatabase } from '../db';
import { FEATURE_TASK_ID_BASE } from './constants';
import { TaskError, TaskStoreError } from './errors';
import { featureTaskName } from './feature-name';
import type {
  AutoSession,
  AutoStrength,
  BindSource,
  RemoteTask,
  TaskBinding,
  TaskItem,
  TaskSource,
} from './types';

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

interface FeatureTaskRow {
  id: number;
  feature_id: string;
  platform_task_id: string | null;
  created_at: string;
  updated_at: string;
}

interface AutoSessionRow {
  session_id: string;
  derived_max_event_id: number;
  feature_id: string | null;
  strength: string | null;
  bound_at: string | null;
  stopped_at: string | null;
  derived_at: string;
}

interface AutoMetaRow {
  key: string;
  value: string;
}

function rowToTask(row: TaskItemRow): TaskItem {
  return {
    id: row.id,
    source: row.source as TaskSource,
    externalId: row.external_id,
    name: row.name,
    url: row.url,
    status: row.status,
    featureId: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 目录任务行 → 领域任务(task_items 之外单独成表,source 固定 feature)。 */
function rowToFeatureTask(row: FeatureTaskRow): TaskItem {
  return {
    id: row.id,
    source: 'feature',
    externalId: row.platform_task_id,
    name: featureTaskName(row.feature_id),
    url: null,
    status: null,
    featureId: row.feature_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAutoSession(row: AutoSessionRow): AutoSession {
  return {
    sessionId: row.session_id,
    derivedMaxEventId: row.derived_max_event_id,
    featureId: row.feature_id,
    strength: row.strength as AutoStrength | null,
    boundAt: row.bound_at,
    stoppedAt: row.stopped_at,
    derivedAt: row.derived_at,
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
const FEATURE_TASK_COLUMNS = 'id, feature_id, platform_task_id, created_at, updated_at';
const AUTO_SESSION_COLUMNS =
  'session_id, derived_max_event_id, feature_id, strength, bound_at, stopped_at, derived_at';

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
    // 目录任务单独成表,id 空间从 FEATURE_TASK_ID_BASE 起。
    if (id >= FEATURE_TASK_ID_BASE) return this.getFeatureTaskById(id);
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

  // ── 目录任务 ──

  /** 旧库(本需求之前的 schema)没有目录任务表;只读读取方据此降级。 */
  hasFeatureTaskTable(): boolean {
    return (
      this.db
        .prepare("SELECT 1 AS hit FROM sqlite_master WHERE type = 'table' AND name = 'task_feature_tasks'")
        .get() !== undefined
    );
  }

  getFeatureTaskById(id: number): TaskItem | null {
    const row = this.guard('按 id 查目录任务', () =>
      this.db.prepare(`SELECT ${FEATURE_TASK_COLUMNS} FROM task_feature_tasks WHERE id = ?`).get(id),
    ) as FeatureTaskRow | undefined;
    return row ? rowToFeatureTask(row) : null;
  }

  findFeatureTaskByFeatureId(featureId: string): TaskItem | null {
    const row = this.guard('按 feature-id 查目录任务', () =>
      this.db
        .prepare(`SELECT ${FEATURE_TASK_COLUMNS} FROM task_feature_tasks WHERE feature_id = ?`)
        .get(featureId),
    ) as FeatureTaskRow | undefined;
    return row ? rowToFeatureTask(row) : null;
  }

  /** 全部目录任务,按 id 升序。 */
  listFeatureTasks(): TaskItem[] {
    const rows = this.guard('列出目录任务', () =>
      this.db.prepare(`SELECT ${FEATURE_TASK_COLUMNS} FROM task_feature_tasks ORDER BY id`).all(),
    ) as FeatureTaskRow[];
    return rows.map(rowToFeatureTask);
  }

  /**
   * 目录任务按 feature-id upsert(已存在则原样返回,不覆盖平台编号 / 时间)。
   * id 取 max(FEATURE_TASK_ID_BASE, MAX(id) + 1);并发撞 id 时重试一次。
   */
  ensureFeatureTask(featureId: string, now: string): TaskItem {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = this.findFeatureTaskByFeatureId(featureId);
      if (existing) return existing;
      const id = this.nextFeatureTaskId();
      this.guard('写入目录任务', () =>
        this.db
          .prepare(
            `INSERT OR IGNORE INTO task_feature_tasks
               (id, feature_id, platform_task_id, created_at, updated_at)
             VALUES (?, ?, NULL, ?, ?)`,
          )
          .run(id, featureId, now, now),
      );
    }
    const task = this.findFeatureTaskByFeatureId(featureId);
    if (!task) throw new TaskStoreError(`目录任务「${featureId}」写入后未能读回`);
    return task;
  }

  /** 平台回执写回;未知 feature-id 更新 0 行,忽略。 */
  setFeatureTaskPlatformId(featureId: string, platformTaskId: string, now: string): void {
    this.guard('更新目录任务平台编号', () =>
      this.db
        .prepare(
          `UPDATE task_feature_tasks SET platform_task_id = ?, updated_at = ? WHERE feature_id = ?`,
        )
        .run(platformTaskId, now, featureId),
    );
  }

  private nextFeatureTaskId(): number {
    const row = this.guard('取目录任务编号', () =>
      this.db.prepare('SELECT MAX(id) AS max_id FROM task_feature_tasks').get(),
    ) as { max_id: number | null } | undefined;
    const maxId = Number(row?.max_id ?? 0);
    return Math.max(FEATURE_TASK_ID_BASE, maxId + 1);
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

  // ── 自动绑定派生 ──

  getAutoSession(sessionId: string): AutoSession | null {
    const row = this.guard('查会话派生结果', () =>
      this.db
        .prepare(`SELECT ${AUTO_SESSION_COLUMNS} FROM task_auto_sessions WHERE session_id = ?`)
        .get(sessionId),
    ) as AutoSessionRow | undefined;
    return row ? rowToAutoSession(row) : null;
  }

  /** 全部会话派生结果,按 session_id 升序。 */
  listAutoSessions(): AutoSession[] {
    const rows = this.guard('列出会话派生结果', () =>
      this.db
        .prepare(`SELECT ${AUTO_SESSION_COLUMNS} FROM task_auto_sessions ORDER BY session_id`)
        .all(),
    ) as AutoSessionRow[];
    return rows.map(rowToAutoSession);
  }

  /**
   * 写入派生结果(session_id 冲突时覆盖结果与水位)。
   * stopped_at 只在首次插入时生效,后续刷新保留已有值(R6 手动之后自动规则永久停止)。
   */
  upsertAutoSession(session: AutoSession): void {
    this.guard('写入会话派生结果', () =>
      this.db
        .prepare(
          `INSERT INTO task_auto_sessions
             (session_id, derived_max_event_id, feature_id, strength, bound_at, stopped_at, derived_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             derived_max_event_id = excluded.derived_max_event_id,
             feature_id = excluded.feature_id,
             strength = excluded.strength,
             bound_at = excluded.bound_at,
             derived_at = excluded.derived_at`,
        )
        .run(
          session.sessionId,
          session.derivedMaxEventId,
          session.featureId,
          session.strength,
          session.boundAt,
          session.stoppedAt,
          session.derivedAt,
        ),
    );
  }

  /**
   * 记录自动规则停止点(手动 task use / clear)。没有派生行时也插入一行:
   * derived_max_event_id = 0 保证下次刷新重算,stopped_at 由 upsertAutoSession 保留。
   */
  setAutoStop(sessionId: string, stoppedAt: string): void {
    this.guard('记录自动绑定停止点', () =>
      this.db
        .prepare(
          `INSERT INTO task_auto_sessions
             (session_id, derived_max_event_id, feature_id, strength, bound_at, stopped_at, derived_at)
           VALUES (?, 0, NULL, NULL, NULL, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET stopped_at = excluded.stopped_at`,
        )
        .run(sessionId, stoppedAt, stoppedAt),
    );
  }

  /** 标记一条旧绑定被派生结果取代;重复标记保持首次时间(幂等)。 */
  supersedeBinding(bindingId: number, now: string): void {
    this.guard('标记被取代绑定', () =>
      this.db
        .prepare(
          'INSERT OR IGNORE INTO task_superseded_bindings (binding_id, superseded_at) VALUES (?, ?)',
        )
        .run(bindingId, now),
    );
  }

  /** 已取代绑定的 task_sessions id 集合。 */
  listSupersededBindingIds(): Set<number> {
    const rows = this.guard('列出被取代绑定', () =>
      this.db.prepare('SELECT binding_id FROM task_superseded_bindings').all(),
    ) as Array<{ binding_id: number }>;
    return new Set(rows.map((r) => Number(r.binding_id)));
  }

  getMeta(key: string): string | null {
    const row = this.guard('读派生元信息', () =>
      this.db.prepare('SELECT value FROM task_auto_meta WHERE key = ?').get(key),
    ) as AutoMetaRow | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.guard('写派生元信息', () =>
      this.db
        .prepare('INSERT OR REPLACE INTO task_auto_meta (key, value) VALUES (?, ?)')
        .run(key, value),
    );
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
