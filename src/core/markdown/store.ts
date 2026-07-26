/**
 * MarkdownStore — low-level persistence for the markdown subsystem.
 *
 * Each method is a thin wrapper around a prepared statement. The indexer
 * (`indexer.ts`) drives these inside a single transaction for atomic
 * full-table replacement; the query layer (`query.ts`) reads via its own
 * prepared statements on the same DB handle.
 *
 * No code in `src/markdown/` reads or writes the main cgraphx tables
 * (`nodes`, `edges`, `files`, …). This store touches `markdown_*` only.
 */

import crypto from 'node:crypto';

import type { SqliteDatabase } from '../db';
import type {
  MarkdownDocumentRecord,
  SkipLogEntry,
} from './types';

/**
 * Stable ID for a document — sha256 of its project-relative path.
 *
 * The path is the natural identity: renaming a file is treated as a delete
 * + insert, which is consistent with the cover-the-table rebuild semantics.
 */
export function documentIdFromPath(projectRelativePath: string): string {
  return crypto
    .createHash('sha256')
    .update(projectRelativePath)
    .digest('hex');
}

/**
 * Stable ID for a concept / domain / tag — sha256 of its (case-sensitive)
 * name. `Order` and `order` are two distinct concepts (PRD §6.7).
 */
export function vocabIdFromName(name: string): string {
  return crypto.createHash('sha256').update(name).digest('hex');
}

/** JSON-stringify an array defensively (always returns '[]' for null/undefined). */
function jsonString(arr: string[] | null | undefined): string {
  return JSON.stringify(arr ?? []);
}

export class MarkdownStore {
  constructor(private readonly db: SqliteDatabase) {}

  // ----- documents ---------------------------------------------------------

  upsertDocument(doc: MarkdownDocumentRecord): void {
    const id = documentIdFromPath(doc.path);
    this.db
      .prepare(
        `INSERT INTO markdown_documents (
           id, path, title, document_type, status, source_type,
           summary_text, owners, aliases, related_code, created, updated,
           indexed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           path = excluded.path,
           title = excluded.title,
           document_type = excluded.document_type,
           status = excluded.status,
           source_type = excluded.source_type,
           summary_text = excluded.summary_text,
           owners = excluded.owners,
           aliases = excluded.aliases,
           related_code = excluded.related_code,
           created = excluded.created,
           updated = excluded.updated,
           indexed_at = excluded.indexed_at`,
      )
      .run(
        id,
        doc.path,
        doc.title,
        doc.documentType,
        doc.status,
        doc.sourceType,
        doc.summaryText,
        jsonString(doc.owners),
        jsonString(doc.aliases),
        jsonString(doc.relatedCode),
        doc.created,
        doc.updated,
        Date.now(),
      );
  }

  getDocumentById(id: string) {
    return this.db
      .prepare('SELECT * FROM markdown_documents WHERE id = ?')
      .get(id) as MarkdownDocumentRow | undefined;
  }

  getDocumentByPath(projectRelativePath: string) {
    return this.db
      .prepare('SELECT * FROM markdown_documents WHERE path = ?')
      .get(projectRelativePath) as MarkdownDocumentRow | undefined;
  }

  listAllDocumentPaths(): string[] {
    const rows = this.db
      .prepare('SELECT path FROM markdown_documents')
      .all() as Array<{ path: string }>;
    return rows.map(r => r.path);
  }

  // ----- vocabulary --------------------------------------------------------

  /** Upsert a concept/domain/tag name and return its id. */
  upsertVocab(
    table: 'markdown_concepts' | 'markdown_domains' | 'markdown_tags',
    name: string,
  ): string {
    const id = vocabIdFromName(name);
    this.db
      .prepare(
        `INSERT INTO ${table} (id, name, created_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(id, name, Date.now());
    return id;
  }

  // ----- edges -------------------------------------------------------------

  linkDocumentConcept(documentId: string, conceptId: string): void {
    this.linkEdge('markdown_document_concepts', 'concept_id', documentId, conceptId);
  }

  linkDocumentDomain(documentId: string, domainId: string): void {
    this.linkEdge('markdown_document_domains', 'domain_id', documentId, domainId);
  }

  linkDocumentTag(documentId: string, tagId: string): void {
    this.linkEdge('markdown_document_tags', 'tag_id', documentId, tagId);
  }

  linkDocumentReference(
    sourceDocumentId: string,
    targetDocumentId: string,
    refPath: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO markdown_document_references
           (source_document_id, target_document_id, ref_path)
         VALUES (?, ?, ?)
         ON CONFLICT(source_document_id, target_document_id) DO NOTHING`,
      )
      .run(sourceDocumentId, targetDocumentId, refPath);
  }

  private linkEdge(
    table: 'markdown_document_concepts' | 'markdown_document_domains' | 'markdown_document_tags',
    targetColumn: 'concept_id' | 'domain_id' | 'tag_id',
    documentId: string,
    targetId: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO ${table} (document_id, ${targetColumn}) VALUES (?, ?)
         ON CONFLICT DO NOTHING`,
      )
      .run(documentId, targetId);
  }

  // ----- keyword search (LIKE-based, see schema.sql note) -----------------

  /**
   * Find document IDs whose title or summary_text contains the keyword.
   * Case-insensitive, substring match. Returns IDs only; the caller hydrates.
   */
  findDocumentIdsByKeyword(keyword: string): string[] {
    const like = `%${keyword.replace(/[%_]/g, m => '\\' + m)}%`;
    const rows = this.db
      .prepare(
        `SELECT id FROM markdown_documents
         WHERE title LIKE ? ESCAPE '\\' OR summary_text LIKE ? ESCAPE '\\'`,
      )
      .all(like, like) as Array<{ id: string }>;
    return rows.map(r => r.id);
  }

  // ----- skip log ----------------------------------------------------------

  insertSkipLog(runId: string, entry: SkipLogEntry): void {
    this.db
      .prepare(
        `INSERT INTO markdown_skip_log (run_id, path, reason, detail)
         VALUES (?, ?, ?, ?)`,
      )
      .run(runId, entry.path, entry.reason, entry.detail ?? null);
  }

  // ----- bulk wipe (for cover-the-table rebuild) ---------------------------

  /**
   * Wipe all markdown_* tables. Used at the start of a full rebuild.
   *
   * Foreign-key cascades handle edge tables. The schema_versions row is
   * preserved.
   */
  wipeAll(): void {
    this.db.exec(`
      DELETE FROM markdown_documents;
      DELETE FROM markdown_concepts;
      DELETE FROM markdown_domains;
      DELETE FROM markdown_tags;
      DELETE FROM markdown_document_references;
      DELETE FROM markdown_skip_log;
    `);
    // Edge tables (document_concepts/domains/tags) cascade-delete with
    // markdown_documents, but the FK enforcement depends on PRAGMA state at
    // the moment of delete; clear them defensively too.
    this.db.exec(`
      DELETE FROM markdown_document_concepts;
      DELETE FROM markdown_document_domains;
      DELETE FROM markdown_document_tags;
    `);
  }

  // ----- transaction helpers ----------------------------------------------

  /**
   * Run a function inside BEGIN/COMMIT, rolling back on throw.
   *
   * Mirrors `SqliteDatabase.transaction()` so callers don't have to import
   * the low-level type to do this.
   */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // ROLLBACK failure is rare and secondary to the original error
      }
      throw err;
    }
  }
}

/** Raw row shape from `markdown_documents`. Used by query layer for decoding. */
export interface MarkdownDocumentRow {
  id: string;
  path: string;
  title: string;
  document_type: string;
  status: string;
  source_type: string;
  summary_text: string;
  owners: string; // JSON
  aliases: string; // JSON
  related_code: string; // JSON
  created: string | null;
  updated: string | null;
  indexed_at: number;
}
