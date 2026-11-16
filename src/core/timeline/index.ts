/**
 * Public facade for the timeline subsystem.
 *
 * External callers (CLI) use this module — never reach into store/hooks
 * internals. Spec §1.2.
 */

export { recordEvent, type EventEnricher } from './recorder';
export {
  queryEvents,
  getEventById,
  getEventStats,
  getSessionStats,
  resolveTimeBound,
  // 历史查询分页(spec:2026-11-16-Codex历史会话补录 D9):首页 + 续页,输出 {events,next_cursor}
  queryEventsFirstPage,
  queryEventsNextPage,
} from './indexer';
// 项目在本机出现过的根、按目录的汇总、受影响的根下的事件数(spec D10、D11、D19、D32、D33)
export { listTimelineRoots, readTimelineSummary, countEventsUnderRoots } from './roots';
export type { TimelineRoot, TimelineDataSummary } from './types';
// 会话标题(2026-11-06-agent看板 D8):项目库 timeline_session_titles 的按目录只读读取(看板用)
export { readSessionTitlesInDataDir } from './store';
export type { SessionTitle, SessionTitleKind } from './store';
// 看板只读查询(2026-11-06-agent看板 D14;plan C-5):认任务要用的最小列集合,按 dataDir 只读打开
export { readTimelineBoardData } from './board-read';
export type {
  BoardTimelineData,
  BoardSessionHead,
  BoardPrompt,
  BoardCommit,
  BoardToolEvent,
} from './types';
// 并旧数据(spec D27、D28;D20 后只并提交记录与 timeline_roots):project 子系统编排
export { createTimelineMerger, maxTimelineEventId } from './merge';
export type { TimelineMergeStats, TimelineMerger } from './types';
export { ensureTimelineSchema } from './schema-bootstrap';
export { installTimelineHooks, uninstallTimelineHooks } from './installer';
// 查询前补录(spec F1,plan C-4;覆盖判定 D4 是 T-1 加的可选字段):会话文件解析进项目库 + 人读提示渲染;开关独立成 kill-switch.ts
export { ensureTimelineUpToDate, describeSyncOutcome } from './ingest/ingest';
export type { TimelineSyncOutcome, TimelineSyncStatus, TimelineCoverage } from './ingest/ingest';
export { isKillSwitchOn } from './kill-switch';
export { claudeSessionAdapter } from './ingest/claude-adapter';
export { sessionAdapterFor } from './ingest/adapters';
export type { SessionFact } from './ingest/types';
// 工具名单源(看板查询与认任务共用,2026-11-06-agent看板):写类工具 + 看板取的工具列表
export { BOARD_TOOL_NAMES, WRITE_FILE_TOOLS } from './constants';
export { describeEvent } from './describe';
export type {
  EventType,
  TimelineEvent,
  TimelineEventInput,
  TimelineQueryFilter,
  TimelineStats,
  StatsGroupBy,
  // 历史查询分页(spec D9)
  TimelinePagePosition,
  PagedQueryFilter,
  TimelinePagedResult,
} from './types';
export {
  TimelineError,
  HookPayloadError,
  TimelineSchemaError,
  StoreInsertError,
  StoreQueryError,
} from './errors';
