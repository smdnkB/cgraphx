/**
 * checkConceptDedup(Layer 2 概念去重)的实现体。
 *
 * 从 query.ts 整体搬出(原 MarkdownQuery.checkConceptDedup 私有语义),
 * 逻辑未改写,仅把 `this.db` 参数化为显式 `db` 入参;供 query.ts 薄委托。
 * 不进入子系统门面,模块内导出。
 */

import type { SqliteDatabase } from '../db';
import { normalizeName } from './dedup';
import type { DedupCheckResult, DedupResponse } from './types';

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
export function runConceptDedupCheck(db: SqliteDatabase, names: string[]): DedupResponse {
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
  const conceptRows = db
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
  const docAliasRows = db
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
    const rows = db
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
