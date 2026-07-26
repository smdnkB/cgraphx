/**
 * TypeScript types for the markdown knowledge base subsystem.
 *
 * Independent from src/types.ts (NodeKind/EdgeKind) — the markdown subsystem
 * has its own node/edge vocabulary and does not pollute the main code graph.
 */

import type {
  DocumentType,
  DocumentStatus,
  SourceType,
} from './constants';

export interface ParsedMarkdownFile {
  document: MarkdownDocumentRecord;
  concepts: string[];
  domains: string[];
  tags: string[];
  relatedDocumentsRaw: string[];
}

export interface MarkdownDocumentRecord {
  id: string;
  path: string;
  title: string;
  documentType: DocumentType;
  status: DocumentStatus;
  sourceType: SourceType;
  summaryText: string;
  owners: string[];
  aliases: string[];
  relatedCode: string[];
  created: string | null;
  updated: string | null;
  /** Original declared related_documents paths (relative to the doc's directory). */
  relatedDocuments: string[];
}

export interface ConceptSummary {
  id: string;
  name: string;
  documentCount: number;
  domains: string[];
}

export interface DomainSummary {
  id: string;
  name: string;
  documentCount: number;
}

export interface TagSummary {
  id: string;
  name: string;
  documentCount: number;
}

export interface FindFilter {
  concept?: string;
  domain?: string;
  tag?: string;
  status?: DocumentStatus;
  documentType?: DocumentType;
  q?: string;
  limit?: number;
}

export interface DocumentDescriptor {
  id: string;
  path: string;
  title: string;
  documentType: DocumentType;
  status: DocumentStatus;
  sourceType: SourceType;
  updatedAt: string | null;
  summary: string;
  concepts: string[];
  domains: string[];
  tags: string[];
  score?: number;
}

export interface DocumentDetail extends DocumentDescriptor {
  owners: string[];
  aliases: string[];
  relatedCode: string[];
  createdAt: string | null;
  indexedAt: number;
}

export interface ReferenceView {
  documentId: string;
  documentTitle: string;
  documentPath: string;
  outgoing: Array<ReferenceTarget>;
  incoming: Array<ReferenceTarget>;
}

export interface ReferenceTarget {
  id: string;
  title: string;
  path: string;
}

export interface IndexReport {
  runId: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  scannedFiles: number;
  indexedDocuments: number;
  skippedFiles: number;
  skipBreakdown: SkipBreakdown;
  conceptsCreated: number;
  domainsCreated: number;
  tagsCreated: number;
  referencesCreated: number;
  danglingReferences: number;
  conflictPaths: string[];
  error?: string;
}

export interface SkipBreakdown {
  no_frontmatter: number;
  frontmatter_unclosed: number;
  frontmatter_parse_error: number;
  field_type_error: number;
  missing_required_field: number;
  invalid_enum_value: number;
  read_error: number;
  dangling_reference: number;
}

export type SkipReason = keyof SkipBreakdown;

export interface SkipLogEntry {
  path: string;
  reason: SkipReason;
  detail?: string;
}

// ----- concept dedup (Layer 2) ------------------------------------------

export interface DedupCheckResult {
  name: string;
  normalized: string;
  is_duplicate: boolean;
  matched_concept: string | null;
  matched_alias: string | null;
  matched_via: 'exact' | 'alias' | null;
}

export interface DedupResponse {
  results: DedupCheckResult[];
  warnings?: string[]; // e.g. ["empty normalized form: '---'"]
}

// ----- seen-names (Layer 1 entry name dedup) -----------------------------

export interface SeenNameAddResult {
  added: string[];                    // normalized names actually inserted this call
  skipped_already_present: string[];  // normalized names that already existed (ignored)
  total_seen: number;                 // total rows in the table after this call
}

export interface SeenNameCheckResultItem {
  name: string;          // original name as passed in
  normalized: string;    // normalizeName(name)
  is_seen: boolean;
}

export interface SeenNameCheckResult {
  results: SeenNameCheckResultItem[];
}

export interface SeenNameListEntry {
  original: string;
  normalized: string;
  added_at: number;     // epoch milliseconds
}

export interface SeenNameListResponse {
  names: SeenNameListEntry[];
  total: number;
}

export interface SeenNameClearResult {
  removed: number;
}
