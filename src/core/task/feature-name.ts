/**
 * 产出目录 feature-id 的命名解析:日期段与目录任务名称。
 *
 * 无 task 模块依赖,供 feature-task 与 store 共用,避免
 * feature-task → store → feature-task 的运行时循环。
 * 解析规则统一落在 features 门面的 parseFeatureId,这里只做转发。
 */

import { parseFeatureId } from '../features';

/** feature-id 里的日期段(YYYY-MM-DD);取不到返回 null(视为最早)。 */
export function featureDatePrefix(featureId: string): string | null {
  return parseFeatureId(featureId).date;
}

/** 目录任务名称:去掉日期段后的文件前缀;无日期段返回原值。 */
export function featureTaskName(featureId: string): string {
  return parseFeatureId(featureId).title;
}
