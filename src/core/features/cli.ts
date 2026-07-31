/**
 * features 子系统的 CLI 接线。
 *
 * 导出 `registerFeaturesCommands(program)`,由主 CLI(src/cli/index.ts)
 * 调用一次。命令面:`cgraphx features [list]` —— 实时扫描 docs/features/,
 * 按负责人/关键词/阶段定位需求目录。团队里每个人跑 `--mine` 拿自己的清单
 * (负责人 = git config user.name,在 write-spec/write-plan 创建时声明)。
 */

import * as path from 'node:path';

import type { Command } from 'commander';

import { listFeatures } from './index';
import { gitUserName, syncMyFeatures } from './sync';
import type { FeatureEntry } from './types';

/** 终端显示宽度:CJK / 全角字符按 2 列计,其余 1 列(表格对齐用)。 */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x3fffd);
    w += wide ? 2 : 1;
  }
  return w;
}

function padEnd(s: string, width: number): string {
  const gap = width - displayWidth(s);
  return gap > 0 ? s + ' '.repeat(gap) : s;
}

/** 对齐表格输出。空字段显示 `-`。 */
function renderTable(rows: FeatureEntry[]): string {
  const cells = rows.map((r) => [
    r.date ?? '-',
    r.stage ?? '-',
    r.owner ?? '-',
    r.title,
    r.path,
  ]);
  const headers = ['日期', '阶段', '负责人', '标题', '目录'];
  const widths = headers.map((h, i) =>
    Math.max(
      displayWidth(h),
      ...cells.map((c) => displayWidth(c[i] ?? '')),
    ),
  );
  const lines: string[] = [];
  lines.push(headers.map((h, i) => padEnd(h, (widths[i] ?? 0) + 2)).join('').trimEnd());
  for (const c of cells) {
    lines.push(
      c.map((v, i) => padEnd(v, (widths[i] ?? 0) + 2)).join('').trimEnd(),
    );
  }
  return lines.join('\n');
}

interface ListOptions {
  mine?: boolean;
  owner?: string;
  q?: string;
  stage?: string;
  json?: boolean;
}

/** 把 `features` 命令组挂到 commander 程序上。主 CLI 调用一次。 */
export function registerFeaturesCommands(program: Command): void {
  const features = program
    .command('features')
    .description(
      '需求目录索引 — 实时扫描 docs/features/,按负责人/关键词快速定位需求目录',
    );

  features
    .command('list [project-path]', { isDefault: true })
    .description('列出需求目录(默认全部;--mine 只看自己的)')
    .option('--mine', '只看当前 git 用户负责的需求(负责人 = git config user.name)')
    .option('--owner <name>', '按负责人精确过滤')
    .option('--q <keyword>', '标题 / feature-id 子串过滤')
    .option('--stage <stage>', '按阶段精确过滤(已规格 / 已规划 / 已验证)')
    .option('--json', '输出机器可读 JSON')
    .action((pathArg: string | undefined, options: ListOptions) => {
      const projectRoot = path.resolve(pathArg || process.cwd());

      let owner: string | undefined = options.owner;
      if (options.mine) {
        if (owner !== undefined) {
          console.error('--mine 与 --owner 互斥,请只用一个。');
          process.exit(1);
        }
        const name = gitUserName();
        if (name === null) {
          console.error(
            '无法从 git config 读取 user.name;请改用 --owner=<你的名字>。',
          );
          process.exit(1);
        }
        owner = name;
      }

      const rows = listFeatures(projectRoot, {
        owner,
        q: options.q,
        stage: options.stage,
      });

      if (options.json) {
        process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
        return;
      }

      if (rows.length === 0) {
        if (owner !== undefined) {
          console.log(
            `未找到负责人为「${owner}」的需求目录。\n` +
              '  cgraphx features list 查看全部,或 --owner=<名字> 换人。',
          );
        } else {
          console.log(`${projectRoot} 的 docs/features/ 下没有需求目录。`);
        }
        return;
      }

      process.stdout.write(renderTable(rows) + '\n');
      console.log(
        owner !== undefined
          ? `\n共 ${rows.length} 个需求(负责人:${owner})`
          : `\n共 ${rows.length} 个需求`,
      );
    });

  features
    .command('sync [project-path]')
    .description(
      '重新生成本人需求索引 → .cgraphx/my-features.md(本地文件,不进 git)',
    )
    .action((pathArg: string | undefined) => {
      const projectRoot = path.resolve(pathArg || process.cwd());
      try {
        const result = syncMyFeatures(projectRoot);
        console.log(
          `已生成 ${result.file}(${result.count} 个需求,负责人:${result.owner})`,
        );
      } catch (err) {
        console.error(
          `生成失败:${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    });
}
