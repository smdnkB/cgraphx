/**
 * 历史查询分页的游标(spec:2026-11-16-Codex历史会话补录 D9;plan C-2)。
 *
 * 游标是 base64url 编码的 UTF-8 JSON,封存首页的快照上界(最大事件 id)、库文件身份
 * (dev:ino)、已规范化的过滤条件与页大小,以及上一页最后一条事件的 (ts,id)。续页只带
 * 游标:过滤与页大小从游标原样恢复,不再收筛选参数;库文件被删或换过(dev:ino 变了)时
 * 游标作废,按参数错误要求从第一页重新查询。本文件只做编码、解码、校验与首页过滤规范化
 * (纯函数 + 一次 stat);逐页查询在 store.ts,开连接取页在 indexer.ts。
 */

import * as fs from 'node:fs';

import { DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT } from './constants';
import { resolveTimeBound } from './store';
import type { EventType, PagedQueryFilter, TimelineQueryFilter } from './types';

/** 分页游标的内容(编码前的形状;字段名即 JSON 键)。 */
export interface PageCursor {
  /** 游标格式版本(当前只有 1;不识别的版本按损坏处理) */
  v: 1;
  /** 上一页最后一条事件:续页取 (ts,id) 严格大于它的行 */
  last_ts: string;
  last_id: number;
  /** 首页读取时的最大事件 id——快照上界;续页原样沿用,轮读期间新增的事件(id 更大)不进本轮 */
  snapshot_max_id: number;
  /** 首页库文件的 `dev:ino` 身份;平台拿不到为 null(校验跳过) */
  db: string | null;
  /** 首页已规范化的过滤与页大小(续页原样恢复,保证翻页期间条件不变) */
  filter: PagedQueryFilter;
}

/** 编码:base64url(UTF-8 JSON)。只给 indexer 的分页读取发游标,别处不拼。 */
export function encodePageCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** 非负整数(事件 id、快照上界、页大小共用的类型与取值校验)。 */
function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/** string 或 null(过滤各字段共用的形状校验)。 */
function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === 'string';
}

/**
 * 解码并校验形状:任何一步不对都返回 null(= 游标损坏,由 CLI 按参数错误处理)。未知字段
 * 宽容(向前兼容),已知字段类型或取值不对即拒绝。type 只校验是字符串,不对照事件类型
 * 清单——伪造就当普通过滤条件进 SQL 等值比较,查不出行,无害。
 */
export function decodePageCursor(token: string): PageCursor | null {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  const lastTs = c.last_ts;
  const lastId = c.last_id;
  const snapshotMaxId = c.snapshot_max_id;
  const db = c.db;
  const filter = c.filter;
  if (typeof lastTs !== 'string' || lastTs === '') return null;
  if (!isNonNegativeInteger(lastId) || !isNonNegativeInteger(snapshotMaxId)) return null;
  if (!isStringOrNull(db)) return null;
  if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) return null;
  const f = filter as Record<string, unknown>;
  const since = f.since;
  const until = f.until;
  const type = f.type;
  const tool = f.tool;
  const file = f.file;
  const session = f.session;
  const turn = f.turn;
  const limit = f.limit;
  if (!isStringOrNull(since) || !isStringOrNull(until) || !isStringOrNull(type)
    || !isStringOrNull(tool) || !isStringOrNull(file) || !isStringOrNull(session)
    || !isStringOrNull(turn)) return null;
  if (!isNonNegativeInteger(limit) || limit < 1 || limit > MAX_QUERY_LIMIT) return null;
  return {
    v: 1,
    last_ts: lastTs,
    last_id: lastId,
    snapshot_max_id: snapshotMaxId,
    db,
    filter: {
      since,
      until,
      type: type as EventType | null,
      tool,
      file,
      session,
      turn,
      limit,
    },
  };
}

/**
 * 库文件的 `dev:ino` 身份;文件不在或平台不报可用 inode(Windows)为 null。约定同基础层
 * db/index.ts 的 statInode(未导出,这里按同一约定自带一份):Windows 的 st_ino 不可靠,
 * 不参与比较。
 */
export function statDbIdentity(dbPath: string): string | null {
  if (process.platform === 'win32') return null;
  try {
    const s = fs.statSync(dbPath);
    return `${s.dev}:${s.ino}`;
  } catch {
    return null;
  }
}

/** 续页校验结果:ok=false 时 reason 是带修复提示的参数错误消息。 */
export type PageCursorCheck = { ok: true; cursor: PageCursor } | { ok: false; reason: string };

/**
 * 续页前校验游标:解得开、且指向的还是首页那份库文件。库文件不在(被删)或 dev:ino 变了
 * (删后重建、换了库)→ 游标作废,要求不带 --cursor 从第一页重新查询(spec D9:参数错误,
 * 退出码 3)。首页没拿到 inode 身份(db 为 null,如 Windows)时无从比较,只做解码校验。
 */
export function checkPageCursor(token: string, dbPath: string | null): PageCursorCheck {
  const cursor = decodePageCursor(token);
  if (cursor === null) {
    return { ok: false, reason: '分页游标损坏或不识别,请不带 --cursor 从第一页重新查询' };
  }
  if (cursor.db !== null) {
    const current = dbPath === null ? null : statDbIdentity(dbPath);
    if (current === null || current !== cursor.db) {
      return { ok: false, reason: '项目数据库已删除或更换,游标失效,请不带 --cursor 从第一页重新查询' };
    }
  }
  return { ok: true, cursor };
}

/**
 * 首页过滤规范化(spec D9):时间界解析成 ISO UTC(无效输入与倒序 query 同样按无界处理,
 * 不另设更严校验),没有的过滤为 null,页大小夹到 1..MAX_QUERY_LIMIT(非数按默认页大小)。
 * 规范化结果进游标,续页原样恢复——翻页期间条件不再变。
 */
export function normalizePagedFilter(filter: TimelineQueryFilter): PagedQueryFilter {
  const rawLimit = filter.limit;
  const limit = rawLimit !== undefined && Number.isFinite(rawLimit) ? rawLimit : DEFAULT_QUERY_LIMIT;
  return {
    since: resolveTimeBound(filter.since),
    until: resolveTimeBound(filter.until),
    type: filter.type ?? null,
    tool: filter.tool ?? null,
    file: filter.file ?? null,
    session: filter.session ?? null,
    turn: filter.turn ?? null,
    limit: Math.min(Math.max(limit, 1), MAX_QUERY_LIMIT),
  };
}
