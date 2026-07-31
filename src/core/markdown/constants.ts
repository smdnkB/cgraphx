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
  'business-entity', // 业务实体
  'business-flow', // 业务流程
  'mechanism', // 技术机制(含架构)
  'decision', // 决策
  'rule', // 规则
  'lesson', // 教训
  'guide', // 指南(含运维手册/教程/安装/FAQ/API 文档)
] as const;

export const DOCUMENT_STATUSES = [
  'draft',
  'active',
  'superseded',
  'deprecated',
] as const;

export const SOURCE_TYPES = [
  'work_context', // 工作上下文:需求/任务流中沉淀
  'batch_exploration', // 批量探索:knowledge-init 式项目探索
  'review', // 评审:代码/架构评审中发现
  'debugging', // 调查排障:问题调查中发现
  'manual', // 手工:人工主动整理
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
