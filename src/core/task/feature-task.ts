/**
 * 目录任务(spec §2、§4.1、§4.2):产出目录 → 本地任务。
 *
 * 目录头部 `> 任务: T-\d+` → 接口任务;否则 → 目录任务(任务键 = feature-id)。
 * 目录没有负责人头部时不对应任何任务。只读调用方用 resolveFeatureTargetReadOnly,绝不建任务;
 * 建任务行只经 ensureFeatureTaskRow(版本流程与需求副本 spec D38,唯一一处规则)。
 *
 * 需求目录按「在用副本 + 主目录」找(版本流程与需求副本 spec D26,locateFeatureRoot):
 * 登记了这个需求的副本里有就用副本的,否则用主目录的;头部一律在找到的那个根里读。roots 是
 * listProjectRoots 的返回,一轮里多次用的由调用方取一次传入。
 */

import * as path from 'node:path';

import { gitUserName, readFeatureOwner, readFeatureTask, scanFeatureTasks } from '../features';
import { listProjectRoots, listReplicas, locateFeatureRoot, resolveMainRoot, type ProjectRoot } from '../replica';
import { TaskArgError } from './errors';
import { featureTaskName } from './feature-name';
// resolve.ts 也 import 本模块:两边只在函数体里用对方的导出,不在模块顶层调用
import { findTaskByValue } from './resolve';
import { openTaskDb } from './schema-bootstrap';
import { TaskStore } from './store';
import type { TaskItem } from './types';

// 命名解析抽到 feature-name.ts(store 也用它),这里保留导出面。
export { featureDatePrefix, featureTaskName } from './feature-name';

/** 平台任务编号(spec §4.1)。 */
const PLATFORM_TASK_PATTERN = /^T-\d+$/;

/** feature-id 只能是 docs/features/ 下的单段目录名。 */
function isPlainFeatureId(featureId: string): boolean {
  return (
    featureId !== '' &&
    featureId !== '.' &&
    featureId !== '..' &&
    !featureId.includes('/') &&
    !featureId.includes('\\')
  );
}

/**
 * 合格产出目录所在的根:需求目录在主目录或登记了它的在用副本里,且头部有负责人
 * (主 spec 或交接文件);不合格 → null。
 */
function eligibleFeatureRoot(roots: readonly ProjectRoot[], featureId: string): string | null {
  if (!isPlainFeatureId(featureId)) return null;
  const featureRoot = locateFeatureRoot(roots, featureId);
  if (featureRoot === null) return null;
  return readFeatureOwner(featureRoot, featureId) !== null ? featureRoot : null;
}

/** 目录存在且头部有负责人(主 spec 或交接文件),才是可绑定的产出目录。 */
export function isEligibleFeatureDir(roots: readonly ProjectRoot[], featureId: string): boolean {
  return eligibleFeatureRoot(roots, featureId) !== null;
}

/** 主 spec 头部的任务声明,在 locateFeatureRoot 找到的根里读;哪里都没有这个需求目录 → null。 */
function declaredTaskOf(roots: readonly ProjectRoot[], featureId: string): string | null {
  if (!isPlainFeatureId(featureId)) return null;
  const featureRoot = locateFeatureRoot(roots, featureId);
  return featureRoot === null ? null : readFeatureTask(featureRoot, featureId);
}

/** 头部任务声明是否为平台任务编号。 */
export function isPlatformTaskValue(declared: string | null): declared is string {
  return declared !== null && PLATFORM_TASK_PATTERN.test(declared);
}

/** 目录任务不能手动绑定(spec §4.1):统一参数错误文案。 */
export function featureTaskBindError(value: string): TaskArgError {
  return new TaskArgError(
    `${value} 是产出目录对应的目录任务,由会话读写产出目录自动关联,不能手动绑定;如需修正归属请在平台改绑`,
  );
}

/**
 * 需求 → 本机任务行(版本流程与需求副本 spec D38,唯一一处规则):主 spec 头部声明了平台编号 → 接口任务
 * (本机没有占位时补建,否则读取、上报解析不到任务);否则 → 目录任务(没有时新建)。已有就不写。
 * 会话派生到需求、全量刷新给在用副本的需求补行都走这里。
 */
export function ensureFeatureTaskRow(
  store: TaskStore,
  roots: readonly ProjectRoot[],
  featureId: string,
  now: string,
): TaskItem {
  const declared = declaredTaskOf(roots, featureId);
  if (isPlatformTaskValue(declared)) {
    return store.findApiTaskByExternalId(declared) ?? store.ensureApiPlaceholder(declared, now);
  }
  return store.ensureFeatureTask(featureId, now);
}

/**
 * 登记过副本的需求对账(spec D38):主 spec 头部现在声明了平台编号、它的目录任务还没有平台编号 → 删掉这条
 * 目录任务(副本会话在 spec 写出之前建出的);已有平台编号的不删。先查后删;删过返回 true。
 */
export function dropStaleFeatureTask(store: TaskStore, roots: readonly ProjectRoot[], featureId: string): boolean {
  const task = store.findFeatureTaskByFeatureId(featureId);
  if (task === null || task.externalId !== null) return false;
  if (!isPlatformTaskValue(declaredTaskOf(roots, featureId))) return false;
  return store.deleteUnmappedFeatureTask(featureId);
}

/**
 * 只读版目录 → 任务:目录任务行或接口任务不存在时返回 null,不写库。
 * 目录已被删除 / 负责人头部移除时回退到已持久化的目录任务(spec §9:已产生的绑定保留)。
 */
export function resolveFeatureTargetReadOnly(
  roots: readonly ProjectRoot[],
  store: TaskStore,
  featureId: string,
): TaskItem | null {
  const featureRoot = eligibleFeatureRoot(roots, featureId);
  if (featureRoot === null) {
    return store.findFeatureTaskByFeatureId(featureId);
  }
  const declared = readFeatureTask(featureRoot, featureId);
  if (isPlatformTaskValue(declared)) return store.findApiTaskByExternalId(declared);
  return store.findFeatureTaskByFeatureId(featureId);
}

/**
 * scanFeatureTasks 的多根版(spec D26):主目录的结果,在用副本登记的需求按副本里那份算——副本里有这个
 * 需求目录时,去掉主目录里同一个需求的那条,主 spec 声明了任务就加副本的一条(path 同为项目相对路径)。
 * root 为主目录。
 */
export function scanFeatureTasksAcrossRoots(
  root: string,
): Array<{ featureId: string; path: string; task: string }> {
  const roots = listProjectRoots(root);
  let result = scanFeatureTasks(root);
  for (const replica of listReplicas(root)) {
    const { featureId } = replica;
    // locateFeatureRoot 指向这个副本 ⇔ 副本还在且有这个需求目录(先找副本,D26)
    if (locateFeatureRoot(roots, featureId) !== path.resolve(replica.path)) continue;
    result = result.filter((entry) => entry.featureId !== featureId);
    const task = readFeatureTask(replica.path, featureId);
    if (task !== null) result.push({ featureId, path: `docs/features/${featureId}`, task });
  }
  return result;
}

/**
 * 本机负责且需要声明的目录任务(spec §4.2、§5):目录合格、头部没有平台任务编号、
 * 负责人(去首尾空白)等于本机 git user.name。取不到 git 用户名 → 空数组。
 */
export function listMyFeatureTaskDeclarations(
  projectRoot: string,
): Array<{ featureId: string; name: string; declaredAt: string }> {
  const root = resolveMainRoot(projectRoot);
  const me = gitUserName()?.trim();
  if (me === undefined || me === '') return [];

  const roots = listProjectRoots(root);
  const conn = openTaskDb(root);
  try {
    const rows = new TaskStore(conn.getDb()).listFeatureTasks();
    const result: Array<{ featureId: string; name: string; declaredAt: string }> = [];
    for (const task of rows) {
      const featureId = task.featureId;
      if (featureId === null) continue;
      const featureRoot = eligibleFeatureRoot(roots, featureId);
      if (featureRoot === null) continue;
      // 头部关联了平台任务编号的目录不声明(spec §4.2)。
      if (isPlatformTaskValue(readFeatureTask(featureRoot, featureId))) continue;
      if ((readFeatureOwner(featureRoot, featureId) ?? '').trim() !== me) continue;
      result.push({
        featureId,
        name: featureTaskName(featureId),
        declaredAt: task.createdAt,
      });
    }
    return result;
  } finally {
    conn.close();
  }
}

/**
 * 平台回执写回(spec §5):更新 task_feature_tasks.platform_task_id。
 * 未知 feature-id 忽略;updated_at 统一记为本次写入时间。
 */
export function recordFeatureTaskMappings(
  projectRoot: string,
  mappings: Array<{ featureId: string; taskId: string }>,
): void {
  const root = resolveMainRoot(projectRoot);
  if (mappings.length === 0) return;
  const now = new Date().toISOString();
  const conn = openTaskDb(root);
  try {
    const store = new TaskStore(conn.getDb());
    store.transaction(() => {
      for (const m of mappings) {
        store.setFeatureTaskPlatformId(m.featureId, m.taskId, now);
      }
    });
  } finally {
    conn.close();
  }
}

/**
 * 需求目录对应的平台任务(plan C-13;sync 上报副本会话的绑定用),口径与 sync 的
 * toIngestBinding 对接口任务、目录任务的一致:主 spec 头部声明了 `T-<n>` → 该编号,
 * 不带任务键;否则 → 目录任务的平台编号(回执写回过才有)与任务键 feature-id。
 */
export function featureBindingTarget(
  projectRoot: string,
  featureId: string,
): { taskId: string | null; taskKey: string | null } {
  const root = resolveMainRoot(projectRoot);
  const declared = declaredTaskOf(listProjectRoots(root), featureId);
  if (isPlatformTaskValue(declared)) return { taskId: declared, taskKey: null };
  return { taskId: findTaskByValue(root, featureId)?.externalId ?? null, taskKey: featureId };
}
