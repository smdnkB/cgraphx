/**
 * features 索引扫描器。
 *
 * 单一职责:把 <project>/docs/features/ 下的每个子目录解析成一个
 * FeatureEntry。元数据优先级:spec 文件头部 > plan/index 头部 > 目录名。
 *
 * 头部行约定(与 write-spec / write-plan 的产物头部一致):
 *
 *   # 规格说明: <需求名称>
 *   > feature-id: <feature-id>
 *   > 状态: 草稿
 *   > 负责人: 张三
 *   > 日期: YYYY-MM-DD
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { FeatureEntry } from './types';

/** 扫描目录(仓库相对)。 */
export const FEATURES_DIR = path.join('docs', 'features');

/** feature-id 目录名:日期前缀 + 标题(标题可能含 [业务ID-] 段,不强行拆)。 */
const FEATURE_ID_PATTERN = /^(\d{4}-\d{2}-\d{2})-(.+)$/;

/** 只读文件头部这么多行找元数据,头部之后没有要解析的东西。 */
const HEADER_SCAN_LINES = 30;

interface HeaderMeta {
  status: string | null;
  owner: string | null;
  date: string | null;
}

/** 从文件头部提取 状态/负责人/日期;读不了或没有都返回 null 字段(容错)。 */
function readHeaderMeta(file: string): HeaderMeta {
  const meta: HeaderMeta = { status: null, owner: null, date: null };
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch {
    return meta;
  }
  const lines = text.split('\n').slice(0, HEADER_SCAN_LINES);
  for (const line of lines) {
    const m = /^>\s*(状态|负责人|日期)\s*[:：]\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1];
    const value = m[2];
    if (!key || value === undefined || value === '') continue;
    if (key === '状态') meta.status = value;
    else if (key === '负责人') meta.owner = value;
    else meta.date = value;
  }
  return meta;
}

/**
 * 在一个 feature 目录里找元数据文件:先 *-spec.md(或 spec.md),
 * 再 plan/*-index.md(或 plan/index.md)。都没有 → null(仅目录名可解析)。
 */
function findMetaFile(
  featureDir: string,
): { file: string; source: 'spec' | 'plan' } | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(featureDir);
  } catch {
    return null;
  }
  const spec = entries
    .filter((n) => n.endsWith('-spec.md') || n === 'spec.md')
    .sort()[0];
  if (spec) {
    return { file: path.join(featureDir, spec), source: 'spec' };
  }
  try {
    const planEntries = fs.readdirSync(path.join(featureDir, 'plan'));
    const index = planEntries
      .filter((n) => n.endsWith('-index.md') || n === 'index.md')
      .sort()[0];
    if (index) {
      return { file: path.join(featureDir, 'plan', index), source: 'plan' };
    }
  } catch {
    // 没有 plan 目录,落到目录名解析
  }
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
    const metaFile = findMetaFile(path.join(featuresRoot, name));
    const meta = metaFile
      ? readHeaderMeta(metaFile.file)
      : { status: null, owner: null, date: null };
    result.push({
      featureId: name,
      date: meta.date ?? dateFromName,
      title,
      owner: meta.owner,
      status: meta.status,
      path: `${posixFeaturesDir}/${name}`,
      source: metaFile?.source ?? 'directory',
    });
  }
  result.sort(
    (a, b) =>
      (b.date ?? '').localeCompare(a.date ?? '') ||
      a.title.localeCompare(b.title),
  );
  return result;
}
