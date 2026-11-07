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

/** Truncation marker appended to truncated string fields. */
export const TRUNCATED_SUFFIX = '... [truncated]';

/** Fixed response text when timeline is disabled via env. */
export const DISABLED_RESPONSE_TEXT = '';

/**
 * git post-commit / post-merge 片段调起的隐藏子命令(agent hook 时代的 7 条采集子命令已随
 * 会话文件解析替代 hooks 撤掉,见 spec:2026-11-06-会话文件解析替代hooks D17、D19)。
 */
export const GIT_COMMIT_SUBCOMMAND = 'timeline-git-commit-hook';

/**
 * post-commit 钩子在提交当下同步取得的 hash / 分支,经环境变量交给后台记录进程。
 * 后台进程启动有延迟,若改读当时的 HEAD,连续快速提交会只记到最后一个。
 * 用环境变量而非位置参数:旧版 cgraphx 会忽略它们并退回读 HEAD,不会因多余参数报错。
 */
export const COMMIT_SHA_ENV = 'CGRAPHX_COMMIT_SHA';
export const COMMIT_BRANCH_ENV = 'CGRAPHX_COMMIT_BRANCH';

/**
 * 调起记录进程的 git 钩子,经环境变量交给 `timeline-git-commit-hook`:post-merge 片段传
 * `post-merge`;没有这个变量即视为 post-commit。post-merge 遇到快进不记(快进不产生新提交)。
 */
export const COMMIT_HOOK_ENV = 'CGRAPHX_GIT_HOOK';

/**
 * post-merge 片段在合并当下同步取得的 HEAD reflog 最新一行(和提交号同一条 `git log -g -1` 取),
 * 记录进程据它判断快进(spec D32);后台进程启动时用户可能已经又提交了一笔,不能等那时再读。
 */
export const COMMIT_REFLOG_ENV = 'CGRAPHX_COMMIT_REFLOG';

/**
 * post-commit / post-merge 片段在前台取好、经环境变量传给后台记录进程的三样门禁上下文(plan C-11):
 * 门禁记号的内容(commit-msg 门禁只要没打回就写的 `git write-tree` 输出,前台读出即删——后台自己读时
 * 连续快速提交的记号已被下一笔覆盖)与 cherry-pick / rebase 是否在进行。记录进程据此判这笔提交是否
 * 跳过了门禁(K16);post-merge 记的合并提交不判,变量照传无害。
 */
export const GATE_TREE_ENV = 'CGRAPHX_GATE_TREE';
export const CHERRY_PICK_ENV = 'CGRAPHX_CHERRY_PICK';
export const REBASE_ENV = 'CGRAPHX_REBASE';

// ─── Tool classification (timeline-data-quality feature) ───────────────────

/**
 * File-reading tools (used to split topFiles into read vs written).
 */
export const READ_FILE_TOOLS = new Set(['Read', 'Grep', 'Glob']);

/**
 * File-writing tools (used to split topFiles into read vs written).
 */
export const WRITE_FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/**
 * 看板只读查询取的工具事件(2026-11-06-agent看板 K9④ 写类 + K10 Read + K9⑤ Skill;Bash 不取,
 * K11 天然成立):从 WRITE_FILE_TOOLS 派生,单一定义——board-read 的 SQL IN 列表与 board/match
 * 的写类判定都从这份来,改一处不会漏另一处。
 */
export const BOARD_TOOL_NAMES: readonly string[] = [...WRITE_FILE_TOOLS, 'Read', 'Skill'];
