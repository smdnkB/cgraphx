/**
 * sync 子系统常量。T-4 / T-5 的常量由各自任务追加到本文件。
 */

import type { PauseReason } from './types';

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

/** worker 存活标记文件名(位于 `.cgraphx/`;worker 整个生命周期持有)。 */
export const WORKER_PID_FILENAME = 'sync-worker.pid';

/** 非凭据类暂停时,后台探测平台恢复的最小间隔。 */
export const PAUSE_PROBE_MS = 30 * 60_000;

/** 连续失败超过此时长,会话开始时提示一行。 */
export const FAIL_NOTICE_MS = 60 * 60_000;

/** worker 一轮同步后尾随等待的时长(≤ 15 分钟)。 */
export const WORKER_TRAIL_MS = 10 * 60_000;

/** 单个请求最多会话块数。 */
export const BATCH_MAX_SESSIONS = 50;

/** 单个请求最多事件数(也是单块的事件上限)。 */
export const BATCH_MAX_EVENTS = 5000;

/** 单个请求序列化后最大字节数。 */
export const BATCH_MAX_BYTES = 4 * 1024 * 1024;

/** 前台 `sync now` 等待同步锁的最长时间。 */
export const FOREGROUND_LOCK_WAIT_MS = 30_000;

/** 平台错误码提示原表(字面量类型,供 PAUSE_NOTICES 按键直取)。 */
const PLATFORM_HINT_TABLE = {
  invalid_credentials: '账号或密码错误',
  account_disabled: '平台账号已停用,请联系平台管理员',
  repo_not_registered: '本仓库未在平台登记,请联系项目管理员',
  repo_disabled: '本仓库的平台登记已停用',
  not_project_member: '你不是该仓库所属项目的成员',
  invalid_token: '上报凭据已失效,请重新接入(cgraphx sync connect)',
} as const;

/** 平台错误码 → 提示(spec §3.3;接入失败与同步暂停共用)。 */
export const PLATFORM_HINTS: Readonly<Record<string, string>> = PLATFORM_HINT_TABLE;

/** hook 拉起节流:触发文件 mtime 距今小于此值时不再拉起 worker。 */
export const TRIGGER_THROTTLE_MS = 60_000;

/** 单次 sync hook 耗时预算(与 timeline / task 一致),超出写 stderr 告警。 */
export const HOOK_PERF_WARN_MS = 50;

/** hook 识别标记:settings 中命令含此串的 hook 项属于 sync(安装 / 卸载共用)。 */
export const SYNC_HOOK_MARKER = 'cgraphx sync-';

/** 暂停原因 → 会话开始提示中的原因文案(取 PLATFORM_HINTS 对应行;invalid_token 指向重新接入)。 */
export const PAUSE_NOTICES: Readonly<Record<PauseReason, string>> = {
  invalid_token: '上报凭据已失效,请运行 cgraphx sync connect 重新接入',
  account_disabled: PLATFORM_HINT_TABLE.account_disabled,
  repo_not_registered: PLATFORM_HINT_TABLE.repo_not_registered,
  repo_disabled: PLATFORM_HINT_TABLE.repo_disabled,
  not_project_member: PLATFORM_HINT_TABLE.not_project_member,
};
