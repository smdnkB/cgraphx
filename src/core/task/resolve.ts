/**
 * 任务解析与列表(spec §5.1、§5.2、§6.2)。
 *
 * 解析序号沿用 spec §5.2:
 *   1 纯数字且等于本地 id → 2 等于接口任务 external_id → 3 已配置接口:刷新一次后再按 external_id
 *   → 3.5 接口任务名称(规整后相等,需求「任务绑定名称匹配」)→ 4 等于手动任务 name
 *   → 5/6 未配置接口或带 --manual:按名称新建手动任务 → 7 报错。
 * findTask 只走 1、2、目录任务平台编号、3.5、4(不联网、不新建)。
 *
 * 3.5 存在的原因:接口任务原先只能按编号指认,用名称指认时会落到序 5/6,
 * 静默新建一个与接口任务同名的手动任务(或在 spec 头部声明里建出假的接口占位)。
 */

import type { SqliteDatabase } from '../db';
import { resolveSessionId } from './binding';
import { TaskArgError, TaskSourceUnavailableError } from './errors';
import { featureTaskBindError, featureTaskName, isEligibleFeatureDir } from './feature-task';
import { openTaskDb } from './schema-bootstrap';
import { fetchRemoteTasks, loadTaskSourceConfig } from './source';
import { TaskStore } from './store';
import type { TaskItem, TaskListResult, TaskSourceConfig } from './types';

/** sqlite_master 探测:旧库没有目录任务表时降级为不查目录任务。 */
function tableExists(db: SqliteDatabase, name: string): boolean {
  return (
    db.prepare(`SELECT 1 AS hit FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !== undefined
  );
}

/** 名称规整:去掉所有空白(含全角空格)并忽略大小写。只做完全相等比较,不做模糊匹配。 */
export function normalizeTaskName(name: string): string {
  return name.replace(/\s+/gu, '').toLowerCase();
}

/** 规整后名称与 value 相等的接口任务(按本地 id 升序);可能为空或多个。 */
function findApiTasksByName(store: TaskStore, value: string): TaskItem[] {
  const key = normalizeTaskName(value);
  if (!key) return [];
  return store.listApiTasks().filter((t) => normalizeTaskName(t.name) === key);
}

/**
 * 按序 1(本地 id)→ 2(接口任务 external_id)→ 目录任务 platform_task_id
 * → 3.5(接口任务名称,唯一时)→ 4(手动任务 name)查找;
 * 都不中返回 null。名称对应多个接口任务时视同未命中(调用方不联网、不报错的场景)。
 */
export function findTask(store: TaskStore, value: string): TaskItem | null {
  const v = value.trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) {
    const byId = store.getTaskById(Number(v));
    if (byId) return byId;
  }
  const byExternalId = store.findApiTaskByExternalId(v);
  if (byExternalId) return byExternalId;
  // 目录任务映射的平台编号(task list 显示 T-xxx,task show T-xxx 也要能命中)。
  // 只读读取方可能打开本需求之前的旧库(无该表),此时降级为不查目录任务。
  if (store.hasFeatureTaskTable()) {
    const byFeaturePlatformId = store.listFeatureTasks().find((task) => task.externalId === v);
    if (byFeaturePlatformId !== undefined) return byFeaturePlatformId;
  }
  const byName = findApiTasksByName(store, v);
  if (byName.length === 1) return byName[0]!;
  return store.findManualTaskByName(v);
}

/**
 * 自行开关连接的 findTask:按本地 id → 接口编号 → 手动任务名称 → feature-id →
 * 目录任务名称查找,不联网、不新建。
 *
 * @throws TaskConfigError 项目未初始化。
 */
export function findTaskByValue(projectRoot: string, value: string): TaskItem | null {
  const conn = openTaskDb(projectRoot);
  try {
    const db = conn.getDb();
    const store = new TaskStore(db);
    const found = findTask(store, value);
    if (found !== null) return found;
    if (!tableExists(db, 'task_feature_tasks')) return null;
    const v = value.trim();
    if (!v) return null;
    // 目录任务:先按 feature-id 精确匹配,再按去掉日期前缀的任务名称精确匹配。
    const byFeatureId = store.findFeatureTaskByFeatureId(v);
    if (byFeatureId !== null) return byFeatureId;
    return (
      store.listFeatureTasks().find((task) => task.featureId !== null && featureTaskName(task.featureId) === v) ??
      null
    );
  } finally {
    conn.close();
  }
}

/** 目录任务查找(platform_task_id → feature-id → 目录任务名称),供 task use 拒绝用。 */
function findFeatureTaskForUse(store: TaskStore, value: string): TaskItem | null {
  const byPlatformId = store.listFeatureTasks().find((task) => task.externalId === value);
  if (byPlatformId !== undefined) return byPlatformId;
  const byFeatureId = store.findFeatureTaskByFeatureId(value);
  if (byFeatureId !== null) return byFeatureId;
  return (
    store.listFeatureTasks().find(
      (task) => task.featureId !== null && featureTaskName(task.featureId) === value,
    ) ?? null
  );
}

/**
 * 解析 `task use` 的参数为任务,严格按 spec §5.2 的顺序,先命中先用。
 *
 * @throws TaskArgError 参数为空,或已配置接口、不带 manual 且接口中找不到,
 *   或参数指向目录任务(目录任务只能由会话读写自动关联)。
 * @throws TaskSourceUnavailableError 已配置接口、不带 manual 且拉取失败。
 * @throws TaskConfigError 配置文件非法或项目未初始化。
 */
export async function resolveTaskForUse(
  projectRoot: string,
  value: string,
  opts: { manual?: boolean } = {},
): Promise<TaskItem> {
  const v = value.trim();
  if (!v) throw new TaskArgError('任务编号或名称为空;用法:cgraphx task use <编号或名称>');
  const manual = opts.manual === true;
  const config = loadTaskSourceConfig(projectRoot);

  const conn = openTaskDb(projectRoot);
  try {
    const store = new TaskStore(conn.getDb());

    // 序 1:本地 id(目录任务 id 也从这里命中,但不能手动绑定)
    if (/^\d+$/.test(v)) {
      const byId = store.getTaskById(Number(v));
      if (byId) {
        if (byId.source === 'feature') throw featureTaskBindError(v);
        return byId;
      }
    }

    // 序 2:已缓存的接口任务 external_id
    const cached = store.findApiTaskByExternalId(v);
    if (cached) return cached;

    // 序 2.5:目录任务(platform_task_id / feature-id / 名称)不能手动绑定。
    // 头部声明平台编号的目录没有目录任务行,按目录资格再拦一次,避免落到手动任务新建。
    const featureTask = findFeatureTaskForUse(store, v);
    if (featureTask !== null || isEligibleFeatureDir(projectRoot, v)) throw featureTaskBindError(v);

    // 序 3:已配置接口 → 拉取一次并 upsert 后再找
    if (config) {
      try {
        await refreshFromSource(store, config);
        const fetched = store.findApiTaskByExternalId(v);
        if (fetched) return fetched;
      } catch (err) {
        if (!(err instanceof TaskSourceUnavailableError) || !manual) throw err;
        process.stderr.write(`[task] 任务接口不可用:${err.reason};继续按 --manual 解析\n`);
      }
    }

    // 序 3.5:接口任务名称(规整后相等)。唯一 → 直接用,带 --manual 也不新建;多个 → 报错列候选
    const apiByName = findApiTasksByName(store, v);
    if (apiByName.length === 1) return apiByName[0]!;
    if (apiByName.length > 1) {
      const candidates = apiByName.map((t) => `${t.externalId ?? '-'} ${t.name}`).join('、');
      throw new TaskArgError(`名称「${v}」对应多个接口任务:${candidates};请用编号指定`);
    }

    // 序 4:手动任务 name
    const byName = store.findManualTaskByName(v);
    if (byName) return byName;

    // 序 5、6:未配置接口,或带 --manual → 按名称新建(同名复用)
    if (!config || manual) {
      return store.ensureManualTask(v, new Date().toISOString());
    }

    // 序 7
    throw new TaskArgError(`接口中找不到任务 ${v};核对编号,或加 --manual 建手动任务`);
  } finally {
    conn.close();
  }
}

/**
 * 解析需求目录 spec 头部声明的任务值(spec §6.2),不发网络请求。
 * 先 findTask;未命中时,已配置接口就以 external_id = name = value 建接口任务占位,
 * 否则按名称新建(复用)手动任务。
 */
export function resolveDeclaredTask(store: TaskStore, value: string, configured: boolean): TaskItem {
  const hit = findTask(store, value);
  if (hit) return hit;
  const v = value.trim();
  if (!v) throw new TaskArgError('需求目录声明的任务值为空');
  const now = new Date().toISOString();
  return configured ? store.ensureApiPlaceholder(v, now) : store.ensureManualTask(v, now);
}

/**
 * 列出任务(spec §5.1)。未配置接口或 local 为 true → 只读本地;
 * 已配置 → 拉取并 upsert,失败时不抛错,warning 写明原因并展示本地缓存。
 */
export async function listTasks(
  projectRoot: string,
  opts: { local?: boolean } = {},
): Promise<TaskListResult> {
  const config = opts.local === true ? null : loadTaskSourceConfig(projectRoot);

  const conn = openTaskDb(projectRoot);
  try {
    const db = conn.getDb();
    const store = new TaskStore(db);

    let warning: string | null = null;
    if (config) {
      try {
        await refreshFromSource(store, config);
      } catch (err) {
        if (!(err instanceof TaskSourceUnavailableError)) throw err;
        warning = `任务接口不可用:${err.reason};已显示本地缓存`;
      }
    }

    const tasks = store.listTasks();
    if (tableExists(db, 'task_feature_tasks')) tasks.push(...store.listFeatureTasks());

    const sessionId = resolveSessionId();
    const currentTaskId = sessionId ? (store.getOpenBinding(sessionId)?.taskId ?? null) : null;
    return { tasks, currentTaskId, warning };
  } finally {
    conn.close();
  }
}

/**
 * 拉取接口任务并在一个事务里逐条 upsert;接口不再返回的任务保留不删。
 * 非法条目被跳过时在 stderr 警告。
 */
async function refreshFromSource(store: TaskStore, config: TaskSourceConfig): Promise<void> {
  const { tasks, skipped } = await fetchRemoteTasks(config);
  if (skipped > 0) {
    process.stderr.write(
      `[task] 任务接口返回 ${skipped} 条缺少 id / name 的条目,已跳过;请让接口方按契约补齐必填字段\n`,
    );
  }
  if (tasks.length === 0) return;
  const now = new Date().toISOString();
  store.transaction(() => {
    for (const task of tasks) store.upsertApiTask(task, now);
  });
}
