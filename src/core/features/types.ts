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
  /** 目录名,即 feature-id(格式 YYYY-MM-DD-[业务ID-]<标题>)。 */
  featureId: string;
  /** 从目录名或文档头部解析的日期;解析不到为 null。 */
  date: string | null;
  /** 需求标题(目录名去掉日期前缀)。 */
  title: string;
  /** 负责人(`> 负责人:` 行,依次取主 spec → 交接文件 → plan index 头部);都未声明为 null。 */
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
