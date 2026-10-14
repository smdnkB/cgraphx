/**
 * Public facade for the timeline subsystem.
 *
 * External callers (CLI) use this module — never reach into store/hooks
 * internals. Spec §1.2.
 */

export { recordEvent, type EventEnricher } from './recorder';
export { queryEvents, getEventById, getEventStats, getMostRecentPre, getSessionStats, resolveTimeBound } from './indexer';
export { installTimelineHooks, uninstallTimelineHooks } from './installer';
export { isKillSwitchOn } from './hook-runner';
export { CLAUDE_SESSION_ID_ENV } from './constants';
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
