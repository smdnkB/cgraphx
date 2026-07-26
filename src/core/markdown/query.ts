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
 */

import type { SqliteDatabase } from '../db';
import {
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
} from './constants';
import { normalizeName } from './dedup';
import { DocumentNotFoundError } from './errors';
import type { MarkdownDocumentRow } from './store';
import type {
  ConceptSummary,
  DedupCheckResult,
  DedupResponse,
  DocumentDescriptor,
  DocumentDetail,
  DomainSummary,
  FindFilter,
  ReferenceTarget,
  ReferenceView,
  SeenNameAddResult,
  SeenNameCheckResult,
  SeenNameClearResult,
  SeenNameListResponse,
  TagSummary,
} from './types';

const STATUS_SET = new Set<string>(DOCUMENT_STATUSES);
const TYPE_SET = new Set<string>(DOCUMENT_TYPES);

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

  find(filter: FindFilter): DocumentDescriptor[] {
    const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    // Phase 1: collect candidate document IDs from each filter dimension
    const candidateSets: string[][] = [];

    if (filter.concept) {
      candidateSets.push(this.docIdsForVocab(filter.concept, 'concept_id', 'markdown_document_concepts'));
    }
    if (filter.domain) {
      candidateSets.push(this.docIdsForVocab(filter.domain, 'domain_id', 'markdown_document_domains'));
    }
    if (filter.tag) {
      candidateSets.push(this.docIdsForVocab(filter.tag, 'tag_id', 'markdown_document_tags'));
    }
    if (filter.status) {
      if (!STATUS_SET.has(filter.status)) {
        return []; // invalid enum → empty
      }
      const rows = this.db
        .prepare('SELECT id FROM markdown_documents WHERE status = ?')
        .all(filter.status) as Array<{ id: string }>;
      candidateSets.push(rows.map(r => r.id));
    }
    if (filter.documentType) {
      if (!TYPE_SET.has(filter.documentType)) {
        return [];
      }
      const rows = this.db
        .prepare('SELECT id FROM markdown_documents WHERE document_type = ?')
        .all(filter.documentType) as Array<{ id: string }>;
      candidateSets.push(rows.map(r => r.id));
    }
    if (filter.q) {
      const like = `%${filter.q.replace(/[%_]/g, m => '\\' + m)}%`;
      const rows = this.db
        .prepare(
          `SELECT id FROM markdown_documents
           WHERE title LIKE ? ESCAPE '\\' OR summary_text LIKE ? ESCAPE '\\'`,
        )
        .all(like, like) as Array<{ id: string }>;
      candidateSets.push(rows.map(r => r.id));
    }

    // Phase 2: intersect (AND)
    let finalIds: string[];
    if (candidateSets.length === 0) {
      // No filter → return all (with limit)
      const rows = this.db
        .prepare(
          `SELECT id FROM markdown_documents
           ORDER BY (updated IS NULL), updated DESC, title ASC
           LIMIT ?`,
        )
        .all(limit) as Array<{ id: string }>;
      finalIds = rows.map(r => r.id);
    } else {
      candidateSets.sort((a, b) => a.length - b.length); // start from smallest
      let acc = new Set(candidateSets[0]!);
      for (let i = 1; i < candidateSets.length; i++) {
        const next = new Set(candidateSets[i]!);
        acc = new Set([...acc].filter(x => next.has(x)));
      }
      finalIds = [...acc];
      // Sort: with q, by relevance (title match > summary match > none); else by recency
      if (filter.q) {
        finalIds = this.sortByRelevance(finalIds, filter.q);
      } else {
        finalIds = this.sortByRecency(finalIds);
      }
      finalIds = finalIds.slice(0, limit);
    }

    // Phase 3: hydrate descriptors
    return finalIds.map(id => this.hydrateDescriptor(id, filter.q));
  }

  // ----- references ------------------------------------------------------

  getReferences(docIdOrPath: string): ReferenceView {
    const doc = this.resolveDocument(docIdOrPath);
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
    const doc = this.resolveDocument(docIdOrPath);
    if (!doc) return null;
    return this.hydrateDetail(doc);
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
   *
   * Two match modes, exact first:
   *   - exact: normalize(candidate) === normalize(concept.name)
   *   - alias: normalize(candidate) === normalize(document.aliases[i])
   *     (matched_concept is then the document's primary concept name,
   *      resolved through markdown_document_concepts)
   *
   * All concepts + all document aliases are pulled in two batch queries
   * (no per-candidate SQL, no SQLite JSON1 — aliases are JSON.parse'd in TS).
   */
  checkConceptDedup(names: string[]): DedupResponse {
    const warnings: string[] = [];
    const results: DedupCheckResult[] = [];

    // Phase 1: normalize candidates, filtering empty normalized forms to warnings.
    const candidates: Array<{ original: string; normalized: string }> = [];
    for (const name of names) {
      const normalized = normalizeName(name);
      if (normalized.length === 0) {
        warnings.push(`empty normalized form: '${name}'`);
        continue;
      }
      candidates.push({ original: name, normalized });
    }

    // Phase 2: batch-load all concepts → Map<normalized_name, concept_name>
    const conceptRows = this.db
      .prepare('SELECT name FROM markdown_concepts')
      .all() as Array<{ name: string }>;
    const exactIndex = new Map<string, string>(); // normalized → concept.name
    for (const r of conceptRows) {
      const n = normalizeName(r.name);
      if (n.length === 0) continue; // skip degenerate concept names already in DB
      // First-write-wins on collision (deterministic by row order)
      if (!exactIndex.has(n)) exactIndex.set(n, r.name);
    }

    // Phase 3: batch-load all (document_id, aliases) pairs with non-empty aliases,
    // JSON.parse in TS, and build:
    //   aliasIndex: Map<normalized_alias, { originalAlias, docId }>
    //   primaryConceptByDoc: Map<doc_id, concept_name>  (joined via doc_concepts)
    const docAliasRows = this.db
      .prepare(
        `SELECT id, aliases FROM markdown_documents WHERE aliases != '[]'`,
      )
      .all() as Array<{ id: string; aliases: string }>;

    const aliasIndex = new Map<
      string,
      { originalAlias: string; docId: string }
    >();
    const docIdsWithAliases = new Set<string>();
    for (const r of docAliasRows) {
      let aliases: string[] = [];
      try {
        const parsed = JSON.parse(r.aliases);
        if (Array.isArray(parsed)) {
          aliases = parsed.filter((x): x is string => typeof x === 'string');
        }
      } catch {
        continue; // malformed aliases JSON — skip this doc
      }
      if (aliases.length === 0) continue;
      docIdsWithAliases.add(r.id);
      for (const alias of aliases) {
        const n = normalizeName(alias);
        if (n.length === 0) continue;
        // First-write-wins on collision (deterministic by row order)
        if (!aliasIndex.has(n)) {
          aliasIndex.set(n, { originalAlias: alias, docId: r.id });
        }
      }
    }

    // Resolve primary concept name for every doc that contributed an alias.
    // One batched IN-clause query, then take the first concept per doc.
    const primaryConceptByDoc = new Map<string, string>();
    if (docIdsWithAliases.size > 0) {
      const docIds = [...docIdsWithAliases];
      const placeholders = docIds.map(() => '?').join(',');
      const rows = this.db
        .prepare(
          `SELECT dc.document_id, c.name
           FROM markdown_document_concepts dc
           JOIN markdown_concepts c ON c.id = dc.concept_id
           WHERE dc.document_id IN (${placeholders})
           ORDER BY dc.document_id ASC, c.name ASC`,
        )
        .all(...docIds) as Array<{ document_id: string; name: string }>;
      for (const r of rows) {
        // First-write-wins preserves "first concept alphabetically" per doc
        if (!primaryConceptByDoc.has(r.document_id)) {
          primaryConceptByDoc.set(r.document_id, r.name);
        }
      }
    }

    // Phase 4: evaluate each candidate (exact first, then alias).
    for (const { original, normalized } of candidates) {
      const exactMatch = exactIndex.get(normalized);
      if (exactMatch !== undefined) {
        results.push({
          name: original,
          normalized,
          is_duplicate: true,
          matched_concept: exactMatch,
          matched_alias: null,
          matched_via: 'exact',
        });
        continue;
      }

      const aliasMatch = aliasIndex.get(normalized);
      if (aliasMatch !== undefined) {
        const primaryConcept = primaryConceptByDoc.get(aliasMatch.docId) ?? null;
        results.push({
          name: original,
          normalized,
          is_duplicate: true,
          matched_concept: primaryConcept,
          matched_alias: aliasMatch.originalAlias,
          matched_via: 'alias',
        });
        continue;
      }

      results.push({
        name: original,
        normalized,
        is_duplicate: false,
        matched_concept: null,
        matched_alias: null,
        matched_via: null,
      });
    }

    return { results, warnings };
  }

  // ----- helpers ---------------------------------------------------------

  /** Resolve a document by ID or by project-relative path. */
  private resolveDocument(docIdOrPath: string): MarkdownDocumentRow | null {
    // Try by ID first
    const byId = this.db
      .prepare('SELECT * FROM markdown_documents WHERE id = ?')
      .get(docIdOrPath) as MarkdownDocumentRow | undefined;
    if (byId) return byId;

    // Then by path (also support backslash → slash for Windows callers)
    const normalized = docIdOrPath.split('\\').join('/');
    const byPath = this.db
      .prepare('SELECT * FROM markdown_documents WHERE path = ?')
      .get(normalized) as MarkdownDocumentRow | undefined;
    return byPath ?? null;
  }

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

  /** Document IDs linked to a given vocab name (concept/domain/tag). */
  private docIdsForVocab(
    name: string,
    targetColumn: 'concept_id' | 'domain_id' | 'tag_id',
    table: 'markdown_document_concepts' | 'markdown_document_domains' | 'markdown_document_tags',
  ): string[] {
    // Resolve name → id first
    const vocabTable = table === 'markdown_document_concepts'
      ? 'markdown_concepts'
      : table === 'markdown_document_domains'
        ? 'markdown_domains'
        : 'markdown_tags';
    const vocabRow = this.db
      .prepare(`SELECT id FROM ${vocabTable} WHERE name = ?`)
      .get(name) as { id: string } | undefined;
    if (!vocabRow) return [];

    const rows = this.db
      .prepare(`SELECT document_id FROM ${table} WHERE ${targetColumn} = ?`)
      .all(vocabRow.id) as Array<{ document_id: string }>;
    return rows.map(r => r.document_id);
  }

  private sortByRelevance(ids: string[], q: string): string[] {
    if (ids.length === 0) return ids;
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT id,
           (CASE WHEN title LIKE ? ESCAPE '\\' THEN 2 ELSE 0 END) +
           (CASE WHEN summary_text LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END) AS score
         FROM markdown_documents
         WHERE id IN (${placeholders})
         ORDER BY score DESC, (updated IS NULL), updated DESC, title ASC`,
      )
      .all(`%${q}%`, `%${q}%`, ...ids) as Array<{ id: string; score: number }>;
    return rows.map(r => r.id);
  }

  private sortByRecency(ids: string[]): string[] {
    if (ids.length === 0) return ids;
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT id FROM markdown_documents
         WHERE id IN (${placeholders})
         ORDER BY (updated IS NULL), updated DESC, title ASC`,
      )
      .all(...ids) as Array<{ id: string }>;
    return rows.map(r => r.id);
  }

  private hydrateDescriptor(id: string, q?: string): DocumentDescriptor {
    const doc = this.db
      .prepare('SELECT * FROM markdown_documents WHERE id = ?')
      .get(id) as MarkdownDocumentRow;
    return {
      id: doc.id,
      path: doc.path,
      title: doc.title,
      documentType: doc.document_type as DocumentDescriptor['documentType'],
      status: doc.status as DocumentDescriptor['status'],
      sourceType: doc.source_type as DocumentDescriptor['sourceType'],
      updatedAt: doc.updated,
      summary: doc.summary_text,
      concepts: this.vocabNamesForDoc(doc.id, 'markdown_document_concepts', 'concept_id'),
      domains: this.vocabNamesForDoc(doc.id, 'markdown_document_domains', 'domain_id'),
      tags: this.vocabNamesForDoc(doc.id, 'markdown_document_tags', 'tag_id'),
      score: q ? this.computeScore(doc, q) : undefined,
    };
  }

  private hydrateDetail(doc: MarkdownDocumentRow): DocumentDetail {
    return {
      ...this.hydrateDescriptor(doc.id),
      owners: parseJsonArray(doc.owners),
      aliases: parseJsonArray(doc.aliases),
      relatedCode: parseJsonArray(doc.related_code),
      createdAt: doc.created,
      indexedAt: doc.indexed_at,
    };
  }

  private vocabNamesForDoc(
    docId: string,
    table: 'markdown_document_concepts' | 'markdown_document_domains' | 'markdown_document_tags',
    column: 'concept_id' | 'domain_id' | 'tag_id',
  ): string[] {
    const vocabTable = table === 'markdown_document_concepts'
      ? 'markdown_concepts'
      : table === 'markdown_document_domains'
        ? 'markdown_domains'
        : 'markdown_tags';
    const rows = this.db
      .prepare(
        `SELECT v.name FROM ${table} x
         JOIN ${vocabTable} v ON v.id = x.${column}
         WHERE x.document_id = ?
         ORDER BY v.name ASC`,
      )
      .all(docId) as Array<{ name: string }>;
    return rows.map(r => r.name);
  }

  private computeScore(doc: MarkdownDocumentRow, q: string): number {
    let score = 0;
    if (doc.title.includes(q)) score += 2;
    if (doc.summary_text.includes(q)) score += 1;
    return score;
  }
}

function parseJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  } catch {
    return [];
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
