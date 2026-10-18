/**
 * 产出目录 feature-id 的命名解析:日期前缀与目录任务名称。
 *
 * 无 task 模块依赖,供 feature-task 与 store 共用,避免
 * feature-task → store → feature-task 的运行时循环。
 */

/** feature-id 开头的日期前缀(YYYY-MM-DD)。 */
const DATE_PREFIX_PATTERN = /^(\d{4}-\d{2}-\d{2})-/;

/** feature-id 开头的日期前缀;取不到返回 null(视为最早)。 */
export function featureDatePrefix(featureId: string): string | null {
  return DATE_PREFIX_PATTERN.exec(featureId)?.[1] ?? null;
}

/** 目录任务名称:去掉日期前缀后的文件前缀;无日期前缀返回原值。 */
export function featureTaskName(featureId: string): string {
  const prefix = featureDatePrefix(featureId);
  return prefix === null ? featureId : featureId.slice(prefix.length + 1);
}
