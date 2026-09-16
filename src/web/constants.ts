/**
 * web 层显示常量:标签映射(中文化)、分页页大小、类型色系归组。
 *
 * 标签映射为《知识库分类体系重设计-spec》§3.1 逐字表(web 需求 spec
 * 《cgraphx-web知识库浏览》修订后的 §3.3 与本表同步):芯片与徽标同时展示
 * 「中文 + 英文原值」,URL 参数始终用英文原值。
 */

import type { DocumentType, DocumentStatus } from '../core/markdown';
import type { EventType } from '../core/timeline';

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

// ----- 时间线页显示常量(spec §3.2 / §3.3 / §9 #4)--------------------------

/**
 * 5 种 timeline 事件类型的有序列表(spec §3.2 标签顺序,与设计稿 v2 chip 顺序一致)。
 * core/timeline 只导出 EventType 联合类型,无运行时有序数组——本数组为 web 层展示口径。
 */
export const TIMELINE_EVENT_TYPES = [
  'user_prompt',
  'pre_tool_use',
  'post_tool_use',
  'stop',
  'git_commit',
] as const satisfies readonly EventType[];

/** 时间线事件类型中文显示标签(spec §3.2 逐字)。 */
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  user_prompt: 'Prompt',
  pre_tool_use: '工具调用',
  post_tool_use: '工具完成',
  stop: 'Stop',
  git_commit: 'Git 提交',
};

/**
 * 事件类型对应的 chip 色调(对齐设计稿 v2 的 `.chip--prompt/pre/post/stop/git`)。
 * 同时用于事件行 evbadge 与 chip。
 */
export type EventTone = 'prompt' | 'pre' | 'post' | 'stop' | 'git';

export const EVENT_TYPE_CHIP_TONE: Record<EventType, EventTone> = {
  user_prompt: 'prompt',
  pre_tool_use: 'pre',
  post_tool_use: 'post',
  stop: 'stop',
  git_commit: 'git',
};
