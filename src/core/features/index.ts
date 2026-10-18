/**
 * features 子系统公共门面。
 *
 * 外部调用方(CLI)必须用它 —— 不得直接伸手进 scanner 内部。
 * 与其他子系统的差别:无 DB、无 schema,索引是 docs/features/
 * 目录树的实时派生视图。
 */

import { scanFeatures } from './scanner';
import type { FeatureEntry, FeatureFilter } from './types';

export type { FeatureEntry, FeatureFilter } from './types';
export {
  scanFeatures,
  readFeatureTask,
  readFeatureOwner,
  scanFeatureTasks,
  FEATURES_DIR,
} from './scanner';
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

/** 扫描 + 过滤一步到位。 */
export function listFeatures(
  projectRoot: string,
  filter: FeatureFilter = {},
): FeatureEntry[] {
  return filterFeatures(scanFeatures(projectRoot), filter);
}
