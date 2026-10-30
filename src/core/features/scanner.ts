/**
 * features 索引扫描器。
 *
 * 单一职责:把 <project>/docs/features/ 下的每个子目录解析成一个
 * FeatureEntry。产物识别一律经产物注册表(头部优先,否则路径规则),
 * 本模块不另写类型表或路径规则。
 *
 * 负责人口径(spec §5):主 spec 的 `> 负责人:`;主 spec 不存在或没写时,
 * 回退到交接文件的 `> 负责人:`;都没有 → null(不回退 plan/index)。
 * 主 spec = 产出目录顶层、注册表类型为 spec 的文件(测试规格不算);
 * 多个时按文件名长度升序、同长按字典序,取第一个读得出负责人的。
 *
 * 日期:主 spec 头部的 `> 日期:`(沿用 readHeaderMeta),否则 plan/index
 * 文件头部,再否则目录名。带 `> 产物:` 的文件,负责人 / 任务只从注册表
 * 头部读;没有 `> 产物:` 的旧文件沿用原有前 30 行口径。
 *
 * 主 spec 头部的任务声明(`> 任务: <值>`)由 readFeatureTask / scanFeatureTasks 单独读取,
 * 不进 FeatureEntry。
 *
 * 需求阶段不读状态,由产物存在性经注册表里程碑派生(deriveFeatureStage):
 * 有测试报告 → 已验证,有 plan/index → 已规划,有顶层规格类文件 → 已规格,都没有 → null。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  FEATURES_DIR_POSIX,
  HEADER_SCAN_LINES,
  OWNER_SOURCE_TYPES,
  identifyArtifact,
  isTopLevelFeatureFile,
  readArtifactHeader,
  stageMilestoneOf,
} from '../artifact-registry';
import { parseFeatureId } from './feature-id';
import type { FeatureEntry, FeatureStage } from './types';

/** 扫描目录(仓库相对,按当前平台分隔符)。 */
export const FEATURES_DIR = path.join(...FEATURES_DIR_POSIX.split('/'));

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

/** 项目相对 POSIX 路径 → 绝对路径。 */
function absolutePath(projectRoot: string, projectRelPath: string): string {
  return path.join(projectRoot, ...projectRelPath.split('/'));
}

/**
 * 旧文件(没有 `> 产物:` 行)的任务声明:前 30 行内第一条 `> 任务:` 行,
 * 空值等同于未声明。读不了 → null。
 */
const TASK_HEADER_PATTERN = /^>\s*任务\s*[:：]\s*(.*?)\s*$/;

function readLegacyTaskLine(file: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
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
 * 读文件声明的负责人:有 `> 产物:` 行时只认注册表头部;否则沿用旧口径
 * (前 30 行内最后一条 `> 负责人:`)。读不了 → null。
 */
function ownerOf(projectRoot: string, projectRelPath: string): string | null {
  const absPath = absolutePath(projectRoot, projectRelPath);
  const header = readArtifactHeader(absPath);
  if (header !== null && header.typeRaw !== null) return header.owner;
  return readHeaderMeta(absPath).owner;
}

/**
 * 读文件声明的任务:有 `> 产物:` 行时只认注册表头部;否则沿用旧口径
 * (前 30 行内第一条 `> 任务:`)。读不了 → null。
 */
function taskOf(projectRoot: string, projectRelPath: string): string | null {
  const absPath = absolutePath(projectRoot, projectRelPath);
  const header = readArtifactHeader(absPath);
  if (header !== null && header.typeRaw !== null) return header.task;
  return readLegacyTaskLine(absPath);
}

/**
 * 候选排序:主 spec 优先。主 spec `<前缀>-spec.md`(或 `spec.md`)恒短于
 * 同前缀的派生 spec(`<前缀>-接口测试-spec.md` / `<前缀>-单元测试-spec.md`,
 * 含旧名 `<前缀>-api-spec.md`,文件名多一段),
 * 按「长度升序、同名再按字典序」排,主 spec 必排最前。
 */
function compareSpecCandidates(a: string, b: string): number {
  return a.length - b.length || a.localeCompare(b);
}

/** feature-id 只能是 docs/features/ 下的单段目录名。 */
export function isPlainFeatureId(featureId: string): boolean {
  return (
    featureId !== '' &&
    featureId !== '.' &&
    featureId !== '..' &&
    !featureId.includes('/') &&
    !featureId.includes('\\')
  );
}

/**
 * 列出产出目录下全部普通文件(递归,不跟随符号链接),
 * 返回项目相对 POSIX 路径,升序。目录不存在 / feature-id 非法 → []。
 */
export function listFeatureFiles(projectRoot: string, featureId: string): string[] {
  if (!isPlainFeatureId(featureId)) return [];
  const files: string[] = [];
  const relRoot = `${FEATURES_DIR_POSIX}/${featureId}`;
  const walk = (absDir: string, relDir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path.join(absDir, entry.name), rel);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  };
  walk(path.join(projectRoot, FEATURES_DIR, featureId), relRoot);
  return files.sort();
}

/** 顶层文件里注册表类型为 type 的全部相对路径。 */
function topLevelFilesOfType(
  projectRoot: string,
  files: readonly string[],
  type: string,
): string[] {
  return files.filter(
    (rel) =>
      isTopLevelFeatureFile(rel) &&
      identifyArtifact(projectRoot, rel)?.type === type,
  );
}

/** 按文件名长度升序、同长按字典序排序(原地)。 */
function sortByFileName(files: string[]): string[] {
  return files.sort((a, b) =>
    compareSpecCandidates(path.posix.basename(a), path.posix.basename(b)),
  );
}

/**
 * 主 spec 认定(spec §5):顶层类型为 spec 的文件按文件名排序,
 * 取第一个读得出负责人的;都读不出取第一个;没有候选 → null。
 */
function mainSpecRelFromFiles(
  projectRoot: string,
  files: readonly string[],
): string | null {
  const candidates = sortByFileName(
    topLevelFilesOfType(projectRoot, files, 'spec'),
  );
  for (const rel of candidates) {
    if (ownerOf(projectRoot, rel) !== null) return rel;
  }
  return candidates[0] ?? null;
}

/** 主 spec 的项目相对 POSIX 路径;没有 → null。 */
export function findMainSpecRel(
  projectRoot: string,
  featureId: string,
): string | null {
  if (!isPlainFeatureId(featureId)) return null;
  return mainSpecRelFromFiles(
    projectRoot,
    listFeatureFiles(projectRoot, featureId),
  );
}

/**
 * 从需求目录的产物存在性派生阶段(实时,不落盘):
 *   有测试报告 → 已验证;否则有 plan/index → 已规划;否则有顶层规格类文件 → 已规格;
 *   都没有 → null(未规格)。
 *
 * 优先级 已验证 > 已规划 > 已规格,三个里程碑各自独立探测(允许跨阶,
 * 如 spec + 测试报告但无 plan → 已验证)。里程碑类型与文件判定全部经注册表
 * (stageMilestoneOf):测试「规格」不算已验证,结构化结果(json/jsonl)不算报告。
 */
export function deriveFeatureStage(
  projectRoot: string,
  featureId: string,
): FeatureStage | null {
  if (!isPlainFeatureId(featureId)) return null;
  let hasSpecLike = false;
  let hasPlanIndex = false;
  for (const rel of listFeatureFiles(projectRoot, featureId)) {
    const identity = identifyArtifact(projectRoot, rel);
    if (identity === null) continue;
    const milestone = stageMilestoneOf(identity, rel);
    if (milestone === 'report') return '已验证';
    if (milestone === 'plan_index') hasPlanIndex = true;
    else if (milestone === 'spec_like') hasSpecLike = true;
  }
  if (hasPlanIndex) return '已规划';
  if (hasSpecLike) return '已规格';
  return null;
}

/**
 * plan 目录下的 index 文件(*-index.md 或 index.md),按主 spec 优先排序取第一个。
 * 只用于读日期(负责人不再回退 plan/index)。
 */
function findPlanIndexFile(featureDir: string): string | null {
  try {
    const index = fs
      .readdirSync(path.join(featureDir, 'plan'))
      .filter((n) => n.endsWith('-index.md') || n === 'index.md')
      .sort(compareSpecCandidates)[0];
    return index === undefined ? null : path.join(featureDir, 'plan', index);
  } catch {
    return null;
  }
}

/**
 * 把 docs/features/ 下的一个子目录解析为 FeatureEntry(调用方已确认它是目录)。
 * scanFeatures 与 scanFeature 共用,字段算法只在这里。
 */
function featureEntryOf(projectRoot: string, name: string): FeatureEntry {
  const { date: dateFromName, title } = parseFeatureId(name);
  const featureDir = path.join(projectRoot, FEATURES_DIR, name);
  // 日期元数据文件:主 spec → plan/index(日期取值逻辑不变)。
  const mainSpecRel = findMainSpecRel(projectRoot, name);
  const metaFile =
    mainSpecRel !== null
      ? absolutePath(projectRoot, mainSpecRel)
      : findPlanIndexFile(featureDir);
  const meta = metaFile !== null ? readHeaderMeta(metaFile) : null;
  return {
    featureId: name,
    date: meta?.date ?? dateFromName,
    title,
    owner: readFeatureOwner(projectRoot, name),
    stage: deriveFeatureStage(projectRoot, name),
    path: `${FEATURES_DIR_POSIX}/${name}`,
  };
}

/** 条目顺序:日期倒序、标题升序(scanFeatures 与门面 listFeatures 共用)。 */
export function compareFeatureEntries(a: FeatureEntry, b: FeatureEntry): number {
  return (
    (b.date ?? '').localeCompare(a.date ?? '') || a.title.localeCompare(b.title)
  );
}

/**
 * 只解析一个需求目录 <projectRoot>/docs/features/<featureId>,字段与 scanFeatures 列出的相同。
 * feature-id 不是单段目录名、目录不存在或不是目录 → null;与 scanFeatures 一样不认
 * 符号链接(lstat)。只在 features 内部用(门面 listFeatures 读副本里登记的需求),门面不导出。
 */
export function scanFeature(
  projectRoot: string,
  featureId: string,
): FeatureEntry | null {
  if (!isPlainFeatureId(featureId)) return null;
  let stat: fs.Stats | undefined;
  try {
    stat = fs.lstatSync(path.join(projectRoot, FEATURES_DIR, featureId), {
      throwIfNoEntry: false,
    });
  } catch {
    return null;
  }
  if (stat === undefined || !stat.isDirectory()) return null;
  return featureEntryOf(projectRoot, featureId);
}

/**
 * 扫描 <projectRoot>/docs/features/,每个子目录解析为一个 FeatureEntry。
 * 目录不存在或不可读 → 返回空数组(不是错误:项目可能没用 features 流程)。
 * 负责人只认主 spec → 交接文件(readFeatureOwner,与任务负责人同一口径),
 * 所以只有交接文件的目录也进「我的需求」;只有 plan 的目录负责人为 null。
 * 结果按日期倒序、标题升序排好。
 */
export function scanFeatures(projectRoot: string): FeatureEntry[] {
  let dirNames: string[];
  try {
    dirNames = fs
      .readdirSync(path.join(projectRoot, FEATURES_DIR), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  return dirNames
    .map((name) => featureEntryOf(projectRoot, name))
    .sort(compareFeatureEntries);
}

/**
 * 读需求目录的负责人(spec §5):来源顺序取自 OWNER_SOURCE_TYPES——
 * 主 spec 的 `> 负责人:` 优先;主 spec 不存在或没写,取顶层交接文件
 * (按文件名长度升序、同长按字典序取第一个)的 `> 负责人:`。
 * 两者都没有 → null。
 */
export function readFeatureOwner(
  projectRoot: string,
  featureId: string,
): string | null {
  if (!isPlainFeatureId(featureId)) return null;
  const files = listFeatureFiles(projectRoot, featureId);
  for (const sourceType of OWNER_SOURCE_TYPES) {
    if (sourceType === 'spec') {
      const mainSpecRel = mainSpecRelFromFiles(projectRoot, files);
      if (mainSpecRel === null) continue;
      const owner = ownerOf(projectRoot, mainSpecRel);
      if (owner !== null) return owner;
      continue;
    }
    const handoffRel = sortByFileName(
      topLevelFilesOfType(projectRoot, files, sourceType),
    )[0];
    if (handoffRel !== undefined) return ownerOf(projectRoot, handoffRel);
  }
  return null;
}

/**
 * 读需求目录主 spec 头部声明的任务值(spec §5、§6.1)。
 *
 * 主 spec 的认定与读负责人相同(findMainSpecRel),不回退到 plan/index——
 * 任务只在主 spec 里声明。头部 30 行内只认第一条 `> 任务:` 行;
 * 值为空等同于未声明。目录 / spec 不存在或读不了 → null。
 */
export function readFeatureTask(
  projectRoot: string,
  featureId: string,
): string | null {
  if (!isPlainFeatureId(featureId)) return null;
  const mainSpecRel = findMainSpecRel(projectRoot, featureId);
  if (mainSpecRel === null) return null;
  return taskOf(projectRoot, mainSpecRel);
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
  const result: Array<{ featureId: string; path: string; task: string }> = [];
  for (const name of dirNames) {
    const task = readFeatureTask(projectRoot, name);
    if (task !== null) {
      result.push({ featureId: name, path: `${FEATURES_DIR_POSIX}/${name}`, task });
    }
  }
  return result;
}
