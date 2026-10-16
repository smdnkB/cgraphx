/**
 * sync 子系统常量。T-4 / T-5 的常量由各自任务追加到本文件。
 */

/** sync schema 版本(独立的 sync_schema_versions 表)。 */
export const SYNC_SCHEMA_VERSION = 1;

/** 上报的客户端名(spec §3.1 客户端标识)。 */
export const CLIENT_NAME = 'cgraphx';

/** 平台客户端接口路径前缀(契约 v1)。 */
export const CLIENT_API_PREFIX = '/api/client/v1';

/** 任务源配置 url 的固定后缀;`url` 以此结尾才视为平台写入的配置。 */
export const TASKS_PATH_SUFFIX = '/api/client/v1/tasks';

/** 单次平台请求超时。 */
export const CLIENT_TIMEOUT_MS = 30_000;

/** 终端会话 id 前缀(后接 16 位十六进制)。 */
export const TERMINAL_SESSION_PREFIX = 'cgraphx-terminal-';

/** 沉淀目录(项目根相对 POSIX 路径前缀;唯一定义处)。 */
export const SEDIMENT_DIRS = ['docs/knowledge/', 'docs/schema-knowledge/', 'docs/code-map/', 'docs/design-map/'] as const;

/** 一次 runSync 期间持有的互斥锁文件名(位于 `.cgraphx/`)。 */
export const LOCK_FILENAME = 'sync.lock';

/** 拉起节流用的触发文件名(位于 `.cgraphx/`)。 */
export const TRIGGER_FILENAME = 'sync-trigger';

/** 锁超过此时长视为陈旧,可接管。 */
export const LOCK_STALE_MS = 2 * 3600_000;
