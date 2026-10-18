/**
 * task 子系统公共门面。
 *
 * 外部调用方(cli、hooks、installer)只通过本模块调用,不得直接伸手进内部模块。
 * task 只经 timeline / features 的门面取数据;timeline 与 features 不依赖 task。
 */

export { ensureTaskSchema, openTaskDb } from './schema-bootstrap';
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
} from './feature-task';
export { refreshAutoBindings } from './auto-binding';
export {
  listTaskSummaries,
  getTaskReport,
  computeSegmentStats,
  listBindingsWithTask,
  listEffectiveBindings,
  getCurrentEffectiveBinding,
} from './report';
export { classifyArtifactPath } from './artifacts';
export { taskSessionStartHook, taskPostToolUseHook } from './hooks';
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
