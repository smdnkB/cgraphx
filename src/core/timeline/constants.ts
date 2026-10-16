/**
 * Constants for the Developer Timeline subsystem.
 *
 * Spec §2.3 — field size caps; §3.1 — kill-switch.
 */

/** Kill-switch env var: any non-empty value (except '0'/'false') disables timeline. */
export const NO_TIMELINE_ENV = 'CGRAPHX_NO_TIMELINE';

/** Schema version (independent timeline_schema_versions table). */
export const TIMELINE_SCHEMA_VERSION = 2;

/** Field size caps (spec §2.3). */
export const ARGS_MAX_BYTES = 64 * 1024;
export const RESULT_SUMMARY_MAX_BYTES = 8 * 1024;
export const PROMPT_MAX_BYTES = 64 * 1024;
export const COMMIT_MESSAGE_MAX_BYTES = 16 * 1024;
export const COMMIT_FILES_MAX = 1000;
export const METADATA_MAX_BYTES = 8 * 1024;

/** JSON 列整体超限时,单个字符串值的截断上限(见 json-cap.ts)。 */
export const ARGS_FIELD_MAX_BYTES = 16 * 1024;
export const METADATA_FIELD_MAX_BYTES = 2 * 1024;
/** 摘要里各预览字段(stdout / stderr / error / response)的单字段上限。 */
export const SUMMARY_FIELD_MAX_BYTES = 2 * 1024;
/** Edit / MultiEdit 调用参数里改前、改后片段的单字段上限。 */
export const EDIT_SNIPPET_MAX_BYTES = 4 * 1024;
/** 整体超限重试时字符串上限的下限,低于它仍超限则退化为截断占位对象。 */
export const CAP_MIN_STRING_BYTES = 256;

/** 工具结果摘要的契约版本(无此字段的旧摘要按 v1 理解)。 */
export const SUMMARY_VERSION = 2;

/** Default query limit; hard ceiling on rows returned. */
export const DEFAULT_QUERY_LIMIT = 100;
export const MAX_QUERY_LIMIT = 10_000;

/** Performance budget — single hook invocation total wall-clock. */
export const PERF_BUDGET_MS = 50;
export const PERF_WARN_MS = 50;

/** Truncation marker appended to truncated string fields. */
export const TRUNCATED_SUFFIX = '... [truncated]';

/** Fixed response text when timeline is disabled via env. */
export const DISABLED_RESPONSE_TEXT = '';

/**
 * Claude Code hook 事件名 → cgraphx 隐藏子命令名。
 *
 * 唯一事实来源:installer(写 settings.json)和 cli.ts(注册实际命令)都从这里读,
 * 不会因手误不同步。
 */
export const HOOK_EVENTS_TO_COMMANDS = [
  { event: 'UserPromptSubmit', subcommand: 'timeline-user-prompt-hook' },
  { event: 'PreToolUse', subcommand: 'timeline-pre-tool-use-hook' },
  { event: 'PostToolUse', subcommand: 'timeline-post-tool-use-hook' },
  { event: 'Stop', subcommand: 'timeline-stop-hook' },
  { event: 'SessionStart', subcommand: 'timeline-session-start-hook' },
  { event: 'SessionEnd', subcommand: 'timeline-session-end-hook' },
  // 只接入有该事件的 agent;命令带容错后缀,PATH 命中旧版全局 cgraphx 时不让宿主显示报错
  {
    event: 'PostToolUseFailure',
    subcommand: 'timeline-post-tool-use-failure-hook',
    requiresCapability: 'postToolUseFailure',
    tolerateLegacyBinary: true,
  },
] as const satisfies readonly HookEventEntry[];

/** hook 名单项:requiresCapability 为 agent 描述 capabilities 的键,不具备该能力的 agent 不接入。 */
export interface HookEventEntry {
  readonly event: string;
  readonly subcommand: string;
  readonly requiresCapability?: 'postToolUseFailure';
  readonly tolerateLegacyBinary?: boolean;
}

/**
 * 新增 hook 命令的旧版容错后缀:旧版全局 cgraphx 不认识新子命令会报 unknown command
 * 并以 1 退出;加后缀后静默成功。已有 6 个 hook 的命令串保持不变,不加。
 */
export const LEGACY_BINARY_TOLERANT_SUFFIX = ' 2>/dev/null || true';

/** timeline 接入的 Claude Code hook 事件名联合(由 HOOK_EVENTS_TO_COMMANDS 推出)。 */
export type HookEventName = (typeof HOOK_EVENTS_TO_COMMANDS)[number]['event'];

export const GIT_COMMIT_SUBCOMMAND = 'timeline-git-commit-hook';

/**
 * post-commit 钩子在提交当下同步取得的 hash / 分支,经环境变量交给后台记录进程。
 * 后台进程启动有延迟,若改读当时的 HEAD,连续快速提交会只记到最后一个。
 * 用环境变量而非位置参数:旧版 cgraphx 会忽略它们并退回读 HEAD,不会因多余参数报错。
 */
export const COMMIT_SHA_ENV = 'CGRAPHX_COMMIT_SHA';
export const COMMIT_BRANCH_ENV = 'CGRAPHX_COMMIT_BRANCH';

// ─── Tool classification (timeline-data-quality feature) ───────────────────
// Defined here so the enricher hooks share one source of truth.

/**
 * Tools that mutate state and are therefore worth recording as pre_tool_use
 * (write-tools whitelist). Drives which pre events are kept — read-only tool
 * pre events are dropped to cut noise.
 *
 * Bash is included because it carries semantic signals (test/build/lint/git-write)
 * even though it does not directly modify a single file.
 */
export const WRITE_TOOLS_WHITELIST = new Set([
  'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash',
]);

/**
 * Task-management tools (subject/status/taskId are extracted from these).
 */
export const TASK_TOOLS = new Set([
  'TaskUpdate', 'TaskCreate', 'TaskGet',
]);

/**
 * File-reading tools (used to split topFiles into read vs written).
 */
export const READ_FILE_TOOLS = new Set(['Read', 'Grep', 'Glob']);

/**
 * File-writing tools. Note: distinct from WRITE_TOOLS_WHITELIST —
 * Bash is in the whitelist (carries duration/semantic value) but does not
 * directly modify a specific file, so it is excluded here.
 */
export const WRITE_FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
