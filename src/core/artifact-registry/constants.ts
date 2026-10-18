/**
 * 产物注册表的常量。
 *
 * 路径规则或识别口径变化时,`ARTIFACT_MAPPING_VERSION` 必须 +1。
 */

/** 需求产出目录(项目相对 POSIX 路径)。 */
export const FEATURES_DIR_POSIX = 'docs/features';

/** 四个沉淀目录与对应产物类型的映射(顺序即 SEDIMENT_DIR_PREFIXES 的顺序)。 */
export const SEDIMENT_TYPE_ROOTS = {
  knowledge: 'docs/knowledge/',
  schema_knowledge: 'docs/schema-knowledge/',
  code_map: 'docs/code-map/',
  design_map: 'docs/design-map/',
} as const;

/** 沉淀目录前缀,按注册表中的顺序排列。 */
export const SEDIMENT_DIR_PREFIXES = [
  'docs/knowledge/',
  'docs/schema-knowledge/',
  'docs/code-map/',
  'docs/design-map/',
] as const;

/** 合法类型标识:小写字母、数字、下划线,长度 1–64。 */
export const ARTIFACT_TYPE_KEY_PATTERN = /^[a-z0-9_]{1,64}$/;

/** 合法依据写法:`spec@` 加 7–40 位十六进制前缀。 */
export const BASIS_PATTERN = /^spec@([0-9a-fA-F]{7,40})$/;

/** 平台任务编号:`T-<n>`。 */
export const TASK_VALUE_PATTERN = /^T-\d+$/;

/** 头部扫描窗口:找一级标题、标题后的引用行、html 注释各看这么多行。 */
export const HEADER_SCAN_LINES = 30;

/** 路径规则或识别口径变化时 +1。 */
export const ARTIFACT_MAPPING_VERSION = 2;

/** 负责人只在主 spec、交接文件上生效。 */
export const OWNER_SOURCE_TYPES = ['spec', 'handoff'] as const;
