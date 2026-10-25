/**
 * feature-id 解析:日期段与标题。
 *
 * 单一职责:从需求目录名(feature-id)里取出日期段,以及去掉日期段后的标题。
 * 规则引 spec D4:日期段 = 目录名里第一个前后紧挨连字符(或位于名字首尾)的
 * `YYYY-MM-DD`(4-2-2 位数字,不校验日期是否真实存在);标题 = 去掉日期段,
 * 以及它与相邻段之间的一个连字符。没有日期段、或去掉后为空(目录名就是一个
 * 日期)→ date 为 null、title 取原名。
 *
 * 扫描器(scanner)与 task 的目录任务命名(feature-name.ts)共用这一份实现,
 * 规则只在这里落地。
 */

/** 目录名解析结果。 */
export interface ParsedFeatureId {
  /** 目录名里的日期段(YYYY-MM-DD);没有日期段为 null。 */
  date: string | null;
  /** 去掉日期段后的标题;没有日期段(或去掉后为空)时等于 featureId。 */
  title: string;
}

/**
 * 日期段:4-2-2 位数字,前面是名字开头或连字符,后面是名字结尾或连字符。
 *
 * 两侧的边界写进正则本身:不合格的候选(如 `PRJ-2024-11-2026-10-25` 里的
 * `2024-11-20`)整体匹配失败,不会吞掉后面真正日期段的字符;先找到的就是
 * 第一个日期段。非全局正则,exec 不带 lastIndex 状态。
 */
const DATE_SEGMENT_PATTERN = /(?:^|-)(\d{4}-\d{2}-\d{2})(?=-|$)/;

/** 解析 feature-id:取目录名里第一段日期与去掉它之后的标题。 */
export function parseFeatureId(featureId: string): ParsedFeatureId {
  const match = DATE_SEGMENT_PATTERN.exec(featureId);
  const date = match?.[1];
  if (match === null || date === undefined) return { date: null, title: featureId };
  // 匹配可能带着前导连字符,日期段本身从去掉它之后算起。
  const start = match.index + match[0].length - date.length;
  const end = start + date.length;
  // 在开头:去掉日期段与它后面的那个连字符;
  // 否则:去掉日期段与它前面的那个连字符(末尾时等价于整段去掉)。
  const title =
    start === 0
      ? featureId.slice(end + 1)
      : featureId.slice(0, start - 1) + featureId.slice(end);
  if (title === '') return { date: null, title: featureId };
  return { date, title };
}
