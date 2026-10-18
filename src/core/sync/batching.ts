/**
 * 上报分块与装箱(从 runner 原样移入,行为不变)。
 *
 * 会话按事件数切块,其余字段只放最后一块;再按会话数 / 事件数 / 字节数装箱,保持块顺序。
 */

import { BATCH_MAX_BYTES, BATCH_MAX_EVENTS, BATCH_MAX_SESSIONS, CLIENT_NAME } from './constants';
import type { BuiltSession, SyncContext } from './payload';
import type { IngestSession } from './types';

/** 一个会话的一块:非最后块只含事件;最后块带 bindings / commits / artifacts / references。 */
export interface Chunk {
  session: IngestSession;
  built: BuiltSession;
  isLast: boolean;
  recordCount: number;
  bytes: number;
}

function makeChunk(built: BuiltSession, session: IngestSession, isLast: boolean): Chunk {
  const recordCount =
    session.events.length +
    session.bindings.length +
    session.commits.length +
    session.artifacts.length +
    session.references.length;
  return { session, built, isLast, recordCount, bytes: Buffer.byteLength(JSON.stringify(session), 'utf-8') };
}

/** 把会话的事件切成 ≤ BATCH_MAX_EVENTS 的块;其余字段只放最后一块。 */
export function chunkSession(built: BuiltSession, maxEvents: number): Chunk[] {
  const s = built.session;
  const chunks: Chunk[] = [];
  let start = 0;
  while (s.events.length - start > maxEvents) {
    const events = s.events.slice(start, start + maxEvents);
    chunks.push(
      makeChunk(built, { clientSessionId: s.clientSessionId, events, bindings: [], commits: [], artifacts: [], references: [] }, false),
    );
    start += maxEvents;
  }
  chunks.push(makeChunk(built, { ...s, events: s.events.slice(start) }, true));
  return chunks;
}

/** 单块事件对半切(413 后重发用);事件 < 2 条返回 null。 */
export function splitChunkEvents(chunk: Chunk): [Chunk, Chunk] | null {
  const s = chunk.session;
  if (s.events.length < 2) return null;
  const mid = Math.ceil(s.events.length / 2);
  const head = makeChunk(
    chunk.built,
    { clientSessionId: s.clientSessionId, events: s.events.slice(0, mid), bindings: [], commits: [], artifacts: [], references: [] },
    false,
  );
  const tail = makeChunk(chunk.built, { ...s, events: s.events.slice(mid) }, chunk.isLast);
  return [head, tail];
}

/** 请求信封(不含 sessions)的近似字节数。 */
export function envelopeBytes(ctx: SyncContext): number {
  return Buffer.byteLength(
    JSON.stringify({
      remoteUrl: ctx.remoteUrl,
      clientName: CLIENT_NAME,
      clientVersion: ctx.clientVersion,
      backlog: Number.MAX_SAFE_INTEGER,
      sessions: [],
    }),
    'utf-8',
  );
}

/** 按会话数 / 事件数 / 字节数装箱,保持块顺序(同会话的块先后不变)。 */
export function packBatches(chunks: Chunk[], baseBytes: number): Chunk[][] {
  const batches: Chunk[][] = [];
  let current: Chunk[] = [];
  let events = 0;
  let bytes = baseBytes;
  for (const chunk of chunks) {
    const n = chunk.session.events.length;
    const fits =
      current.length < BATCH_MAX_SESSIONS &&
      events + n <= BATCH_MAX_EVENTS &&
      bytes + chunk.bytes + 1 <= BATCH_MAX_BYTES;
    if (!fits && current.length > 0) {
      batches.push(current);
      current = [];
      events = 0;
      bytes = baseBytes;
    }
    current.push(chunk);
    events += n;
    bytes += chunk.bytes + 1;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** 按会话分组(保持首次出现顺序)。 */
export function groupBySession(chunks: Chunk[]): Chunk[][] {
  const groups = new Map<string, Chunk[]>();
  for (const chunk of chunks) {
    const id = chunk.session.clientSessionId;
    const list = groups.get(id);
    if (list === undefined) groups.set(id, [chunk]);
    else list.push(chunk);
  }
  return [...groups.values()];
}
