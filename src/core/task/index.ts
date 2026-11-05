/**
 * task 子系统公共门面。
 *
 * 外部调用方(cli、hooks、installer、sync、project)只通过本模块调用,不得直接伸手进内部模块。
 * task 只经 timeline / features / replica / agents 的门面和基础层取数据;它们都不依赖 task。
 *
 * 库和接口配置在数据位置(基础层 data-location.ts)。传入的项目根就是当前根,不再换成主目录;路径换算、找需求
 * 目录按根汇总——timeline 记下的根 + 当前根 + 这些根上的副本登记(collectProjectRoots,
 * spec:2026-11-05-数据按项目放用户目录 D11)。并旧数据时 project 子系统经 mergeTaskTables 并 task 表(D29)。
 */

export { ensureTaskSchema, openTaskDb } from './schema-bootstrap';
export { collectProjectRoots } from './roots';
export type { ProjectRootSet } from './roots';
export { mergeTaskTables } from './merge';
export {
  getTaskSourceConfigPath,
  loadTaskSourceConfig,
  writeTaskSourceConfig,
  removeTaskSourceConfig,
  fetchRemoteTasks,
} from './source';
export { findTaskByValue, resolveTaskForUse, resolveDeclaredTask, listTasks } from './resolve';
export { bindSession, getCurrentBinding, clearBinding, stopAutoBinding, resolveSessionId } from './binding';
export { getTaskDetail } from './feature-link';
export {
  recordFeatureTaskMappings,
  listMyFeatureTaskDeclarations,
  featureBindingTarget,
} from './feature-task';
export { refreshAutoBindings } from './auto-binding';
export {
  listTaskSummaries,
  getTaskReport,
  computeSegmentStats,
  listEffectiveBindings,
  getCurrentEffectiveBinding,
} from './report';
export { classifyArtifactPath } from './artifacts';
export { taskSessionStartHook, taskStopHook, taskPostToolUseHook } from './hooks';
export { installTaskHooks, uninstallTaskHooks } from './installer';
export {
  TASK_SCHEMA_VERSION,
  TASK_SOURCE_CONFIG_FILENAME,
  TASK_SOURCE_TIMEOUT_MS,
  TASK_SOURCES,
  BIND_SOURCES,
  ACTIVE_GAP_MS,
  ARTIFACT_CATEGORIES,
  REFERENCE_CATEGORIES,
  FEATURE_TASK_ID_BASE,
  AUTO_STRENGTHS,
  AUTO_META_KEYS,
} from './constants';
export type {
  TaskSource,
  BindSource,
  AutoStrength,
  AutoSession,
  TaskItem,
  TaskBinding,
  TaskSourceConfig,
  RemoteTask,
  TaskListResult,
  BindResult,
  CurrentBinding,
  EffectiveBinding,
  TaskDetail,
  SegmentStats,
  TaskTotals,
  TaskSummary,
  SegmentReport,
  ArtifactCategory,
  ArtifactGroup,
  ReferenceReport,
  TaskReport,
} from './types';
export {
  TaskError,
  TaskConfigError,
  TaskNotEnabledError,
  TaskArgError,
  TaskStoreError,
  TaskSourceUnavailableError,
} from './errors';
