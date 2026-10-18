/**
 * 目录任务(spec §2、§4.1、§4.2):产出目录 → 本地任务。
 *
 * 目录头部 `> 任务: T-\d+` → 接口任务;否则 → 目录任务(任务键 = feature-id)。
 * 目录没有负责人头部时不对应任何任务。只读调用方用 resolveFeatureTargetReadOnly,绝不建任务。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { FEATURES_DIR, gitUserName, readFeatureOwner, readFeatureTask } from '../features';
import { openTaskDb } from './schema-bootstrap';
import { TaskStore } from './store';
import type { TaskItem } from './types';

/** feature-id 开头的日期前缀(YYYY-MM-DD)。 */
const DATE_PREFIX_PATTERN = /^(\d{4}-\d{2}-\d{2})-/;

/** 平台任务编号(spec §4.1)。 */
const PLATFORM_TASK_PATTERN = /^T-\d+$/;

/** feature-id 开头的日期前缀;取不到返回 null(视为最早)。 */
export function featureDatePrefix(featureId: string): string | null {
  return DATE_PREFIX_PATTERN.exec(featureId)?.[1] ?? null;
}

/** 目录任务名称:去掉日期前缀后的文件前缀;无日期前缀返回原值。 */
export function featureTaskName(featureId: string): string {
  const prefix = featureDatePrefix(featureId);
  return prefix === null ? featureId : featureId.slice(prefix.length + 1);
}

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

/** 目录存在且头部有负责人(主 spec 或交接文件),才是可绑定的产出目录。 */
export function isEligibleFeatureDir(projectRoot: string, featureId: string): boolean {
  if (!isPlainFeatureId(featureId)) return false;
  try {
    const dir = path.join(projectRoot, FEATURES_DIR, featureId);
    if (!fs.statSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  return readFeatureOwner(projectRoot, featureId) !== null;
}

/** 头部任务声明是否为平台任务编号。 */
function isPlatformTaskValue(declared: string | null): declared is string {
  return declared !== null && PLATFORM_TASK_PATTERN.test(declared);
}

/**
 * 目录 → 任务(spec §4.1):不合格目录 → null;头部声明平台编号 → 该接口任务
 * (本地没有则建占位);否则 → 目录任务(不存在则新建)。
 */
export function resolveFeatureTarget(
  projectRoot: string,
  store: TaskStore,
  featureId: string,
): TaskItem | null {
  if (!isEligibleFeatureDir(projectRoot, featureId)) return null;
  const declared = readFeatureTask(projectRoot, featureId);
  if (isPlatformTaskValue(declared)) {
    return store.findApiTaskByExternalId(declared) ?? store.ensureApiPlaceholder(declared, new Date().toISOString());
  }
  return store.ensureFeatureTask(featureId, new Date().toISOString());
}

/** 只读版目录 → 任务:目录任务行或接口任务不存在时返回 null,不写库。 */
export function resolveFeatureTargetReadOnly(
  projectRoot: string,
  store: TaskStore,
  featureId: string,
): TaskItem | null {
  if (!isEligibleFeatureDir(projectRoot, featureId)) return null;
  const declared = readFeatureTask(projectRoot, featureId);
  if (isPlatformTaskValue(declared)) return store.findApiTaskByExternalId(declared);
  return store.findFeatureTaskByFeatureId(featureId);
}

/**
 * 本机负责且需要声明的目录任务(spec §4.2、§5):目录合格、头部没有平台任务编号、
 * 负责人(去首尾空白)等于本机 git user.name。取不到 git 用户名 → 空数组。
 */
export function listMyFeatureTaskDeclarations(
  projectRoot: string,
): Array<{ featureId: string; name: string; declaredAt: string }> {
  const me = gitUserName()?.trim();
  if (me === undefined || me === '') return [];

  const conn = openTaskDb(projectRoot);
  try {
    const rows = new TaskStore(conn.getDb()).listFeatureTasks();
    const result: Array<{ featureId: string; name: string; declaredAt: string }> = [];
    for (const task of rows) {
      const featureId = task.featureId;
      if (featureId === null) continue;
      if (!isEligibleFeatureDir(projectRoot, featureId)) continue;
      // 头部关联了平台任务编号的目录不声明(spec §4.2)。
      if (isPlatformTaskValue(readFeatureTask(projectRoot, featureId))) continue;
      if ((readFeatureOwner(projectRoot, featureId) ?? '').trim() !== me) continue;
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
  if (mappings.length === 0) return;
  const now = new Date().toISOString();
  const conn = openTaskDb(projectRoot);
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
