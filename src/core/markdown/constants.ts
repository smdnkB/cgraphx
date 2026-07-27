/**
 * Business constants for the markdown knowledge base subsystem.
 *
 * These mirror the spec §5 validation rules. Keep this file the single source
 * of truth for required fields, enum values, and section names.
 */

export const REQUIRED_FRONTMATTER_KEYS = [
  'title',
  'document_type',
  'domains',
  'concepts',
  'status',
  'source_type',
  'updated',
] as const;

export const DOCUMENT_TYPES = [
  'conversation',
  'exploration',
  'finding',
  'analysis',
  'lesson',
  'warning',
  'decision',
  'rule',
  'architecture',
  'guide',
  'tutorial',
  'runbook',
  'installation',
  'api',
  'faq',
  'note',
  'concept', // 实体概念主条目(知识库索引层的枢纽,如"商品"、"礼包")
] as const;

export const DOCUMENT_STATUSES = [
  'draft',
  'active',
  'superseded',
  'deprecated',
] as const;

export const SOURCE_TYPES = [
  'ai_session',
  'human_note',
  'code_review',
  'debugging',
  'architecture_review',
  'manual',
  'external_summary',
] as const;

export const LIST_KEYS = [
  'domains',
  'concepts',
  'aliases',
  'tags',
  'owners',
  'related_code',
  'related_documents',
] as const;

export const OPTIONAL_SCALAR_KEYS = [
  'created',
  'updated',
] as const;

/** Headings recognized as the Summary section. Match must be exact + case-sensitive. */
export const SUMMARY_HEADINGS = ['Summary', '摘要'] as const;

/** Subdirectory under project root that gets scanned. */
export const KNOWLEDGE_DIR = 'docs/knowledge';

/** File extensions accepted by the scanner. */
export const ACCEPTED_EXTENSIONS = ['.md', '.mdx'];

export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export type SourceType = (typeof SOURCE_TYPES)[number];
