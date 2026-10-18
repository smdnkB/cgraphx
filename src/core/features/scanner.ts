/**
 * features 索引扫描器。
 *
 * 单一职责:把 <project>/docs/features/ 下的每个子目录解析成一个
 * FeatureEntry。头部元数据(负责人/日期)优先级:spec 文件头部 > plan/index 头部 > 目录名。
 * spec 候选按主 spec 优先(文件长度升序)遍历,取第一个头部读出负责人的——
 * 避免派生 spec(接口测试-spec/单元测试-spec,含旧名 api-spec)遮蔽主 spec 导致负责人丢失。
 *
 * 头部行约定(与 write-spec / write-plan 的产物头部一致):
 *
 *   # 规格说明: <需求名称>
 *   > feature-id: <feature-id>
 *   > 负责人: 张三
 *   > 日期: YYYY-MM-DD
 *
 * 主 spec 头部的任务声明(`> 任务: <值>`)由 readFeatureTask / scanFeatureTasks 单独读取,
 * 不进 FeatureEntry。
 *
 * 需求阶段不读头部,由产物存在性派生(deriveStage):有测试报告 → 已验证,
 * 有 plan → 已规划,有 spec → 已规格,都没有 → null(未规格)。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { FeatureEntry, FeatureStage } from './types';

/** 扫描目录(仓库相对)。 */
export const FEATURES_DIR = path.join('docs', 'features');

/** feature-id 目录名:日期前缀 + 标题(标题可能含 [业务ID-] 段,不强行拆)。 */
const FEATURE_ID_PATTERN = /^(\d{4}-\d{2}-\d{2})-(.+)$/;

/** 只读文件头部这么多行找元数据,头部之后没有要解析的东西。 */
const HEADER_SCAN_LINES = 30;

interface HeaderMeta {
  owner: string | null;
  date: string | null;
}

/** 从文件头部提取 负责人/日期;读不了或没有都返回 null 字段(容错)。 */
function readHeaderMeta(file: string): HeaderMeta {
  const meta: HeaderMeta = { owner: null, date: null };
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch {
    return meta;
  }
  const lines = text.split('\n').slice(0, HEADER_SCAN_LINES);
  for (const line of lines) {
    const m = /^>\s*(负责人|日期)\s*[:：]\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1];
    const value = m[2];
    if (!key || value === undefined || value === '') continue;
    if (key === '负责人') meta.owner = value;
    else meta.date = value;
  }
  return meta;
}

/** plan/ 子目录里是否有 index 文件(*-index.md 或 index.md)。 */
function hasPlanIndex(featureDir: string): boolean {
  try {
    return fs
      .readdirSync(path.join(featureDir, 'plan'))
      .some((n) => n.endsWith('-index.md') || n === 'index.md');
  } catch {
    return false;
  }
}

/**
 * ui功能测试/ 子目录里是否有 UI 功能测试报告:*-ui功能测试报告.xlsx(现行)
 * 或 *-ui功能测试报告.md(存量兼容)。结构化结果 JSON、截图不算报告。
 */
function hasUiTestReport(featureDir: string): boolean {
  try {
    return fs
      .readdirSync(path.join(featureDir, 'ui功能测试'))
      .some((n) => n.endsWith('-ui功能测试报告.md') || n.endsWith('-ui功能测试报告.xlsx'));
  } catch {
    return false;
  }
}

/**
 * spec 候选排序:主 spec 优先。主 spec `<前缀>-spec.md`(或 `spec.md`)恒短于
 * 同前缀的派生 spec(`<前缀>-接口测试-spec.md` / `<前缀>-单元测试-spec.md`,
 * 含旧名 `<前缀>-api-spec.md`,文件名多一段),
 * 按「长度升序、同名再按字典序」排,主 spec 必排最前。
 */
function compareSpecCandidates(a: string, b: string): number {
  return a.length - b.length || a.localeCompare(b);
}

/**
 * 认定需求目录的主 spec(读 负责人 / 任务 共用):*-spec.md(或 spec.md)候选按主 spec
 * 优先遍历,取第一个头部读出负责人的——主 spec 头部残缺时仍可能从其他候选读出,
 * 且派生 spec 不再遮蔽主 spec(api-spec 的 'a' 字典序曾排在主 spec 的 's' 前,
 * 导致负责人恒丢失)。都读不出负责人取排序后的第一个;没有 spec → null。
 */
function findMainSpec(featureDir: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(featureDir);
  } catch {
    return null;
  }
  const specs = entries
    .filter((n) => n.endsWith('-spec.md') || n === 'spec.md')
    .sort(compareSpecCandidates);
  let first: string | null = null;
  for (const name of specs) {
    const file = path.join(featureDir, name);
    if (first === null) first = file;
    if (readHeaderMeta(file).owner !== null) return file;
  }
  return first;
}

/**
 * 在一个 feature 目录里找元数据文件(读 负责人/日期 用):先主 spec(findMainSpec),
 * 再 plan/*-index.md(或 plan/index.md)。都没有 → null(仅目录名可解析)。
 */
function findMetaFile(featureDir: string): string | null {
  const mainSpec = findMainSpec(featureDir);
  if (mainSpec !== null) return mainSpec;
  try {
    const planEntries = fs.readdirSync(path.join(featureDir, 'plan'));
    const index = planEntries
      .filter((n) => n.endsWith('-index.md') || n === 'index.md')
      .sort(compareSpecCandidates)[0];
    if (index) {
      return path.join(featureDir, 'plan', index);
    }
  } catch {
    // 没有 plan 目录,落到目录名解析
  }
  return null;
}

/**
 * 从需求目录的产物存在性派生阶段(实时,不落盘):
 *   有测试报告 → 已验证;否则有 plan → 已规划;否则有 spec → 已规格;都没有 → null(未规格)。
 *
 * 优先级 已验证 > 已规划 > 已规格,三个里程碑各自独立探测(允许跨阶,
 * 如 spec + 测试报告但无 plan → 已验证)。已验证只看测试「报告」(run-api-test
 * 的 *-接口测试报告.md / write-unit-test-code 的 *-单元测试报告.md / run-ui-test
 * 的 ui功能测试/*-ui功能测试报告.xlsx|.md(子目录产物,md 为存量);2026-08 改名前的旧名
 * *-测试报告.md 仍识别,存量产物不回退),测试「规格」不算。
 */
function deriveStage(featureDir: string): FeatureStage | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(featureDir);
  } catch {
    return null;
  }
  const hasReport =
    entries.some(
      (n) =>
        n.endsWith('-单元测试报告.md') ||
        n.endsWith('-接口测试报告.md') ||
        n.endsWith('-测试报告.md'),
    ) || hasUiTestReport(featureDir);
  if (hasReport) return '已验证';
  if (hasPlanIndex(featureDir)) return '已规划';
  const hasSpec = entries.some(
    (n) => n.endsWith('-spec.md') || n === 'spec.md',
  );
  if (hasSpec) return '已规格';
  return null;
}

/**
 * 扫描 <projectRoot>/docs/features/,每个子目录解析为一个 FeatureEntry。
 * 目录不存在或不可读 → 返回空数组(不是错误:项目可能没用 features 流程)。
 * 负责人与任务负责人同一口径(readFeatureOwner:主 spec → 交接文件),都没有时才取 plan index 头部,
 * 所以只有交接文件的目录也进「我的需求」。
 * 结果按日期倒序、标题升序排好。
 */
export function scanFeatures(projectRoot: string): FeatureEntry[] {
  const featuresRoot = path.join(projectRoot, FEATURES_DIR);
  let dirNames: string[];
  try {
    dirNames = fs
      .readdirSync(featuresRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }

  const posixFeaturesDir = FEATURES_DIR.split(path.sep).join('/');
  const result: FeatureEntry[] = [];
  for (const name of dirNames) {
    const m = FEATURE_ID_PATTERN.exec(name);
    const dateFromName = m?.[1] ?? null;
    const title = m?.[2] ?? name;
    const featureDir = path.join(featuresRoot, name);
    const metaFile = findMetaFile(featureDir);
    const meta = metaFile
      ? readHeaderMeta(metaFile)
      : { owner: null, date: null };
    result.push({
      featureId: name,
      date: meta.date ?? dateFromName,
      title,
      owner: readFeatureOwner(projectRoot, name) ?? meta.owner,
      stage: deriveStage(featureDir),
      path: `${posixFeaturesDir}/${name}`,
    });
  }
  result.sort(
    (a, b) =>
      (b.date ?? '').localeCompare(a.date ?? '') ||
      a.title.localeCompare(b.title),
  );
  return result;
}

/** 主 spec 头部的任务声明行(`> 任务: <值>`,全角冒号也认)。 */
const TASK_HEADER_PATTERN = /^>\s*任务\s*[:：]\s*(.*?)\s*$/;

/** feature-id 只能是 docs/features/ 下的单段目录名。 */
function isPlainFeatureId(featureId: string): boolean {
  return (
    featureId !== '' &&
    featureId !== '.' &&
    featureId !== '..' &&
    !featureId.includes('/') &&
    !featureId.includes('\\')
  );
}

/**
 * 读需求目录主 spec 头部声明的任务值(spec §6.1)。
 *
 * 主 spec 的认定与读负责人相同(findMainSpec),不回退到 plan/index——任务只在 spec 里声明。
 * 头部 30 行内只认第一条 `> 任务:` 行;值为空等同于未声明。目录 / spec 不存在或读不了 → null。
 */
export function readFeatureTask(projectRoot: string, featureId: string): string | null {
  if (!isPlainFeatureId(featureId)) return null;
  const mainSpec = findMainSpec(path.join(projectRoot, FEATURES_DIR, featureId));
  if (mainSpec === null) return null;
  let text: string;
  try {
    text = fs.readFileSync(mainSpec, 'utf-8');
  } catch {
    return null;
  }
  for (const line of text.split('\n').slice(0, HEADER_SCAN_LINES)) {
    const m = TASK_HEADER_PATTERN.exec(line);
    if (!m) continue;
    const value = (m[1] ?? '').trim();
    return value === '' ? null : value;
  }
  return null;
}

/**
 * 读产出目录负责人(spec §2、§4.2):主 spec 头部 `> 负责人:` 优先;
 * 主 spec 没有该行(或没有主 spec)时,回退到交接文件 `<前缀>-交接提示词.md` 头部。
 * 多个交接文件按 compareSpecCandidates 取第一个,不再向后找。
 * 目录 / 文件不存在或都没有负责人 → null。
 */
export function readFeatureOwner(projectRoot: string, featureId: string): string | null {
  if (!isPlainFeatureId(featureId)) return null;
  const featureDir = path.join(projectRoot, FEATURES_DIR, featureId);

  const mainSpec = findMainSpec(featureDir);
  if (mainSpec !== null) {
    const owner = readHeaderMeta(mainSpec).owner;
    if (owner !== null) return owner;
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(featureDir);
  } catch {
    return null;
  }
  const handoff = entries
    .filter((n) => n.endsWith('-交接提示词.md'))
    .sort(compareSpecCandidates)[0];
  if (handoff === undefined) return null;
  return readHeaderMeta(path.join(featureDir, handoff)).owner;
}

/**
 * 扫描 docs/features/ 下所有主 spec 声明了任务的需求目录(只列有声明的)。
 * path 为仓库相对 POSIX 路径(与 FeatureEntry.path 同格式)。目录不存在 → 空数组。
 */
export function scanFeatureTasks(
  projectRoot: string,
): Array<{ featureId: string; path: string; task: string }> {
  let dirNames: string[];
  try {
    dirNames = fs
      .readdirSync(path.join(projectRoot, FEATURES_DIR), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
  const posixFeaturesDir = FEATURES_DIR.split(path.sep).join('/');
  const result: Array<{ featureId: string; path: string; task: string }> = [];
  for (const name of dirNames) {
    const task = readFeatureTask(projectRoot, name);
    if (task !== null) {
      result.push({ featureId: name, path: `${posixFeaturesDir}/${name}`, task });
    }
  }
  return result;
}
