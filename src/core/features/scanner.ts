/**
 * features 索引扫描器。
 *
 * 单一职责:把 <project>/docs/features/ 下的每个子目录解析成一个
 * FeatureEntry。头部元数据(负责人/日期)优先级:spec 文件头部 > plan/index 头部 > 目录名。
 * spec 候选按主 spec 优先(文件长度升序)遍历,取第一个头部读出负责人的——
 * 避免派生 spec(api-spec/单元测试-spec)遮蔽主 spec 导致负责人丢失。
 *
 * 头部行约定(与 write-spec / write-plan 的产物头部一致):
 *
 *   # 规格说明: <需求名称>
 *   > feature-id: <feature-id>
 *   > 负责人: 张三
 *   > 日期: YYYY-MM-DD
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
 * spec 候选排序:主 spec 优先。主 spec `<前缀>-spec.md`(或 `spec.md`)恒短于
 * 同前缀的派生 spec(`<前缀>-api-spec.md` / `<前缀>-单元测试-spec.md`,文件名多一段),
 * 按「长度升序、同名再按字典序」排,主 spec 必排最前。
 */
function compareSpecCandidates(a: string, b: string): number {
  return a.length - b.length || a.localeCompare(b);
}

/**
 * 在一个 feature 目录里找元数据文件(读 负责人/日期 用):先 *-spec.md(或 spec.md),
 * 再 plan/*-index.md(或 plan/index.md)。都没有 → null(仅目录名可解析)。
 *
 * spec 候选按主 spec 优先遍历,取第一个头部读出负责人的——主 spec 头部残缺时
 * 仍可能从其他候选读出,且派生 spec 不再遮蔽主 spec(api-spec 的 'a' 字典序
 * 曾排在主 spec 的 's' 前,导致负责人恒丢失)。
 */
function findMetaFile(featureDir: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(featureDir);
  } catch {
    return null;
  }
  const specs = entries
    .filter((n) => n.endsWith('-spec.md') || n === 'spec.md')
    .sort(compareSpecCandidates);
  let mainSpec: string | null = null;
  for (const name of specs) {
    const file = path.join(featureDir, name);
    if (mainSpec === null) mainSpec = file;
    if (readHeaderMeta(file).owner !== null) return file;
  }
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
 * 的 *-测试报告.md / write-unit-test-code 的 *-单元测试报告.md),测试「规格」不算。
 */
function deriveStage(featureDir: string): FeatureStage | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(featureDir);
  } catch {
    return null;
  }
  const hasReport = entries.some(
    (n) => n.endsWith('-单元测试报告.md') || n.endsWith('-测试报告.md'),
  );
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
      owner: meta.owner,
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
