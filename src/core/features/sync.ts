/**
 * 本人需求索引生成(本地文件,不进 git)。
 *
 * 把 `list --mine` 的结果固化为 `.cgraphx/my-features.md`:查询是实时的,
 * 这个文件只是随手的快照——每次 `cgraphx features sync` 全量重写,
 * 永不手维护,所以不会陈旧。放在 .cgraphx/ 下天然是 gitignore 的
 * 运行时数据(没有 .gitignore 时补一个 `*` 兜底),每人每机一份。
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { listFeatures } from './index';
import type { FeatureEntry } from './types';

/** 生成的索引文件名(位于项目 .cgraphx/ 下)。 */
export const MY_FEATURES_FILENAME = 'my-features.md';

/** 取当前 git 用户名;取不到(非 git 环境 / 未配置)→ null。 */
export function gitUserName(): string | null {
  try {
    const name = execFileSync('git', ['config', 'user.name'], {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
    return name === '' ? null : name;
  } catch {
    return null;
  }
}

/** Markdown 转义:表格单元里的 `|` 要转义,换行压成空格。 */
function mdCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

function renderMarkdownIndex(owner: string, rows: FeatureEntry[]): string {
  const lines: string[] = [
    '# 我的需求索引(自动生成,勿手改)',
    '',
    `> 负责人:${owner} · 共 ${rows.length} 个需求 · 重新生成:\`cgraphx features sync\``,
    '',
    '| 日期 | 阶段 | 标题 | 目录 |',
    '|---|---|---|---|',
  ];
  for (const r of rows) {
    lines.push(
      `| ${mdCell(r.date ?? '-')} | ${mdCell(r.stage ?? '-')} | ${mdCell(r.title)} | ${mdCell(r.path)}/ |`,
    );
  }
  if (rows.length === 0) {
    lines.push('', '_(还没有以你为负责人的需求目录;write-spec/write-plan 创建时会声明负责人。)_');
  }
  return lines.join('\n') + '\n';
}

export interface SyncResult {
  /** 生成的索引文件绝对路径。 */
  file: string;
  /** 收录的需求数。 */
  count: number;
  /** 负责人(git 用户名或显式覆盖值)。 */
  owner: string;
}

/**
 * 重新生成本人需求索引 → <projectRoot>/.cgraphx/my-features.md。
 * 幂等:每次全量重写。owner 缺省取 git config user.name,也可显式传入(测试用)。
 */
export function syncMyFeatures(
  projectRoot: string,
  owner?: string,
): SyncResult {
  const who = owner ?? gitUserName();
  if (who === null) {
    throw new Error(
      '无法从 git config 读取 user.name,无法确定"本人";请配置 git 用户或显式指定。',
    );
  }
  const rows = listFeatures(projectRoot, { owner: who });

  const cgraphxDir = path.join(projectRoot, '.cgraphx');
  fs.mkdirSync(cgraphxDir, { recursive: true });
  // 兜底:.cgraphx/ 是运行时数据,不该进 git(cgraphx init 也会写这个文件)
  const gitignore = path.join(cgraphxDir, '.gitignore');
  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(gitignore, '*\n', 'utf-8');
  }
  const file = path.join(cgraphxDir, MY_FEATURES_FILENAME);
  fs.writeFileSync(file, renderMarkdownIndex(who, rows), 'utf-8');
  return { file, count: rows.length, owner: who };
}
