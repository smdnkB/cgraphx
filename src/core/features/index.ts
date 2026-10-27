/**
 * features 子系统公共门面。
 *
 * 外部调用方(CLI)必须用它 —— 不得直接伸手进 scanner 内部。
 * 与其他子系统的差别:无 DB、无 schema,索引是 docs/features/
 * 目录树的实时派生视图。主目录的 listFeatures 另外列出在用副本里
 * 登记的需求(spec D30,副本登记只经 replica 门面读)。
 */

import { resolveDataDir } from '../directory';
import { listReplicas } from '../replica';
import { compareFeatureEntries, scanFeature, scanFeatures } from './scanner';
import type { FeatureEntry, FeatureFilter } from './types';

export type {
  FeatureEntry,
  FeatureFilter,
  FeatureStage,
  BasisState,
  FeatureArtifactRow,
  FeaturePhase,
  FeaturePhaseRow,
  FeatureDetail,
  CheckCode,
  CheckFinding,
  CheckReport,
} from './types';
export {
  scanFeatures,
  readFeatureTask,
  readFeatureOwner,
  scanFeatureTasks,
  FEATURES_DIR,
} from './scanner';
export { parseFeatureId } from './feature-id';
export type { ParsedFeatureId } from './feature-id';
export { showFeature, resolveFeatureId } from './show';
export { checkFeatures } from './check';
export type { CheckOptions } from './check';
export {
  FeaturesError,
  FeatureNotFoundError,
  FeatureAmbiguousError,
  CheckTargetNotFoundError,
  exitCodeForError,
  exitCodeForCheckReport,
} from './errors';
export { gitUserName } from './sync';

/** 按 owner / q / stage 过滤(多条件取交集;空条件不过滤)。 */
export function filterFeatures(
  entries: FeatureEntry[],
  filter: FeatureFilter,
): FeatureEntry[] {
  return entries.filter((e) => {
    if (filter.owner !== undefined && (e.owner ?? '') !== filter.owner) {
      return false;
    }
    if (filter.stage !== undefined && (e.stage ?? '') !== filter.stage) {
      return false;
    }
    if (
      filter.q !== undefined &&
      filter.q !== '' &&
      !e.title.includes(filter.q) &&
      !e.featureId.includes(filter.q)
    ) {
      return false;
    }
    return true;
  });
}

/**
 * 主目录的条目加上在用副本里登记的需求(spec D30):每个副本只解析它登记的那个需求目录,
 * 阶段、负责人取副本的目录树,条目带上 replica。副本目录或其中的需求目录已不在时
 * scanFeature 返回 null,跳过。主目录里有同一 featureId 的条目就换成副本那份,
 * 同一 featureId 只出一行。没有可列的副本 → 原样返回 own。
 */
function withReplicaFeatures(
  projectRoot: string,
  own: FeatureEntry[],
): FeatureEntry[] {
  const byId = new Map(
    own.map((e): [string, FeatureEntry] => [e.featureId, e]),
  );
  let added = false;
  for (const replica of listReplicas(projectRoot)) {
    const entry = scanFeature(replica.path, replica.featureId);
    if (entry === null) continue;
    byId.set(entry.featureId, {
      ...entry,
      replica: { name: replica.name, path: replica.path },
    });
    added = true;
  }
  return added ? [...byId.values()].sort(compareFeatureEntries) : own;
}

/**
 * 扫描 + 过滤一步到位。在主目录(数据目录是项目自己的)另外列出在用副本里登记的需求;
 * 在副本里只列副本自己的目录树,条目都不带 replica(spec D30)。
 */
export function listFeatures(
  projectRoot: string,
  filter: FeatureFilter = {},
): FeatureEntry[] {
  const own = scanFeatures(projectRoot);
  const entries =
    resolveDataDir(projectRoot).state === 'own'
      ? withReplicaFeatures(projectRoot, own)
      : own;
  return filterFeatures(entries, filter);
}
