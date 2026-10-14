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
  session_start: '会话开始',
  session_end: '会话结束',
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
  session_start: 'stop',
  session_end: 'stop',
};

// ----- schema-knowledge 模型知识库预览(2026-09-16-cgraphx-web数据库预览)-----

/**
 * schema-knowledge 根目录(相对 projectRoot)。
 *
 * export-table-ddl skill 建基线的产物目录:每工程一个子目录,内含 INDEX.md +
 * ddl/*.sql(DDL 本体 + 末尾 DISCOVERED 块)。web 仅只读消费,不连库、不进
 * `.cgraphx/cgraphx.db`(spec §4.1:纯目录树实时派生,形态同 features 子系统)。
 */
export const SCHEMA_KNOWLEDGE_DIR = 'docs/schema-knowledge';

/**
 * 经验标签枚举(as const 数组 + 联合类型,不用 TS enum——coding-standards「选型」)。
 *
 * DISCOVERED 块内 `-- [标签]` 行首前缀的六类固定标签;`其他` 为聚合兜底,
 * 收纳无标签行 / 非六类标签(如 `[流程]`)/ 块未闭合残余(spec §3.5 容错)。
 */
export const INSIGHT_TAGS = ['定位', '关系', '陷阱', '样本', '索引', '性能', '其他'] as const;

/** 经验标签类型。 */
export type InsightTag = (typeof INSIGHT_TAGS)[number];


/**
 * 代码地图根目录(相对 projectRoot)。
 *
 * code-map-write skill 的产物目录:根目录放系统交互视图(`系统交互.md` /
 * `系统交互-<域>.md`),`flows/` 放流程视图。web 仅只读消费(2026-10-14-cgraphx-web系统地图)。
 */
export const CODE_MAP_DIR = 'docs/code-map';

/** 流程视图子目录名(位于 CODE_MAP_DIR 下)。 */
export const CODE_MAP_FLOWS_SUBDIR = 'flows';

/** 过期判定 git 调用超时(毫秒);超时视为无法判断。 */
export const CODE_MAP_GIT_TIMEOUT_MS = 3000;
