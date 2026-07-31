/**
 * Validate a parsed frontmatter against the markdown knowledge base rules.
 *
 * Spec §5 — two phases:
 *   1. Required fields: all 8 keys present and non-empty.
 *   2. Enum values: document_type / status / source_type must be in their
 *      respective whitelists.
 *
 * Returns `ValidationResult.valid = true` when the file is indexable, or
 * `valid = false` with a `SkipReason` (PRD §6 + spec §6.3) when the file
 * should be skipped. The indexer decides what to do with skipped files
 * (typically: log to `markdown_skip_log`).
 */

import {
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  REQUIRED_FRONTMATTER_KEYS,
  SOURCE_TYPES,
} from './constants';
import type { SkipReason } from './types';
import {
  FrontmatterSyntaxError,
  hasNonEmpty,
  readList,
  readScalar,
  type ParsedFrontmatter,
} from './frontmatter-parser';

export interface ValidationResult {
  valid: boolean;
  skipReason?: SkipReason;
  detail?: string;
  /** Populated when valid — the parsed view of the document's metadata. */
  fields?: ValidatedFields;
}

export interface ValidatedFields {
  title: string;
  documentType: (typeof DOCUMENT_TYPES)[number];
  status: (typeof DOCUMENT_STATUSES)[number];
  sourceType: (typeof SOURCE_TYPES)[number];
  domains: string[];
  concepts: string[];
  aliases: string[];
  tags: string[];
  owners: string[];
  relatedCode: string[];
  relatedDocuments: string[];
  created: string | null;
  updated: string | null;
}

const DOCUMENT_TYPE_SET = new Set<string>(DOCUMENT_TYPES);
const STATUS_SET = new Set<string>(DOCUMENT_STATUSES);
const SOURCE_TYPE_SET = new Set<string>(SOURCE_TYPES);

/**
 * Validate the parsed frontmatter. Throws caught-by-caller errors from
 * frontmatter parsing propagate as `field_type_error` skip reasons.
 */
export function validateFrontmatter(
  parsed: ParsedFrontmatter,
): ValidationResult {
  // Phase 1: required keys present and non-empty
  for (const key of REQUIRED_FRONTMATTER_KEYS) {
    if (!hasNonEmpty(parsed, key)) {
      return {
        valid: false,
        skipReason: 'missing_required_field',
        detail: `missing or empty required field: ${key}`,
      };
    }
  }

  // Phase 2: enum values —— detail 列举合法值,便于 docs validate 使用者修正
  const documentType = readScalar(parsed, 'document_type');
  if (!DOCUMENT_TYPE_SET.has(documentType)) {
    return {
      valid: false,
      skipReason: 'invalid_enum_value',
      detail: `document_type=${documentType} (valid: ${DOCUMENT_TYPES.join(', ')})`,
    };
  }
  const status = readScalar(parsed, 'status');
  if (!STATUS_SET.has(status)) {
    return {
      valid: false,
      skipReason: 'invalid_enum_value',
      detail: `status=${status} (valid: ${DOCUMENT_STATUSES.join(', ')})`,
    };
  }
  const sourceType = readScalar(parsed, 'source_type');
  if (!SOURCE_TYPE_SET.has(sourceType)) {
    return {
      valid: false,
      skipReason: 'invalid_enum_value',
      detail: `source_type=${sourceType} (valid: ${SOURCE_TYPES.join(', ')})`,
    };
  }

  // Phase 3: read optional + list fields. Type errors (list expected but got
  // scalar) become field_type_error skips.
  try {
    const fields: ValidatedFields = {
      title: readScalar(parsed, 'title'),
      documentType: documentType as ValidatedFields['documentType'],
      status: status as ValidatedFields['status'],
      sourceType: sourceType as ValidatedFields['sourceType'],
      domains: readList(parsed, 'domains'),
      concepts: readList(parsed, 'concepts'),
      aliases: readList(parsed, 'aliases'),
      tags: readList(parsed, 'tags'),
      owners: readList(parsed, 'owners'),
      relatedCode: readList(parsed, 'related_code'),
      relatedDocuments: readList(parsed, 'related_documents'),
      created: readScalar(parsed, 'created') || null,
      updated: readScalar(parsed, 'updated') || null,
    };
    return { valid: true, fields };
  } catch (err) {
    const detail =
      err instanceof FrontmatterSyntaxError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return {
      valid: false,
      skipReason: 'field_type_error',
      detail,
    };
  }
}
