/**
 * 并旧库的 task 表(spec:2026-11-05-数据按项目放用户目录 D29 task 部分、K12)。
 *
 * project 子系统并旧数据时,在旧库写事务里调 mergeTaskTables:把目录本地旧库的 task_* 表并进用户目录里的项目库。
 * 逐表,旧库没有这张表就跳过;项目库的写入包在一个 BEGIN IMMEDIATE 事务里,出错整体回滚。旧库只读,不开它的
 * 事务(由调用方持有),也不给它补 schema。
 *
 * - task_items:接口任务按 external_id、手动任务按 name 对上就用项目库已有的 id,对不上插入新行
 * - task_feature_tasks:按 feature_id 对上就用已有的(没有平台编号的补上旧库的),对不上按目录任务 id 规则新建
 * - task_sessions:任务 id 换算后同会话、同任务、同 bound_at 算重复;项目库这个会话已有生效绑定时,旧库的生效绑定不并
 * - task_superseded_bindings、task_reminders:引用的 id 换算后插入,换算不到的、已有的跳过
 * - task_auto_sessions:项目库没有这个会话才插入,水位按事件 id 对照换算;有的不动(K12 不重算)
 * - task_auto_meta:项目库没有 history_pass_done 才写旧库的值
 */

import type { SqliteDatabase } from '../db';
import type { EventIdMapping } from '../timeline';
import { AUTO_META_KEYS, FEATURE_TASK_ID_BASE } from './constants';
import { TaskError, TaskStoreError } from './errors';
import { ensureTaskSchema } from './schema-bootstrap';

/** 并的 task 表;task_schema_versions 不并(项目库有自己的版本记录)。 */
const MERGED_TABLES = [
  'task_items',
  'task_feature_tasks',
  'task_sessions',
  'task_superseded_bindings',
  'task_reminders',
  'task_auto_sessions',
  'task_auto_meta',
] as const;
type MergedTable = (typeof MERGED_TABLES)[number];

/** 首轮历史派生是否完成的元信息键(同 auto-binding)。 */
const HISTORY_PASS_META_KEY = AUTO_META_KEYS[0]!;

// ─── 行类型 ────────────────────────────────────────────────────────────────

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

interface FeatureTaskRow {
  id: number;
  feature_id: string;
  platform_task_id: string | null;
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

interface SupersededBindingRow {
  binding_id: number;
  superseded_at: string;
}

interface ReminderRow {
  session_id: string;
  bound_task_id: number;
  other_task_id: number;
  created_at: string;
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

interface IdRow {
  id: number | bigint;
}

/** 两边的 id 对照:任务(task_items 与目录任务两个 id 空间不重叠,共用一张)、绑定。 */
interface IdMaps {
  tasks: Map<number, number>;
  bindings: Map<number, number>;
}

// ─── 门面函数 ──────────────────────────────────────────────────────────────

/**
 * spec D29 的 task 表部分:由 project 子系统在旧库写事务里调用;旧库没有 task 表时什么都不做。项目库先补 task
 * schema(幂等),再在一个 BEGIN IMMEDIATE 事务里逐表并;旧库只读。
 *
 * @throws TaskConfigError 项目库的 task schema 比本构建新。
 * @throws TaskStoreError 读旧库、写项目库失败(项目库已回滚)。
 */
export function mergeTaskTables(oldDb: SqliteDatabase, projectDb: SqliteDatabase, mapping: EventIdMapping): void {
  const present = new Set<MergedTable>();
  try {
    for (const table of MERGED_TABLES) if (hasTable(oldDb, table)) present.add(table);
  } catch (err) {
    throw wrapError('读旧库的 task 表信息', err);
  }
  if (present.size === 0) return;

  ensureTaskSchema(projectDb);
  const ids: IdMaps = { tasks: new Map(), bindings: new Map() };
  try {
    inImmediateTransaction(projectDb, () => {
      if (present.has('task_items')) mergeTaskItems(oldDb, projectDb, ids);
      if (present.has('task_feature_tasks')) mergeFeatureTasks(oldDb, projectDb, ids);
      if (present.has('task_sessions')) mergeSessions(oldDb, projectDb, ids);
      if (present.has('task_superseded_bindings')) mergeSupersededBindings(oldDb, projectDb, ids);
      if (present.has('task_reminders')) mergeReminders(oldDb, projectDb, ids);
      if (present.has('task_auto_sessions')) mergeAutoSessions(oldDb, projectDb, mapping);
      if (present.has('task_auto_meta')) mergeAutoMeta(oldDb, projectDb);
    });
  } catch (err) {
    throw wrapError('并旧库的 task 表', err);
  }
}

// ─── 逐表 ──────────────────────────────────────────────────────────────────

/** task_items:接口任务按 external_id、手动任务按 name 对上用已有的 id;对不上插入(除 id 外各列照旧库)。 */
function mergeTaskItems(oldDb: SqliteDatabase, projectDb: SqliteDatabase, ids: IdMaps): void {
  const byExternalId = projectDb.prepare("SELECT id FROM task_items WHERE source = 'api' AND external_id = ?");
  const byName = projectDb.prepare('SELECT id FROM task_items WHERE source = ? AND name = ?');
  const insert = projectDb.prepare(
    `INSERT INTO task_items (source, external_id, name, url, status, raw, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const rows = oldDb
    .prepare(
      'SELECT id, source, external_id, name, url, status, raw, created_at, updated_at FROM task_items ORDER BY id',
    )
    .all() as TaskItemRow[];
  for (const row of rows) {
    const hit = (row.source === 'api' ? byExternalId.get(row.external_id) : byName.get(row.source, row.name)) as
      | IdRow
      | undefined;
    const id =
      hit !== undefined
        ? Number(hit.id)
        : Number(
            insert.run(row.source, row.external_id, row.name, row.url, row.status, row.raw, row.created_at, row.updated_at)
              .lastInsertRowid,
          );
    ids.tasks.set(Number(row.id), id);
  }
}

/**
 * task_feature_tasks:按 feature_id 对上用已有的——已有平台编号的不改,没有的补上旧库的(updated_at 取两边较晚的);
 * 对不上按目录任务 id 规则(max(FEATURE_TASK_ID_BASE, MAX(id) + 1))新建,其余列照旧库。
 */
function mergeFeatureTasks(oldDb: SqliteDatabase, projectDb: SqliteDatabase, ids: IdMaps): void {
  const find = projectDb.prepare(
    'SELECT id, feature_id, platform_task_id, created_at, updated_at FROM task_feature_tasks WHERE feature_id = ?',
  );
  const fillPlatformId = projectDb.prepare(
    'UPDATE task_feature_tasks SET platform_task_id = ?, updated_at = ? WHERE id = ?',
  );
  const maxId = projectDb.prepare('SELECT MAX(id) AS max_id FROM task_feature_tasks');
  const insert = projectDb.prepare(
    `INSERT INTO task_feature_tasks (id, feature_id, platform_task_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const rows = oldDb
    .prepare('SELECT id, feature_id, platform_task_id, created_at, updated_at FROM task_feature_tasks ORDER BY id')
    .all() as FeatureTaskRow[];
  for (const row of rows) {
    const hit = find.get(row.feature_id) as FeatureTaskRow | undefined;
    if (hit !== undefined) {
      if (hit.platform_task_id === null && row.platform_task_id !== null) {
        fillPlatformId.run(row.platform_task_id, laterOf(hit.updated_at, row.updated_at), hit.id);
      }
      ids.tasks.set(Number(row.id), Number(hit.id));
      continue;
    }
    const current = maxId.get() as { max_id: number | bigint | null } | undefined;
    const id = Math.max(FEATURE_TASK_ID_BASE, Number(current?.max_id ?? 0) + 1);
    insert.run(id, row.feature_id, row.platform_task_id, row.created_at, row.updated_at);
    ids.tasks.set(Number(row.id), id);
  }
}

/**
 * task_sessions:task_id 换算后,同一 session_id、task_id、bound_at 的算重复(用已有行的 id);项目库这个会话已有
 * 生效绑定时,旧库的生效绑定不并;其余插入。任务换算不到(旧库里引用了不在的任务)的并不过去,跳过。
 */
function mergeSessions(oldDb: SqliteDatabase, projectDb: SqliteDatabase, ids: IdMaps): void {
  const findSame = projectDb.prepare(
    'SELECT id FROM task_sessions WHERE session_id = ? AND task_id = ? AND bound_at = ?',
  );
  const findOpen = projectDb.prepare('SELECT id FROM task_sessions WHERE session_id = ? AND unbound_at IS NULL');
  const insert = projectDb.prepare(
    `INSERT INTO task_sessions (session_id, task_id, bound_at, unbound_at, bind_source)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const rows = oldDb
    .prepare('SELECT id, session_id, task_id, bound_at, unbound_at, bind_source FROM task_sessions ORDER BY id')
    .all() as TaskSessionRow[];
  for (const row of rows) {
    const taskId = ids.tasks.get(Number(row.task_id));
    if (taskId === undefined) continue;
    const same = findSame.get(row.session_id, taskId, row.bound_at) as IdRow | undefined;
    if (same !== undefined) {
      ids.bindings.set(Number(row.id), Number(same.id));
      continue;
    }
    if (row.unbound_at === null && findOpen.get(row.session_id) !== undefined) continue;
    const result = insert.run(row.session_id, taskId, row.bound_at, row.unbound_at, row.bind_source);
    ids.bindings.set(Number(row.id), Number(result.lastInsertRowid));
  }
}

/** task_superseded_bindings:binding_id 换算后插入;换算不到(指向没并的绑定)或已存在的跳过。 */
function mergeSupersededBindings(oldDb: SqliteDatabase, projectDb: SqliteDatabase, ids: IdMaps): void {
  const insert = projectDb.prepare(
    'INSERT OR IGNORE INTO task_superseded_bindings (binding_id, superseded_at) VALUES (?, ?)',
  );
  const rows = oldDb
    .prepare('SELECT binding_id, superseded_at FROM task_superseded_bindings ORDER BY binding_id')
    .all() as SupersededBindingRow[];
  for (const row of rows) {
    const bindingId = ids.bindings.get(Number(row.binding_id));
    if (bindingId === undefined) continue;
    insert.run(bindingId, row.superseded_at);
  }
}

/** task_reminders:bound_task_id、other_task_id 换算后 INSERT OR IGNORE;任一个换算不到的跳过。 */
function mergeReminders(oldDb: SqliteDatabase, projectDb: SqliteDatabase, ids: IdMaps): void {
  const insert = projectDb.prepare(
    `INSERT OR IGNORE INTO task_reminders (session_id, bound_task_id, other_task_id, created_at)
     VALUES (?, ?, ?, ?)`,
  );
  const rows = oldDb
    .prepare('SELECT session_id, bound_task_id, other_task_id, created_at FROM task_reminders')
    .all() as ReminderRow[];
  for (const row of rows) {
    const boundTaskId = ids.tasks.get(Number(row.bound_task_id));
    const otherTaskId = ids.tasks.get(Number(row.other_task_id));
    if (boundTaskId === undefined || otherTaskId === undefined) continue;
    insert.run(row.session_id, boundTaskId, otherTaskId, row.created_at);
  }
}

/**
 * task_auto_sessions(K12):项目库没有这个会话 → 插入,derived_max_event_id 按事件 id 对照换算(mapProgress),
 * 其余列照旧;项目库已有 → 不动,不重算。
 */
function mergeAutoSessions(oldDb: SqliteDatabase, projectDb: SqliteDatabase, mapping: EventIdMapping): void {
  const exists = projectDb.prepare('SELECT 1 AS hit FROM task_auto_sessions WHERE session_id = ?');
  const insert = projectDb.prepare(
    `INSERT INTO task_auto_sessions
       (session_id, derived_max_event_id, feature_id, strength, bound_at, stopped_at, derived_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const rows = oldDb
    .prepare(
      `SELECT session_id, derived_max_event_id, feature_id, strength, bound_at, stopped_at, derived_at
       FROM task_auto_sessions ORDER BY session_id`,
    )
    .all() as AutoSessionRow[];
  for (const row of rows) {
    if (exists.get(row.session_id) !== undefined) continue;
    const progress = mapping.mapProgress(row.session_id, Number(row.derived_max_event_id));
    insert.run(row.session_id, progress, row.feature_id, row.strength, row.bound_at, row.stopped_at, row.derived_at);
  }
}

/** task_auto_meta:项目库没有 history_pass_done 才写旧库的值。 */
function mergeAutoMeta(oldDb: SqliteDatabase, projectDb: SqliteDatabase): void {
  const row = oldDb.prepare('SELECT value FROM task_auto_meta WHERE key = ?').get(HISTORY_PASS_META_KEY) as
    | { value: string }
    | undefined;
  if (row === undefined) return;
  projectDb
    .prepare('INSERT OR IGNORE INTO task_auto_meta (key, value) VALUES (?, ?)')
    .run(HISTORY_PASS_META_KEY, row.value);
}

// ─── 工具 ──────────────────────────────────────────────────────────────────

/** 库里有没有这张表(只查 sqlite_master)。 */
function hasTable(db: SqliteDatabase, name: string): boolean {
  return db.prepare("SELECT 1 AS hit FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
}

/** 在 BEGIN IMMEDIATE 事务里执行:开事务即拿写锁;fn 抛错则回滚并原样抛出。 */
function inImmediateTransaction(db: SqliteDatabase, fn: () => void): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 事务可能已被 SQLite 自动回滚,忽略
    }
    throw err;
  }
}

/** 两个 ISO 时间里晚的那个。 */
function laterOf(a: string, b: string): string {
  return b > a ? b : a;
}

/** task 自己的错误原样抛;其余包成 TaskStoreError。 */
function wrapError(action: string, err: unknown): Error {
  if (err instanceof TaskError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  return new TaskStoreError(`${action}失败:${msg}`, { cause: err });
}
