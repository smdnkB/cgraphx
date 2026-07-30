/**
 * MarkdownQuery — read-side operations for the markdown subsystem.
 *
 * Five query entry points, matching the 5 MCP tools:
 *   - listConcepts / listDomains / listTags
 *   - find (multi-dimensional filter)
 *   - getReferences (bidirectional)
 *
 * Plus one internal helper (`getDocumentDetail`) used by the CLI `show`
 * command. All methods reuse the shared DB handle; callers own the
 * connection lifecycle.
 *
 * 私有管线(候选收集 / 求交排序 / hydrate / 引用计数)已拆至同目录
 * query-helpers.ts;Layer 2 概念去重实现体拆至 query-dedup.ts —— 本文件
 * 只保留公共 API 与薄委托,公共方法行为逐字节不变(测试即契约)。
 */

import type { SqliteDatabase } from '../db';
import {
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
} from './constants';
import { normalizeName } from './dedup';
import { DocumentNotFoundError } from './errors';
import {
  collectCandidateSets,
  hydrateDescriptor,
  hydrateDescriptorFromRow,
  hydrateDetail,
  orderCandidates,
  parseJsonArray,
  referenceCountsForDocs,
  resolveDocument,
} from './query-helpers';
import { runConceptDedupCheck } from './query-dedup';
import type { MarkdownDocumentRow } from './store';
import type {
  ConceptSummary,
  DocumentDescriptor,
  DocumentDetail,
  DomainSummary,
  DedupResponse,
  FindFilter,
  FindPagedResult,
  KnowledgeStats,
  ReferenceTarget,
  ReferenceView,
  SeenNameAddResult,
  SeenNameCheckResult,
  SeenNameClearResult,
  SeenNameListResponse,
  TagSummary,
} from './types';

/** Default cap on `find` results. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export class MarkdownQuery {
  constructor(private readonly db: SqliteDatabase) {}

  // ----- vocabulary listing ----------------------------------------------

  /**
   * List all concepts with document count and domains.
   *
   * Sort modes:
   *   - 'doc-count' (default): document count DESC, then name ASC
   *   - 'name': name ASC
   *
   * Limit: when provided, cap results to the top N (after sort).
   *
   * Backward compatible: omitting both opts reproduces the legacy behavior
   * (doc_count DESC, no limit).
   *
   * Note on LIMIT: SQLite's prepared-statement `?` cannot bind to LIMIT, so
   * we interpolate the integer into the SQL string. The `Number.isInteger`
   * guard is the SQL-injection boundary — it rejects strings, NaN, and
   * non-integer numbers, so only JS numbers that are non-negative integers
   * reach the SQL. Never interpolate a raw user value.
   */
  listConcepts(opts?: { sort?: 'doc-count' | 'name'; limit?: number }): ConceptSummary[] {
    const sort = opts?.sort ?? 'doc-count';
    if (sort !== 'doc-count' && sort !== 'name') {
      throw new TypeError(
        `listConcepts: invalid sort '${sort}', expected 'doc-count' or 'name'`,
      );
    }
    const orderBy = sort === 'name' ? 'c.name ASC' : 'doc_count DESC, c.name ASC';

    let limitClause = '';
    if (opts?.limit !== undefined && opts?.limit !== null) {
      // Number.isInteger 严格校验:必须是非负整数(number 类型 + 整数 + >= 0)。
      // 这样 listConcepts({ limit: "5; DROP" as any }) 会因 typeof === 'string'
      // 被 Number.isInteger 拒绝(同样拒绝 NaN / 5.5)。
      if (!Number.isInteger(opts.limit) || opts.limit < 0) {
        throw new TypeError(
          `listConcepts: invalid limit '${opts.limit}', expected non-negative integer`,
        );
      }
      limitClause = `LIMIT ${opts.limit}`;
    }

    const rows = this.db
      .prepare(
        `SELECT c.id, c.name,
           (SELECT count(*) FROM markdown_document_concepts dc WHERE dc.concept_id = c.id) AS doc_count
         FROM markdown_concepts c
         ORDER BY ${orderBy}
         ${limitClause}`,
      )
      .all() as Array<{ id: string; name: string; doc_count: number }>;

    return rows.map(r => ({
      id: r.id,
      name: r.name,
      documentCount: r.doc_count,
      domains: this.domainsForConcept(r.id),
    }));
  }

  listDomains(): DomainSummary[] {
    const rows = this.db
      .prepare(
        `SELECT d.id, d.name,
           (SELECT count(*) FROM markdown_document_domains dd WHERE dd.domain_id = d.id) AS doc_count
         FROM markdown_domains d
         ORDER BY doc_count DESC, d.name ASC`,
      )
      .all() as Array<{ id: string; name: string; doc_count: number }>;
    return rows.map(r => ({ id: r.id, name: r.name, documentCount: r.doc_count }));
  }

  listTags(): TagSummary[] {
    const rows = this.db
      .prepare(
        `SELECT t.id, t.name,
           (SELECT count(*) FROM markdown_document_tags dt WHERE dt.tag_id = t.id) AS doc_count
         FROM markdown_tags t
         ORDER BY doc_count DESC, t.name ASC`,
      )
      .all() as Array<{ id: string; name: string; doc_count: number }>;
    return rows.map(r => ({ id: r.id, name: r.name, documentCount: r.doc_count }));
  }

  // ----- multi-dimensional find ------------------------------------------

  /**
   * Multi-dimensional find (CLI 面,行为与输出逐字节锁定)。
   *
   * 管线与 findPaged 共用:Phase 1 候选收集(collectCandidateSets)→
   * Phase 2 求交 + 排序(orderCandidates,不切片)→ 本方法 slice(0, limit)
   * 后 hydrate。默认 limit 20、上限 100;无过滤维度返回全量(按 limit);
   * 非法枚举值返回 []。
   */
  find(filter: FindFilter): DocumentDescriptor[] {
    const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    const candidateSets = collectCandidateSets(this.db, filter);
    if (candidateSets === null) return []; // 非法枚举 → 空结果

    // 与重构前一致:有 q 按相关度,无 q 按时间倒序
    const orderedIds = orderCandidates(this.db, candidateSets, {
      q: filter.q,
      sort: filter.q ? 'relevance' : 'recency',
    });

    return orderedIds
      .slice(0, limit)
      .map(id => hydrateDescriptor(this.db, id, filter.q));
  }

  /**
   * 分页版 find(web 列表页使用,spec §3.3:不静默截断、呈现匹配总数)。
   *
   * - total = 分页前匹配总数;items = 同一有序列表的 [offset, offset+limit) 切片;
   * - limit 缺省 20、钳制 [1,100](沿用 DEFAULT_LIMIT/MAX_LIMIT);
   * - offset 缺省 0,必须是非负整数,否则抛 TypeError(沿用 listConcepts 的
   *   Number.isInteger 注入边界模式);
   * - sort 缺省 = 有 q 按相关度、无 q 按时间倒序;'title' = title ASC,
   *   并列 updated DESC;显式 'relevance' 但无 q 时降级为 recency;
   * - 当页条目额外填充 referencesCount / owners / aliases(find() 不填)。
   */
  findPaged(
    filter: FindFilter,
    opts?: { offset?: number; limit?: number; sort?: 'recency' | 'relevance' | 'title' },
  ): FindPagedResult {
    const offset = opts?.offset ?? 0;
    // Number.isInteger 是注入边界:拒绝字符串 / NaN / 非整数 / 负数,
    // 与 listConcepts 的 LIMIT 守卫同一模式。
    if (!Number.isInteger(offset) || offset < 0) {
      throw new TypeError(
        `findPaged: invalid offset '${offset}', expected non-negative integer`,
      );
    }
    const limit = Math.min(Math.max(opts?.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    const candidateSets = collectCandidateSets(this.db, filter);
    if (candidateSets === null) return { total: 0, items: [] }; // 非法枚举 → 空结果

    const sort = opts?.sort ?? (filter.q ? 'relevance' : 'recency');
    const orderedIds = orderCandidates(this.db, candidateSets, { q: filter.q, sort });
    const pageIds = orderedIds.slice(offset, offset + limit);

    // 当页引用计数:一条 IN 聚合查询(出向 + 入向),非 N+1
    const refCounts = referenceCountsForDocs(this.db, pageIds);

    const items = pageIds.map(id => {
      const doc = this.db
        .prepare('SELECT * FROM markdown_documents WHERE id = ?')
        .get(id) as MarkdownDocumentRow;
      return {
        ...hydrateDescriptorFromRow(this.db, doc, filter.q),
        referencesCount: refCounts.get(id) ?? 0,
        // owners/aliases 从同行 JSON 列解析(沿用 hydrateDetail 的
        // parseJsonArray 模式,零额外查询)
        owners: parseJsonArray(doc.owners),
        aliases: parseJsonArray(doc.aliases),
      };
    });

    return { total: orderedIds.length, items };
  }

  /**
   * 知识库统计条(web 总览页头部)。
   *
   * byType / byStatus 的 Record 由枚举常量全键初始化为 0,再用
   * GROUP BY 结果覆写 —— 未出现的类型/状态保证键在、计数 0。
   */
  getStats(): KnowledgeStats {
    const countOf = (table: string): number =>
      (this.db.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c;

    const latest = this.db
      .prepare('SELECT max(indexed_at) AS m FROM markdown_documents')
      .get() as { m: number | null };

    const byType = Object.fromEntries(
      DOCUMENT_TYPES.map(t => [t, 0]),
    ) as KnowledgeStats['byType'];
    const typeRows = this.db
      .prepare(
        'SELECT document_type AS t, count(*) AS c FROM markdown_documents GROUP BY document_type',
      )
      .all() as Array<{ t: string; c: number }>;
    for (const r of typeRows) {
      if ((DOCUMENT_TYPES as readonly string[]).includes(r.t)) {
        byType[r.t as keyof KnowledgeStats['byType']] = r.c;
      }
    }

    const byStatus = Object.fromEntries(
      DOCUMENT_STATUSES.map(s => [s, 0]),
    ) as KnowledgeStats['byStatus'];
    const statusRows = this.db
      .prepare(
        'SELECT status AS s, count(*) AS c FROM markdown_documents GROUP BY status',
      )
      .all() as Array<{ s: string; c: number }>;
    for (const r of statusRows) {
      if ((DOCUMENT_STATUSES as readonly string[]).includes(r.s)) {
        byStatus[r.s as keyof KnowledgeStats['byStatus']] = r.c;
      }
    }

    return {
      documentCount: countOf('markdown_documents'),
      conceptCount: countOf('markdown_concepts'),
      domainCount: countOf('markdown_domains'),
      tagCount: countOf('markdown_tags'),
      latestIndexedAt: latest.m ?? null,
      byType,
      byStatus,
    };
  }

  // ----- references ------------------------------------------------------

  getReferences(docIdOrPath: string): ReferenceView {
    const doc = resolveDocument(this.db, docIdOrPath);
    if (!doc) throw new DocumentNotFoundError(docIdOrPath);

    const outgoing = this.db
      .prepare(
        `SELECT d.id, d.title, d.path
         FROM markdown_document_references r
         JOIN markdown_documents d ON d.id = r.target_document_id
         WHERE r.source_document_id = ?
         ORDER BY d.title ASC`,
      )
      .all(doc.id) as Array<ReferenceTarget>;

    const incoming = this.db
      .prepare(
        `SELECT d.id, d.title, d.path
         FROM markdown_document_references r
         JOIN markdown_documents d ON d.id = r.source_document_id
         WHERE r.target_document_id = ?
         ORDER BY d.title ASC`,
      )
      .all(doc.id) as Array<ReferenceTarget>;

    return {
      documentId: doc.id,
      documentTitle: doc.title,
      documentPath: doc.path,
      outgoing,
      incoming,
    };
  }

  /** Internal — used by `cgraphx docs show` CLI command. */
  getDocumentDetail(docIdOrPath: string): DocumentDetail | null {
    const doc = resolveDocument(this.db, docIdOrPath);
    if (!doc) return null;
    return hydrateDetail(this.db, doc);
  }

  // ----- seen-names (Layer 1 entry name dedup) --------------------------

  /**
   * Persist entry-point names as "already explored" (idempotent).
   *
   * Each name is normalized; an empty normalized form is dropped silently
   * (consistent with checkConceptDedup's warnings but the Layer 1 contract
   * here is fire-and-forget — callers are the agent itself, not a UI surfacing
   * warnings). The original spelling is preserved in `original_name` so
   * `listSeenNames` can show it.
   *
   * Idempotency is enforced by the UNIQUE constraint on `normalized_name` +
   * `INSERT OR IGNORE`. The per-row `changes()` value distinguishes a real
   * insert (1) from a skipped duplicate (0).
   */
  addSeenNames(names: string[]): SeenNameAddResult {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO markdown_explored_entry_names
         (normalized_name, original_name, added_at) VALUES (?, ?, ?)`,
    );
    const now = Date.now();

    const added: string[] = [];
    const skipped: string[] = [];
    for (const name of names) {
      const normalized = normalizeName(name);
      if (normalized.length === 0) continue; // empty normalized → skip
      const res = insert.run(normalized, name, now);
      if (res.changes > 0) {
        added.push(normalized);
      } else {
        skipped.push(normalized);
      }
    }

    const totalRow = this.db
      .prepare('SELECT count(*) AS c FROM markdown_explored_entry_names')
      .get() as { c: number };

    return {
      added,
      skipped_already_present: skipped,
      total_seen: totalRow.c,
    };
  }

  /**
   * Check whether candidate names have been seen.
   *
   * Single IN-clause query loads all matching normalized names; the rest is
   * a Set lookup in TS. Empty normalized forms are reported with `is_seen: false`
   * (we never persist them, so they can never be "seen").
   */
  checkSeenNames(names: string[]): SeenNameCheckResult {
    const candidates = names.map(name => ({ name, normalized: normalizeName(name) }));
    const nonEmpty = candidates.filter(c => c.normalized.length > 0);

    const seenSet = new Set<string>();
    if (nonEmpty.length > 0) {
      const placeholders = nonEmpty.map(() => '?').join(',');
      const rows = this.db
        .prepare(
          `SELECT normalized_name FROM markdown_explored_entry_names
           WHERE normalized_name IN (${placeholders})`,
        )
        .all(...nonEmpty.map(c => c.normalized)) as Array<{ normalized_name: string }>;
      for (const r of rows) seenSet.add(r.normalized_name);
    }

    return {
      results: candidates.map(c => ({
        name: c.name,
        normalized: c.normalized,
        is_seen: seenSet.has(c.normalized),
      })),
    };
  }

  /**
   * List all seen entry names (newest first). Used for debugging / inspection.
   */
  listSeenNames(): SeenNameListResponse {
    const rows = this.db
      .prepare(
        `SELECT normalized_name, original_name, added_at
         FROM markdown_explored_entry_names
         ORDER BY added_at DESC, id DESC`,
      )
      .all() as Array<{ normalized_name: string; original_name: string; added_at: number }>;

    return {
      names: rows.map(r => ({
        original: r.original_name,
        normalized: r.normalized_name,
        added_at: r.added_at,
      })),
      total: rows.length,
    };
  }

  /**
   * Delete every seen-name row for this project. Returns the count removed.
   */
  clearSeenNames(): SeenNameClearResult {
    const res = this.db
      .prepare('DELETE FROM markdown_explored_entry_names')
      .run();
    return { removed: res.changes };
  }

  // ----- concept dedup (Layer 2) ----------------------------------------

  /**
   * Check candidate names against the indexed vocabulary.
   * 实现体见 query-dedup.ts 的 runConceptDedupCheck(整体搬出,行为不变)。
   */
  checkConceptDedup(names: string[]): DedupResponse {
    return runConceptDedupCheck(this.db, names);
  }

  // ----- helpers ---------------------------------------------------------

  /** Domains of any document that contains this concept, deduped. */
  private domainsForConcept(conceptId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT d.name
         FROM markdown_document_domains dd
         JOIN markdown_domains d ON d.id = dd.domain_id
         WHERE dd.document_id IN (
           SELECT document_id FROM markdown_document_concepts WHERE concept_id = ?
         )
         ORDER BY d.name ASC`,
      )
      .all(conceptId) as Array<{ name: string }>;
    return rows.map(r => r.name);
  }
}

/**
 * Resolve a user-supplied "doc id or path" to a document ID without
 * instantiating a query object. Used by the CLI to surface a friendly
 * "not found" without leaking exceptions.
 */
export function isLikelyDocumentId(s: string): boolean {
  return /^[a-f0-9]{64}$/.test(s);
}
