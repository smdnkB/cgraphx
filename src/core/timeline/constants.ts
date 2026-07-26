/**
 * Constants for the Developer Timeline subsystem.
 *
 * Spec §2.3 — field size caps; §3.1 — kill-switch.
 */

/** Kill-switch env var: any non-empty value (except '0'/'false') disables timeline. */
export const NO_TIMELINE_ENV = 'CGRAPHX_NO_TIMELINE';

/** Schema version (independent timeline_schema_versions table). */
export const TIMELINE_SCHEMA_VERSION = 1;

/** Field size caps (spec §2.3). */
export const ARGS_MAX_BYTES = 64 * 1024;
export const RESULT_SUMMARY_MAX_BYTES = 4 * 1024;
export const PROMPT_MAX_BYTES = 64 * 1024;
export const COMMIT_MESSAGE_MAX_BYTES = 16 * 1024;
export const COMMIT_FILES_MAX = 1000;
export const METADATA_MAX_BYTES = 8 * 1024;

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
 * Claude Code hook event name → cgraphx hidden subcommand name.
 *
 * Single source of truth — installer (writes settings.json) and cli.ts
 * (registers the actual commands) both read from here, so a typo can't
 * desync them.
 */
export const HOOK_EVENTS_TO_COMMANDS: ReadonlyArray<{ event: string; subcommand: string }> = [
  { event: 'UserPromptSubmit', subcommand: 'timeline-user-prompt-hook' },
  { event: 'PreToolUse', subcommand: 'timeline-pre-tool-use-hook' },
  { event: 'PostToolUse', subcommand: 'timeline-post-tool-use-hook' },
  { event: 'Stop', subcommand: 'timeline-stop-hook' },
];

export const GIT_COMMIT_SUBCOMMAND = 'timeline-git-commit-hook';

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
