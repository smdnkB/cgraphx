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
  // ---- 复数过滤维度(web 分页列表使用,CLI 不传,全部可选)----
  // 语义:维度内 OR(SQL IN 候选集),维度间 AND(候选集求交);
  // 单值字段与同维度复数同时出现时,视为该维度两个约束取交;
  // 空数组等价于未传(不施加约束);statuses/documentTypes 含非法枚举值 →
  // 该维度返回空候选集(与现有单值非法枚举返回 [] 的行为一致)。
  concepts?: string[];
  domains?: string[];
  tags?: string[];
  statuses?: DocumentStatus[];
  documentTypes?: DocumentType[];
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
  // ---- 仅由 findPaged 填充的扩展字段 ----
  // find() 不填(键缺省),保证 CLI 输出逐字节不变。
  /** 引用数 = 出向 + 入向(对当页 id 集合一条 IN 聚合查询计数,非 N+1)。 */
  referencesCount?: number;
  owners?: string[];
  aliases?: string[];
}

/** findPaged 的分页结果:total 为分页前匹配总数,items 为当前页切片。 */
export interface FindPagedResult {
  total: number;
  items: DocumentDescriptor[];
}

/** 知识库统计条(web 总览页头部使用)。 */
export interface KnowledgeStats {
  documentCount: number;
  conceptCount: number;
  domainCount: number;
  tagCount: number;
  /** SELECT max(indexed_at);空库为 null。 */
  latestIndexedAt: number | null;
  /** 17 个 DocumentType 键全在,未出现的类型计数为 0。 */
  byType: Record<DocumentType, number>;
  /** 4 个 DocumentStatus 键全在,未出现的状态计数为 0。 */
  byStatus: Record<DocumentStatus, number>;
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
