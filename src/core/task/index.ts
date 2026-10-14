/**
 * task 子系统公共门面。
 *
 * 外部调用方(cli、hooks、installer)只通过本模块调用,不得直接伸手进内部模块。
 * task 只经 timeline / features 的门面取数据;timeline 与 features 不依赖 task。
 */

export { ensureTaskSchema, openTaskDb } from './schema-bootstrap';
export { loadTaskSourceConfig, fetchRemoteTasks } from './source';
export { findTaskByValue, resolveTaskForUse, resolveDeclaredTask, listTasks } from './resolve';
export { bindSession, getCurrentBinding, clearBinding, resolveSessionId } from './binding';
export { autoBindFromFeatureDir, getTaskDetail } from './feature-link';
export { taskSessionStartHook, taskPostToolUseHook } from './hooks';
export { installTaskHooks, uninstallTaskHooks } from './installer';
export {
  TASK_SCHEMA_VERSION,
  TASK_SOURCE_CONFIG_FILENAME,
  TASK_SOURCE_TIMEOUT_MS,
  TASK_SOURCES,
  BIND_SOURCES,
} from './constants';
export type {
  TaskSource,
  BindSource,
  TaskItem,
  TaskBinding,
  TaskSourceConfig,
  RemoteTask,
  TaskListResult,
  BindResult,
  CurrentBinding,
  AutoBindOutcome,
  TaskDetail,
} from './types';
export {
  TaskError,
  TaskConfigError,
  TaskNotEnabledError,
  TaskArgError,
  TaskStoreError,
  TaskSourceUnavailableError,
} from './errors';
