/**
 * 产物注册表公共门面。
 *
 * 「文件 → 产物类型」的全部口径只在这里定义;特征/上报/展示等
 * 调用方必须经本门面,不得直接伸手进内部模块。
 */

export {
  FEATURES_DIR_POSIX,
  SEDIMENT_TYPE_ROOTS,
  SEDIMENT_DIR_PREFIXES,
  ARTIFACT_TYPE_KEY_PATTERN,
  BASIS_PATTERN,
  TASK_VALUE_PATTERN,
  HEADER_SCAN_LINES,
  ARTIFACT_MAPPING_VERSION,
  OWNER_SOURCE_TYPES,
} from './constants';
export {
  BUILTIN_ARTIFACT_TYPES,
  getBuiltinArtifactType,
  isValidArtifactTypeKey,
  featureIdOf,
  isTopLevelFeatureFile,
  isPlanIndexPath,
  classifyArtifactByPath,
  stageMilestoneOf,
  firstScreenHeadingOf,
  reportableTypeKeys,
} from './registry';
export { readArtifactHeader, readFirstH2Heading } from './header';
export { identifyArtifact } from './identify';
export { specFingerprint, parseBasis, basisMatches } from './fingerprint';
export type {
  ArtifactPhase,
  ReportTier,
  StageMilestone,
  BuiltinArtifactType,
  ArtifactHeader,
  ArtifactIdentity,
} from './types';
