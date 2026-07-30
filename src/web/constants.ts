/**
 * web 层显示常量:标签映射(中文化)、分页页大小、类型色系归组。
 *
 * 标签映射为 spec §3.3 逐字表(plan index §7.6):芯片与徽标同时展示
 * 「中文 + 英文原值」,URL 参数始终用英文原值。
 */

import type { DocumentType, DocumentStatus } from '../core/markdown';

/** 列表页大小(plan index 第 4 节推荐:服务端分页 30/页)。 */
export const PAGE_SIZE = 30;

/** 概念面板平铺上限,第 13 个起收进原生 <details>(plan index 第 4 节推荐)。 */
export const CONCEPT_PANEL_TOP = 12;

/** 文档类型显示标签(spec §3.3 逐字,17 条)。 */
export const TYPE_LABELS: Record<DocumentType, string> = {
  concept: '实体概念',
  decision: '决策',
  rule: '规则',
  lesson: '教训',
  warning: '警示',
  finding: '发现',
  analysis: '分析',
  exploration: '探索',
  note: '笔记',
  runbook: '运维手册',
  installation: '安装部署',
  api: 'API',
  faq: 'FAQ',
  architecture: '架构',
  guide: '指南',
  tutorial: '教程',
  conversation: '对话',
};

/** 文档状态显示标签(spec §3.3 逐字,4 条)。 */
export const STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: '草稿',
  active: '现行',
  superseded: '已被替代',
  deprecated: '已废弃',
};

/**
 * 类型色系(允许局部适配:17 种按语义归 5 个色系,同页同类型同色)。
 *
 * - entity (松绿):定义/结构类 —— concept、architecture
 * - process (蓝):操作/流程类 —— guide、tutorial、runbook、installation、api
 * - judgment (金):判断/分析类 —— decision、rule、finding、analysis
 * - lesson (锈红):教训/风险类 —— lesson、warning
 * - record (橙):记录/对话类 —— note、conversation、exploration、faq
 */
export type TypeTone = 'entity' | 'process' | 'judgment' | 'lesson' | 'record';

export const TYPE_TONES: Record<DocumentType, TypeTone> = {
  concept: 'entity',
  architecture: 'entity',
  guide: 'process',
  tutorial: 'process',
  runbook: 'process',
  installation: 'process',
  api: 'process',
  decision: 'judgment',
  rule: 'judgment',
  finding: 'judgment',
  analysis: 'judgment',
  lesson: 'lesson',
  warning: 'lesson',
  note: 'record',
  conversation: 'record',
  exploration: 'record',
  faq: 'record',
};
