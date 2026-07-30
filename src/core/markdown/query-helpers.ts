/**
 * query.ts 的私有助手模块:find / findPaged 共用的查询管线,以及
 * getReferences / getDocumentDetail 依赖的行解析与组装逻辑。
 *
 * 本模块不进入子系统门面(index.ts 不导出),仅供同目录 query.ts 内部
 * 委托调用 —— 拆分目的纯粹是把膨胀的 query.ts 压回 600 行以内,逻辑是
 * 原私有方法的纯搬运:方法体逐字保留,`this.db` 参数化为显式 `db` 入参。
 *
 * 全部为纯函数:接收 SqliteDatabase 等显式参数,不持有任何状态。
 */

import type { SqliteDatabase } from '../db';
import { DOCUMENT_STATUSES, DOCUMENT_TYPES } from './constants';
import type { MarkdownDocumentRow } from './store';
import type { DocumentDescriptor, DocumentDetail, FindFilter } from './types';

const STATUS_SET = new Set<string>(DOCUMENT_STATUSES);
const TYPE_SET = new Set<string>(DOCUMENT_TYPES);

/** JSON 字符串列(owners/aliases/related_code)→ string[];非法/非数组 → []。 */
export function parseJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// ----- find 管线:Phase 1 候选收集 ---------------------------------------

/** 词表关联表 → 词表本体的映射(concept/domain/tag 三种维度共用)。 */
function vocabTableFor(
  table: 'markdown_document_concepts' | 'markdown_document_domains' | 'markdown_document_tags',
): 'markdown_concepts' | 'markdown_domains' | 'markdown_tags' {
  return table === 'markdown_document_concepts'
    ? 'markdown_concepts'
    : table === 'markdown_document_domains'
      ? 'markdown_domains'
      : 'markdown_tags';
}

/**
 * 关联到给定词表名(concept/domain/tag)的文档 id 列表。
 * 名字先解析为词表 id;不在词表中则解析不到,返回 []。
 */
export function docIdsForVocab(
  db: SqliteDatabase,
  name: string,
  targetColumn: 'concept_id' | 'domain_id' | 'tag_id',
  table: 'markdown_document_concepts' | 'markdown_document_domains' | 'markdown_document_tags',
): string[] {
  // 先把名字解析成 id
  const vocabTable = vocabTableFor(table);
  const vocabRow = db
    .prepare(`SELECT id FROM ${vocabTable} WHERE name = ?`)
    .get(name) as { id: string } | undefined;
  if (!vocabRow) return [];

  const rows = db
    .prepare(`SELECT document_id FROM ${table} WHERE ${targetColumn} = ?`)
    .all(vocabRow.id) as Array<{ document_id: string }>;
  return rows.map(r => r.document_id);
}

/**
 * docIdsForVocab 的批量版:一次 IN 查询解析名字 → id,再一次 IN 查询
 * 取文档 id(维度内 OR,即多个名字的候选集并集;沿用 checkConceptDedup
 * 的批量 IN 占位符模式)。名字不在词表中则解析不到 id,自然不产出候选。
 */
export function docIdsForVocabMany(
  db: SqliteDatabase,
  names: string[],
  targetColumn: 'concept_id' | 'domain_id' | 'tag_id',
  table: 'markdown_document_concepts' | 'markdown_document_domains' | 'markdown_document_tags',
): string[] {
  const vocabTable = vocabTableFor(table);

  const namePlaceholders = names.map(() => '?').join(',');
  const vocabRows = db
    .prepare(`SELECT id FROM ${vocabTable} WHERE name IN (${namePlaceholders})`)
    .all(...names) as Array<{ id: string }>;
  if (vocabRows.length === 0) return [];

  const ids = vocabRows.map(r => r.id);
  const idPlaceholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT document_id FROM ${table} WHERE ${targetColumn} IN (${idPlaceholders})`)
    .all(...ids) as Array<{ document_id: string }>;
  return rows.map(r => r.document_id);
}

/**
 * Phase 1:按过滤维度收集候选文档 id 集合。
 *
 * 每个维度产出至多两个候选集:单值字段一个、复数字段一个(同维度两者
 * 共存 = 两个约束在 Phase 2 取交)。复数维度内为 OR(一条 IN 查询);
 * 空数组视为未施加约束(不产出候选集)。
 *
 * @returns 候选集数组;含非法枚举值时返回 null(该维度候选集为空 ⇒
 *   交集必为空 ⇒ 调用方直接返回空结果,与现有单值非法枚举返回 [] 一致)。
 */
export function collectCandidateSets(db: SqliteDatabase, filter: FindFilter): string[][] | null {
  const candidateSets: string[][] = [];

  if (filter.concept) {
    candidateSets.push(docIdsForVocab(db, filter.concept, 'concept_id', 'markdown_document_concepts'));
  }
  if (filter.concepts && filter.concepts.length > 0) {
    candidateSets.push(docIdsForVocabMany(db, filter.concepts, 'concept_id', 'markdown_document_concepts'));
  }
  if (filter.domain) {
    candidateSets.push(docIdsForVocab(db, filter.domain, 'domain_id', 'markdown_document_domains'));
  }
  if (filter.domains && filter.domains.length > 0) {
    candidateSets.push(docIdsForVocabMany(db, filter.domains, 'domain_id', 'markdown_document_domains'));
  }
  if (filter.tag) {
    candidateSets.push(docIdsForVocab(db, filter.tag, 'tag_id', 'markdown_document_tags'));
  }
  if (filter.tags && filter.tags.length > 0) {
    candidateSets.push(docIdsForVocabMany(db, filter.tags, 'tag_id', 'markdown_document_tags'));
  }
  if (filter.status) {
    if (!STATUS_SET.has(filter.status)) {
      return null; // invalid enum → empty
    }
    const rows = db
      .prepare('SELECT id FROM markdown_documents WHERE status = ?')
      .all(filter.status) as Array<{ id: string }>;
    candidateSets.push(rows.map(r => r.id));
  }
  if (filter.statuses && filter.statuses.length > 0) {
    // 任一非法枚举 → 该维度空候选集(与单值行为一致)
    if (filter.statuses.some(s => !STATUS_SET.has(s))) {
      return null;
    }
    const placeholders = filter.statuses.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT id FROM markdown_documents WHERE status IN (${placeholders})`)
      .all(...filter.statuses) as Array<{ id: string }>;
    candidateSets.push(rows.map(r => r.id));
  }
  if (filter.documentType) {
    if (!TYPE_SET.has(filter.documentType)) {
      return null;
    }
    const rows = db
      .prepare('SELECT id FROM markdown_documents WHERE document_type = ?')
      .all(filter.documentType) as Array<{ id: string }>;
    candidateSets.push(rows.map(r => r.id));
  }
  if (filter.documentTypes && filter.documentTypes.length > 0) {
    if (filter.documentTypes.some(t => !TYPE_SET.has(t))) {
      return null;
    }
    const placeholders = filter.documentTypes.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT id FROM markdown_documents WHERE document_type IN (${placeholders})`)
      .all(...filter.documentTypes) as Array<{ id: string }>;
    candidateSets.push(rows.map(r => r.id));
  }
  if (filter.q) {
    const like = `%${filter.q.replace(/[%_]/g, m => '\\' + m)}%`;
    const rows = db
      .prepare(
        `SELECT id FROM markdown_documents
         WHERE title LIKE ? ESCAPE '\\' OR summary_text LIKE ? ESCAPE '\\'`,
      )
      .all(like, like) as Array<{ id: string }>;
    candidateSets.push(rows.map(r => r.id));
  }

  return candidateSets;
}

// ----- find 管线:Phase 2 求交 + 排序 -------------------------------------

/**
 * Phase 2:候选集求交(维度间 AND)+ 全量排序(不切片,切片由调用方做)。
 *
 * 无候选集(无任何过滤维度)→ 全表按选定顺序输出;
 * sort:'relevance' 但无 q → 降级为 recency(相关度无查询词可依)。
 */
export function orderCandidates(
  db: SqliteDatabase,
  candidateSets: string[][],
  opts: { q?: string; sort: 'recency' | 'relevance' | 'title' },
): string[] {
  if (candidateSets.length === 0) {
    // 无过滤 → 全量有序(与重构前 find 的无过滤 SQL 路径同序,仅去掉 LIMIT)
    const orderBy =
      opts.sort === 'title'
        ? 'title ASC, (updated IS NULL), updated DESC'
        : '(updated IS NULL), updated DESC, title ASC';
    const rows = db
      .prepare(`SELECT id FROM markdown_documents ORDER BY ${orderBy}`)
      .all() as Array<{ id: string }>;
    return rows.map(r => r.id);
  }

  candidateSets.sort((a, b) => a.length - b.length); // start from smallest
  let acc = new Set(candidateSets[0]!);
  for (let i = 1; i < candidateSets.length; i++) {
    const next = new Set(candidateSets[i]!);
    acc = new Set([...acc].filter(x => next.has(x)));
  }
  let finalIds = [...acc];

  if (opts.sort === 'title') {
    finalIds = sortByTitle(db, finalIds);
  } else if (opts.sort === 'relevance' && opts.q) {
    finalIds = sortByRelevance(db, finalIds, opts.q);
  } else {
    finalIds = sortByRecency(db, finalIds);
  }
  return finalIds;
}

function sortByRelevance(db: SqliteDatabase, ids: string[], q: string): string[] {
  if (ids.length === 0) return ids;
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id,
         (CASE WHEN title LIKE ? ESCAPE '\\' THEN 2 ELSE 0 END) +
         (CASE WHEN summary_text LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END) AS score
       FROM markdown_documents
       WHERE id IN (${placeholders})
       ORDER BY score DESC, (updated IS NULL), updated DESC, title ASC`,
    )
    .all(`%${q}%`, `%${q}%`, ...ids) as Array<{ id: string; score: number }>;
  return rows.map(r => r.id);
}

function sortByRecency(db: SqliteDatabase, ids: string[]): string[] {
  if (ids.length === 0) return ids;
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id FROM markdown_documents
       WHERE id IN (${placeholders})
       ORDER BY (updated IS NULL), updated DESC, title ASC`,
    )
    .all(...ids) as Array<{ id: string }>;
  return rows.map(r => r.id);
}

/** title ASC,并列 updated DESC(NULL 排最后,与 recency 的 NULL 语义一致)。 */
function sortByTitle(db: SqliteDatabase, ids: string[]): string[] {
  if (ids.length === 0) return ids;
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id FROM markdown_documents
       WHERE id IN (${placeholders})
       ORDER BY title ASC, (updated IS NULL), updated DESC`,
    )
    .all(...ids) as Array<{ id: string }>;
  return rows.map(r => r.id);
}

// ----- 引用计数 / 行解析 / hydrate ----------------------------------------

/**
 * 当页文档的引用计数(出向 + 入向)。
 *
 * 一条 IN 聚合查询(UNION ALL 出向/入向两侧后 GROUP BY),避免 N+1;
 * 自引用文档两侧各计一次,与 getReferences 的出/入双列语义一致。
 * 无引用的文档不在返回 Map 中(调用方 ?? 0)。
 */
export function referenceCountsForDocs(db: SqliteDatabase, ids: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT doc_id AS id, count(*) AS c FROM (
         SELECT source_document_id AS doc_id
           FROM markdown_document_references
           WHERE source_document_id IN (${placeholders})
         UNION ALL
         SELECT target_document_id AS doc_id
           FROM markdown_document_references
           WHERE target_document_id IN (${placeholders})
       ) GROUP BY doc_id`,
    )
    .all(...ids, ...ids) as Array<{ id: string; c: number }>;
  for (const r of rows) counts.set(r.id, r.c);
  return counts;
}

/** 按 ID 或项目相对路径解析文档(找不到返回 null)。 */
export function resolveDocument(db: SqliteDatabase, docIdOrPath: string): MarkdownDocumentRow | null {
  // 先按 ID 找
  const byId = db
    .prepare('SELECT * FROM markdown_documents WHERE id = ?')
    .get(docIdOrPath) as MarkdownDocumentRow | undefined;
  if (byId) return byId;

  // 再按路径找(兼容 Windows 调用方的反斜杠 → 正斜杠)
  const normalized = docIdOrPath.split('\\').join('/');
  const byPath = db
    .prepare('SELECT * FROM markdown_documents WHERE path = ?')
    .get(normalized) as MarkdownDocumentRow | undefined;
  return byPath ?? null;
}

/**
 * 按 id 取行并组装描述符(find 使用)。
 */
export function hydrateDescriptor(
  db: SqliteDatabase,
  id: string,
  q?: string,
): DocumentDescriptor {
  const doc = db
    .prepare('SELECT * FROM markdown_documents WHERE id = ?')
    .get(id) as MarkdownDocumentRow;
  return hydrateDescriptorFromRow(db, doc, q);
}

/** 从已持有的行记录组装描述符(find 与 findPaged 共用,输出形状一致)。 */
export function hydrateDescriptorFromRow(
  db: SqliteDatabase,
  doc: MarkdownDocumentRow,
  q?: string,
): DocumentDescriptor {
  return {
    id: doc.id,
    path: doc.path,
    title: doc.title,
    documentType: doc.document_type as DocumentDescriptor['documentType'],
    status: doc.status as DocumentDescriptor['status'],
    sourceType: doc.source_type as DocumentDescriptor['sourceType'],
    updatedAt: doc.updated,
    summary: doc.summary_text,
    concepts: vocabNamesForDoc(db, doc.id, 'markdown_document_concepts', 'concept_id'),
    domains: vocabNamesForDoc(db, doc.id, 'markdown_document_domains', 'domain_id'),
    tags: vocabNamesForDoc(db, doc.id, 'markdown_document_tags', 'tag_id'),
    score: q ? computeScore(doc, q) : undefined,
  };
}

/** getDocumentDetail 的详情组装(描述符 + owners/aliases/relatedCode/时间戳)。 */
export function hydrateDetail(db: SqliteDatabase, doc: MarkdownDocumentRow): DocumentDetail {
  return {
    ...hydrateDescriptor(db, doc.id),
    owners: parseJsonArray(doc.owners),
    aliases: parseJsonArray(doc.aliases),
    relatedCode: parseJsonArray(doc.related_code),
    createdAt: doc.created,
    indexedAt: doc.indexed_at,
  };
}

/** 文档关联的词表名列表(concepts/domains/tags 三种维度共用),按名字升序。 */
function vocabNamesForDoc(
  db: SqliteDatabase,
  docId: string,
  table: 'markdown_document_concepts' | 'markdown_document_domains' | 'markdown_document_tags',
  column: 'concept_id' | 'domain_id' | 'tag_id',
): string[] {
  const vocabTable = vocabTableFor(table);
  const rows = db
    .prepare(
      `SELECT v.name FROM ${table} x
       JOIN ${vocabTable} v ON v.id = x.${column}
       WHERE x.document_id = ?
       ORDER BY v.name ASC`,
    )
    .all(docId) as Array<{ name: string }>;
  return rows.map(r => r.name);
}

/** 相关度打分:标题命中 +2,摘要命中 +1(与 sortByRelevance 的 SQL 权重一致)。 */
function computeScore(doc: MarkdownDocumentRow, q: string): number {
  let score = 0;
  if (doc.title.includes(q)) score += 2;
  if (doc.summary_text.includes(q)) score += 1;
  return score;
}
