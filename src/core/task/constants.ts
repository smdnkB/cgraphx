/**
 * task 子系统常量。
 *
 * spec §3(存储与外部接口配置)、§4(外部接口契约)、§6.1(需求目录声明)。
 */

/** task schema 版本(独立的 task_schema_versions 表)。 */
export const TASK_SCHEMA_VERSION = 1;

/** 外部任务接口配置文件名,位于 `.cgraphx/` 下;不存在即视为未配置接口。 */
export const TASK_SOURCE_CONFIG_FILENAME = 'task-source.json';

/** 外部接口单次请求超时(spec §4:不超过 10 秒)。 */
export const TASK_SOURCE_TIMEOUT_MS = 10_000;

/** 任务来源:接口任务 / 手动任务。 */
export const TASK_SOURCES = ['api', 'manual'] as const;

/** 绑定来源:显式绑定 / 需求目录自动绑定。 */
export const BIND_SOURCES = ['cli', 'feature_dir'] as const;
