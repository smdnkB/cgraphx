/**
 * web 层显示常量:标签映射(中文化)、分页页大小、类型色系归组。
 *
 * 标签映射为《知识库分类体系重设计-spec》§3.1 逐字表(web 需求 spec
 * 《cgraphx-web知识库浏览》修订后的 §3.3 与本表同步):芯片与徽标同时展示
 * 「中文 + 英文原值」,URL 参数始终用英文原值。
 */

import type { DocumentType, DocumentStatus } from '../core/markdown';

/** 列表页大小(plan index 第 4 节推荐:服务端分页 30/页)。 */
export const PAGE_SIZE = 30;

/** 概念面板平铺上限,第 13 个起收进原生 <details>(plan index 第 4 节推荐)。 */
export const CONCEPT_PANEL_TOP = 12;

/** 文档类型显示标签(分类体系 spec §3.1 逐字,7 条)。 */
export const TYPE_LABELS: Record<DocumentType, string> = {
  'business-entity': '业务实体',
  'business-flow': '业务流程',
  mechanism: '技术机制',
  decision: '决策',
  rule: '规则',
  lesson: '教训',
  guide: '指南',
};

/** 文档状态显示标签(spec §3.3 逐字,4 条)。 */
export const STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: '草稿',
  active: '现行',
  superseded: '已被替代',
  deprecated: '已废弃',
};

/**
 * 类型色系(7 种按语义归 4 个色系,同页同类型同色)。
 *
 * - entity (松绿):定义/结构类 —— business-entity、mechanism
 * - process (蓝):操作/流程类 —— business-flow、guide
 * - judgment (金):判断/约束类 —— decision、rule
 * - lesson (锈红):教训/风险类 —— lesson
 */
export type TypeTone = 'entity' | 'process' | 'judgment' | 'lesson';

export const TYPE_TONES: Record<DocumentType, TypeTone> = {
  'business-entity': 'entity',
  mechanism: 'entity',
  'business-flow': 'process',
  guide: 'process',
  decision: 'judgment',
  rule: 'judgment',
  lesson: 'lesson',
};
