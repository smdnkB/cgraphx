/**
 * features 子系统的类型定义。
 *
 * 无 DB、无 schema:索引是 docs/features/ 目录树的纯派生视图,
 * 每次查询实时扫描文件系统,永不持久化——不会陈旧。
 */

/** 需求阶段:由 docs/features/ 产物存在性实时派生,不写入任何文件。 */
export const FEATURE_STAGES = ['已规格', '已规划', '已验证'] as const;

/** 派生阶段类型(null = 未规格,无任何可识别产物)。 */
export type FeatureStage = (typeof FEATURE_STAGES)[number];

/** 一个需求目录的索引条目。 */
export interface FeatureEntry {
  /** 目录名,即 feature-id(默认格式 YYYY-MM-DD-[业务ID-]<标题>,项目可在 docs/guides/feature-standards.md 自定义)。 */
  featureId: string;
  /** 从目录名或文档头部解析的日期;解析不到为 null。 */
  date: string | null;
  /** 需求标题(目录名去掉日期段)。 */
  title: string;
  /** 负责人(`> 负责人:` 行,取主 spec → 交接文件;都未声明为 null)。 */
  owner: string | null;
  /** 派生阶段(已规格/已规划/已验证);无可识别产物为 null(未规格)。 */
  stage: FeatureStage | null;
  /** 仓库相对 POSIX 路径,如 docs/features/2026-07-26-X。 */
  path: string;
}

/** list 的过滤条件;全部可选,多条件取交集。 */
export interface FeatureFilter {
  /** 负责人精确匹配(大小写敏感)。 */
  owner?: string;
  /** 标题 / feature-id 子串匹配。 */
  q?: string;
  /** 阶段精确匹配(已规格 / 已规划 / 已验证)。 */
  stage?: string;
}

// ─── features show ──────────────────────────────────────────────────────────

/** 派生产物 `> 依据:` 相对主 spec 当前指纹的状态(§6.2)。 */
export type BasisState =
  | { kind: 'fresh' }
  | { kind: 'stale'; recorded: string; current: string }
  | { kind: 'no_main_spec' }
  | { kind: 'invalid' }
  | { kind: 'none' };

/** show 产物列表的一行。path 为产出目录内相对路径。 */
export interface FeatureArtifactRow {
  path: string;
  type: string;
  typeName: string | null;
  via: 'header' | 'path';
  basis: BasisState;
}

/** show 的五个平台环节(知识经验不入环节)。 */
export type FeaturePhase = 'design' | 'plan' | 'test' | 'release' | 'delivery';

/** show 平台环节的一行。paths 为产出目录内相对路径。 */
export interface FeaturePhaseRow {
  phase: FeaturePhase;
  name: string;
  paths: string[];
  required: boolean;
}

/** `features show` 的完整结果(文本与 --json 同源)。 */
export interface FeatureDetail {
  featureId: string;
  /** docs/features/<featureId> */
  path: string;
  owner: string | null;
  task: string | null;
  stage: FeatureStage | null;
  /** 产出目录内相对路径。 */
  mainSpec: string | null;
  /** 主 spec 指纹前 7 位。 */
  specFingerprint: string | null;
  artifacts: FeatureArtifactRow[];
  phases: FeaturePhaseRow[];
  customTypes: Array<{ type: string; paths: string[] }>;
  /** 产出目录内相对路径。 */
  otherFiles: string[];
}

// ─── features check ─────────────────────────────────────────────────────────

/** check 结果码。 */
export type CheckCode =
  | 'missing_type'
  | 'invalid_type'
  | 'missing_owner'
  | 'missing_basis'
  | 'invalid_basis'
  | 'invalid_task'
  | 'first_screen'
  | 'stale'
  | 'unknown_type'
  | 'type_path_mismatch';

/** check 的一条结果;path 为项目相对 POSIX 路径。 */
export interface CheckFinding {
  level: 'fail' | 'warn';
  path: string;
  code: CheckCode;
  message: string;
  fix: string | null;
}

/** `features check --json` 的结构(契约 C-7)。 */
export interface CheckReport {
  ok: boolean;
  checkedFiles: number;
  failures: number;
  warnings: number;
  findings: CheckFinding[];
}
