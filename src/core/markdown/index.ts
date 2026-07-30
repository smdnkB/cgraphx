/**
 * markdown 子系统公共门面(子系统五件套约定中的对外入口)。
 *
 * 硬约定:外部调用方(web 层、未来的其它消费方)必须经此门面导入,
 * 不得直接伸手进内部模块(query / store / indexer 等)。
 *
 * 导出面刻意收窄:
 *   - 只导出查询/引导/解析/常量/错误/公共类型;
 *   - MarkdownStore(写入面,仅 indexer 内部使用)与 MarkdownDocumentRow
 *     (DB 原始行类型)不外泄 —— 行 → 领域类型的映射在子系统内部完成
 *     (data-standards「ORM 映射约定」:原始行类型不外泄)。
 */

export { MarkdownQuery } from './query';
export { openMarkdownDb, MARKDOWN_SCHEMA_VERSION, getCurrentMarkdownSchemaVersion } from './schema-bootstrap';
export { parseFrontmatter } from './frontmatter-parser';
export { stripFrontmatter } from './frontmatter-parser';
export { DOCUMENT_TYPES, DOCUMENT_STATUSES, SOURCE_TYPES, KNOWLEDGE_DIR } from './constants';
export type { DocumentType, DocumentStatus, SourceType } from './constants';
export { MarkdownIndexError, SchemaMismatchError, DocumentNotFoundError, ProjectNotInitializedError } from './errors';
export type { ConceptSummary, DomainSummary, TagSummary, FindFilter, FindPagedResult, KnowledgeStats,
              DocumentDescriptor, DocumentDetail, ReferenceView, ReferenceTarget } from './types';
