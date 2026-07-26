/**
 * recordEvent — open the timeline DB and insert one event.
 *
 * This is the function hooks call; it owns the connection lifecycle.
 * On any failure (project not initialized, schema error, DB error) it
 * throws — the hook runner catches and writes stderr + exit 0.
 *
 * B-2 (timeline-data-quality): added an optional `enricher` callback.
 * The enricher runs inside recordEvent, after the store is opened but
 * BEFORE the event is inserted. It receives the live store instance so
 * it can query prior events (e.g. look up the most-recent pre_tool_use
 * to compute duration_ms for a post_tool_use event). The enricher may
 * return a new event object, mutate the event in place, or return void /
 * undefined — in the latter two cases recordEvent falls back to the
 * original event.
 *
 * The enricher is a generic extension point: future enrich-side needs
 * (B-6's stop-event session aggregation, etc.) reuse this same parameter
 * without re-signing recordEvent. Enricher exceptions are NOT caught
 * here — the caller (hook-runner's try/catch) is responsible, so a
 * broken enricher degrades gracefully to "post event still recorded,
 * enriched field null" rather than blocking the hook.
 */

import { openTimelineDb } from './schema-bootstrap';
import { TimelineStore } from './store';
import type { TimelineEventInput } from './types';

/**
 * Enrichment callback invoked inside recordEvent before insert.
 *
 * @param store   Live TimelineStore backed by the just-opened connection.
 * @param event   The original event the caller passed. May be mutated in
 *                place; if a new object is returned, it replaces the event.
 * @returns       The enriched event, OR undefined/void to keep the original.
 */
export type EventEnricher = (
  store: TimelineStore,
  event: TimelineEventInput,
) => TimelineEventInput | void;

export async function recordEvent(
  projectRoot: string,
  event: TimelineEventInput,
  enricher?: EventEnricher,
): Promise<number> {
  const connection = openTimelineDb(projectRoot);
  try {
    const store = new TimelineStore(connection.getDb());
    // Apply enricher if present. `enricher(...) ?? event` covers both
    // "returned undefined" and "returned void" — fall back to the original.
    const enriched = enricher ? (enricher(store, event) ?? event) : event;
    return store.insert(enriched);
  } finally {
    connection.close();
  }
}
