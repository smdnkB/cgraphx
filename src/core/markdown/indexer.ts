/**
 * MarkdownIndexer — cover-the-table full rebuild.
 *
 * Flow (spec §6.1):
 *   1. Open shared cgraphx DB; ensure markdown schema.
 *   2. Scan <projectRoot>/docs/knowledge/ recursively (skip symlinks + dot-dirs).
 *   3. Extract each .md/.mdx via `extractFromFile`.
 *   4. In ONE transaction: wipeAll → insert documents/vocabularies/edges →
 *      resolve document_references → rebuild FTS5.
 *   5. Return IndexReport.
 *
 * Failure handling: any throw inside the transaction triggers ROLLBACK;
 * the prior index is preserved untouched. The function itself only throws
 * for unrecoverable problems (DB not initialized, scan dir absolutely
 * unreadable).
 *
 * Not integrated: .gitignore filtering (YAGNI — docs/knowledge/ is a curated
 * knowledge dir, not a vendor payload). Can be added later if needed.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { KNOWLEDGE_DIR, ACCEPTED_EXTENSIONS } from './constants';
import { extractFromFile } from './extractor';
import { MarkdownStore, vocabIdFromName as idForName } from './store';
import { openMarkdownDb } from './schema-bootstrap';
import type {
  IndexReport,
  ParsedMarkdownFile,
  SkipBreakdown,
  SkipLogEntry,
} from './types';

export interface IndexOptions {
  onProgress?: (msg: string) => void;
}

const EMPTY_SKIP_BREAKDOWN: SkipBreakdown = {
  no_frontmatter: 0,
  frontmatter_unclosed: 0,
  frontmatter_parse_error: 0,
  field_type_error: 0,
  missing_required_field: 0,
  invalid_enum_value: 0,
  read_error: 0,
  dangling_reference: 0,
};

/**
 * Index the markdown knowledge base under <projectRoot>/docs/knowledge/.
 *
 * Re-uses the shared `.cgraphx/cgraphx.db` (must already exist via
 * `cgraphx init`). The markdown schema is auto-applied on first call.
 *
 * Errors thrown: only for unrecoverable problems. User-data problems
 * (bad frontmatter, missing fields) are returned via `report.skipBreakdown`.
 */
export async function indexMarkdownKnowledgeBase(
  projectRoot: string,
  options: IndexOptions = {},
): Promise<IndexReport> {
  const startedAt = Date.now();
  const runId = crypto
    .createHash('sha256')
    .update(`${projectRoot}:${startedAt}`)
    .digest('hex')
    .slice(0, 16);

  const knowledgeDir = path.join(projectRoot, KNOWLEDGE_DIR);

  if (!fs.existsSync(knowledgeDir)) {
    return {
      runId,
      startedAt,
      finishedAt: Date.now(),
      durationMs: 0,
      scannedFiles: 0,
      indexedDocuments: 0,
      skippedFiles: 0,
      skipBreakdown: { ...EMPTY_SKIP_BREAKDOWN },
      conceptsCreated: 0,
      domainsCreated: 0,
      tagsCreated: 0,
      referencesCreated: 0,
      danglingReferences: 0,
      conflictPaths: [],
      error: `${KNOWLEDGE_DIR}/ not found at ${knowledgeDir}`,
    };
  }

  // Phase 1: scan
  const filePaths = collectMarkdownFiles(knowledgeDir);
  options.onProgress?.(`Found ${filePaths.length} file(s) under ${KNOWLEDGE_DIR}/`);

  // Phase 2: extract
  const parsedFiles: ParsedMarkdownFile[] = [];
  const skipLog: SkipLogEntry[] = [];

  for (const absPath of filePaths) {
    const result = extractFromFile(absPath, projectRoot);
    if (result.ok) {
      parsedFiles.push(result.parsed);
    } else {
      skipLog.push(result.skip);
    }
  }

  options.onProgress?.(
    `Extracted ${parsedFiles.length} valid document(s); ${skipLog.length} skipped`,
  );

  // Phase 3: transactional rebuild
  const connection = openMarkdownDb(projectRoot);
  const store = new MarkdownStore(connection.getDb());

  let report: IndexReport;
  try {
    report = store.transaction(() => {
      // Wipe (cover-the-table)
      store.wipeAll();

      // Insert documents
      for (const file of parsedFiles) {
        store.upsertDocument(file.document);
      }

      // Insert vocabulary (deduped via UNIQUE + ON CONFLICT DO NOTHING)
      const conceptSet = new Set<string>();
      const domainSet = new Set<string>();
      const tagSet = new Set<string>();
      for (const file of parsedFiles) {
        for (const c of file.concepts) conceptSet.add(c);
        for (const d of file.domains) domainSet.add(d);
        for (const t of file.tags) tagSet.add(t);
      }
      for (const name of conceptSet) store.upsertVocab('markdown_concepts', name);
      for (const name of domainSet) store.upsertVocab('markdown_domains', name);
      for (const name of tagSet) store.upsertVocab('markdown_tags', name);

      // Link edges
      for (const file of parsedFiles) {
        const docId = file.document.id;
        for (const c of file.concepts) {
          store.linkDocumentConcept(docId, idForName(c));
        }
        for (const d of file.domains) {
          store.linkDocumentDomain(docId, idForName(d));
        }
        for (const t of file.tags) {
          store.linkDocumentTag(docId, idForName(t));
        }
      }

      // Resolve references (two-phase: documents all inserted above)
      let referencesCreated = 0;
      const dangling: SkipLogEntry[] = [];
      for (const file of parsedFiles) {
        const sourceId = file.document.id;
        const sourceDir = path.dirname(file.document.path);
        for (const rawRef of file.relatedDocumentsRaw) {
          // Support BOTH conventions: many authors write `related_documents`
          // as project-root-relative (`docs/knowledge/x.md`), others write
          // them as source-document-relative (`./x.md`, `../y.md`). Try
          // source-relative first (markdown-link convention), then
          // root-relative (project-overview convention).
          const fromSource = resolveRefPath(rawRef, sourceDir, projectRoot);
          const fromRoot = resolveRefPath(rawRef, '', projectRoot);
          const targetFromSource = store.getDocumentByPath(fromSource);
          const target = targetFromSource ?? store.getDocumentByPath(fromRoot);
          if (target) {
            store.linkDocumentReference(sourceId, target.id, rawRef);
            referencesCreated++;
          } else {
            dangling.push({
              path: file.document.path,
              reason: 'dangling_reference',
              detail: `unresolved ref "${rawRef}" (tried ${fromSource}, ${fromRoot})`,
            });
          }
        }
      }

      // Rebuild keyword index: with LIKE-based search (see schema.sql note),
      // there's no separate FTS table to refresh — title/summary_text live in
      // markdown_documents, which the upsert loop above already populated.

      // Write skip log
      for (const entry of skipLog) {
        store.insertSkipLog(runId, entry);
      }
      for (const entry of dangling) {
        store.insertSkipLog(runId, entry);
      }

      // Compose report
      const skipBreakdown = { ...EMPTY_SKIP_BREAKDOWN };
      for (const entry of skipLog) {
        skipBreakdown[entry.reason]++;
      }
      skipBreakdown.dangling_reference = dangling.length;

      return {
        runId,
        startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        scannedFiles: filePaths.length,
        indexedDocuments: parsedFiles.length,
        skippedFiles: skipLog.length,
        skipBreakdown,
        conceptsCreated: conceptSet.size,
        domainsCreated: domainSet.size,
        tagsCreated: tagSet.size,
        referencesCreated,
        danglingReferences: dangling.length,
        conflictPaths: [],
      } satisfies IndexReport;
    });
  } finally {
    connection.close();
  }

  options.onProgress?.(
    `Done: ${report.indexedDocuments} docs, ${report.conceptsCreated} concepts, ${report.durationMs}ms`,
  );

  return report;
}

/**
 * Walk a directory and collect markdown files.
 *
 * - Skip dot-directories (e.g. `.git/`, `.drafts/`).
 * - Skip symlinks (prevents cycles + security).
 * - Accept only .md / .mdx extensions (case-sensitive — README.MD is rejected).
 */
function collectMarkdownFiles(rootDir: string): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      // Symlinks: lstat via Dirent.isSymbolicLink() catches them
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (ACCEPTED_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(rootDir);
  results.sort(); // deterministic order across runs
  return results;
}

/**
 * Resolve a `related_documents` reference to a project-relative path.
 *
 * Reference is relative to the SOURCE document's directory (not the project
 * root). Output is normalized to POSIX for `markdown_documents.path` lookup.
 */
function resolveRefPath(
  rawRef: string,
  sourceDocDir: string,
  projectRoot: string,
): string {
  const absolute = path.resolve(projectRoot, sourceDocDir, rawRef);
  const rel = path.relative(projectRoot, absolute);
  return rel.split(path.sep).join('/');
}
