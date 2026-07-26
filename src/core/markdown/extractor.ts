/**
 * Extractor — turn a single markdown file into a `ParsedMarkdownFile`.
 *
 * This module orchestrates frontmatter parsing, summary extraction, and
 * validation. It does NOT touch the DB — that's the indexer's job.
 *
 * Failure modes (per spec §6.3):
 *   - File read fails                          → `read_error`
 *   - File has no frontmatter                  → `no_frontmatter`
 *   - Frontmatter open but not closed          → `frontmatter_unclosed`
 *   - YAML syntax error / tab indent / etc.    → `frontmatter_parse_error`
 *   - Required field missing or empty          → `missing_required_field`
 *   - Enum value out of whitelist              → `invalid_enum_value`
 *   - List field has scalar shape              → `field_type_error`
 *
 * `extractFromFile` returns either `{ ok: true, parsed }` or
 * `{ ok: false, skip: { reason, detail } }`. It does not throw on user-data
 * problems — only on truly unexpected I/O errors.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  extractSummary,
} from './summary-extractor';
import {
  extractFrontmatterBlock,
  FrontmatterSyntaxError,
  parseFrontmatterBlock,
} from './frontmatter-parser';
import { validateFrontmatter } from './validator';
import type {
  MarkdownDocumentRecord,
  ParsedMarkdownFile,
  SkipLogEntry,
  SkipReason,
} from './types';
import { documentIdFromPath } from './store';

export type ExtractResult =
  | { ok: true; parsed: ParsedMarkdownFile }
  | { ok: false; skip: SkipLogEntry };

/**
 * Read, parse, and validate a single markdown file.
 *
 * @param absoluteFilePath absolute path to the file on disk
 * @param projectRoot      project root (for computing project-relative path)
 */
export function extractFromFile(
  absoluteFilePath: string,
  projectRoot: string,
): ExtractResult {
  const relPath = toProjectRelative(absoluteFilePath, projectRoot);

  let source: string;
  try {
    source = fs.readFileSync(absoluteFilePath, 'utf-8');
  } catch (err) {
    return {
      ok: false,
      skip: {
        path: relPath,
        reason: 'read_error',
        detail: err instanceof Error ? err.message : String(err),
      },
    };
  }

  // Phase 1: frontmatter present?
  let block: string | null;
  try {
    block = extractFrontmatterBlock(source);
  } catch (err) {
    return {
      ok: false,
      skip: {
        path: relPath,
        reason: 'frontmatter_unclosed',
        detail:
          err instanceof FrontmatterSyntaxError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err),
      },
    };
  }
  if (block === null) {
    return {
      ok: false,
      skip: { path: relPath, reason: 'no_frontmatter' },
    };
  }

  // Phase 2: parse YAML-subset
  let parsed;
  try {
    parsed = parseFrontmatterBlock(block);
  } catch (err) {
    return {
      ok: false,
      skip: {
        path: relPath,
        reason: 'frontmatter_parse_error',
        detail:
          err instanceof FrontmatterSyntaxError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err),
      },
    };
  }

  // Phase 3: validate
  const validation = validateFrontmatter(parsed);
  if (!validation.valid) {
    return {
      ok: false,
      skip: {
        path: relPath,
        reason: validation.skipReason as SkipReason,
        detail: validation.detail,
      },
    };
  }
  const fields = validation.fields!;

  // Phase 4: summary
  const summaryText = extractSummary(source);

  // Phase 5: build ParsedMarkdownFile
  const document: MarkdownDocumentRecord = {
    id: documentIdFromPath(relPath),
    path: relPath,
    title: fields.title,
    documentType: fields.documentType,
    status: fields.status,
    sourceType: fields.sourceType,
    summaryText,
    owners: fields.owners,
    aliases: fields.aliases,
    relatedCode: fields.relatedCode,
    created: fields.created,
    updated: fields.updated,
    relatedDocuments: fields.relatedDocuments,
  };

  return {
    ok: true,
    parsed: {
      document,
      concepts: fields.concepts,
      domains: fields.domains,
      tags: fields.tags,
      relatedDocumentsRaw: fields.relatedDocuments,
    },
  };
}

/**
 * Convert an absolute file path to a project-relative POSIX path.
 *
 * - Always uses `/` separator (cross-platform stable; PRD §7.3).
 * - If the file is somehow outside projectRoot, return the absolute path
 *   normalized to POSIX (defensive — should not happen in practice).
 */
export function toProjectRelative(
  absoluteFilePath: string,
  projectRoot: string,
): string {
  const rel = path.relative(projectRoot, absoluteFilePath);
  return rel.split(path.sep).join('/');
}
