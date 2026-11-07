/**
 * board 子系统常量(2026-11-06-agent看板)。
 *
 * 阈值、路径段、K1 文件名正则、K9/K10 依据文案、C-13 提示映射都钉在这里——口径改了只动一处。
 */

import type { TimelineSyncStatus } from '../timeline';

/** K2:最近活动在多少毫秒内进默认列表,其余进 older。 */
export const TASK_ACTIVE_WINDOW_MS = 30 * 24 * 3600_000;

/** K3:未归类会话的最少 user_prompt 条数。 */
export const UNMATCHED_MIN_PROMPTS = 5;

/** K5:标题兜底(第一条 user_prompt)取前多少个字。 */
export const TITLE_FALLBACK_CHARS = 40;

/** K10:按标题认「消息提到需求名」时标题至少多少个字。 */
export const TITLE_MENTION_MIN_CHARS = 4;

/** 需求目录的仓库内路径段(K9③④⑥、K10 的路径前缀都基于它)。 */
export const DOCS_FEATURES_DIR = 'docs/features';

/** `docs/features/<featureId>/`:路径含它即算命中这个需求(标题、路径一律原文比较)。 */
export function featureDirPrefix(featureId: string): string {
  return `${DOCS_FEATURES_DIR}/${featureId}/`;
}

/** K1:需求目录顶层算任务的讨论稿文件(`订单导出-功能方案-v1.md`)。 */
export const PLAN_DISCUSSION_FILE_PATTERN = /-功能方案-v[^/]*\.md$/;

/** K1:需求目录顶层算任务的 spec 文件(`spec.md`、`订单导出-spec.md`)。 */
export const SPEC_FILE_PATTERN = /(^|-)spec\.md$/;

/** K9⑤:流程命令的形状(`/dev-merge 订单导出`),捕获组是命令参数。 */
export const FLOW_COMMAND_PATTERN = /^\/[a-z][\w-]*\s+(.+)/;

// ─── K9 / K10 依据文案(页面用「、」连接)───────────────────────────────────

export const REASON_REPLICA_CWD = '开始目录在副本';
export const REASON_COMMIT_BRANCH = '提交在需求分支';
export const REASON_COMMIT_FILES = '提交改了需求目录';
export const REASON_WROTE_FEATURE = '写需求目录';
export const REASON_FLOW_COMMAND = '流程命令';
export const REASON_PROMPT_PATH = '消息里有需求路径';
export const REASON_READ_FEATURE = '读过需求目录';
export const REASON_PROMPT_TITLE = '消息提到需求名';

// ─── 提示文案 ────────────────────────────────────────────────────────────────

/** F1 ⑤:项目的目录都不在——列不出任务,这个项目只剩未归类。 */
export const NOTICE_DIRS_GONE = '目录已不在,列不出任务';

/**
 * F1 ④ / plan C-13:补录状态 → 项目提示。board 单写这一份映射,不动 describeSyncOutcome
 * (那份是查询命令的人读提示,文案与 skipped-disabled 返回空的口径都不同)。synced/rebuilt → null。
 */
export const SYNC_NOTICE_BY_STATUS: Readonly<Record<TimelineSyncStatus, string | null>> = {
  busy: '正在补录,可能缺最新的会话',
  'skipped-legacy': '这个目录还没跑新版 cgraphx install,没有补录',
  'skipped-disabled': 'CGRAPHX_NO_TIMELINE 开着,没有补录',
  failed: '补录失败,可能缺最新的会话',
  synced: null,
  rebuilt: null,
};
