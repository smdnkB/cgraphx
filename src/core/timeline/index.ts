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
  getMostRecentPre,
  getSessionStats,
  resolveTimeBound,
} from './indexer';
// 项目在本机出现过的根、按目录的汇总、受影响的根下的事件数(spec D10、D11、D19、D32、D33)
export { listTimelineRoots, readTimelineSummary, countEventsUnderRoots } from './roots';
export type { TimelineRoot, TimelineDataSummary } from './types';
// 并旧事件(spec D27、D28、D29):project 子系统编排,经 EventIdMapping 换算 id
export { createTimelineMerger, maxTimelineEventId } from './merge';
export type { EventIdMapping, TimelineMergeStats, TimelineMerger } from './types';
export { ensureTimelineSchema } from './schema-bootstrap';
export { TURNS_DIRNAME } from './turn-state';
export { installTimelineHooks, uninstallTimelineHooks } from './installer';
// 查询前补录(spec F1,plan C-4):会话文件解析进项目库 + 人读提示渲染;开关独立成 kill-switch.ts
export { ensureTimelineUpToDate, describeSyncOutcome } from './ingest/ingest';
export type { TimelineSyncOutcome, TimelineSyncStatus } from './ingest/ingest';
export { isKillSwitchOn } from './kill-switch';
export { LEGACY_BINARY_TOLERANT_SUFFIX } from './constants';
export { describeEvent } from './describe';
export type {
  EventType,
  TimelineEvent,
  TimelineEventInput,
  TimelineQueryFilter,
  TimelineStats,
  StatsGroupBy,
} from './types';
export {
  TimelineError,
  HookPayloadError,
  TimelineSchemaError,
  StoreInsertError,
  StoreQueryError,
} from './errors';
