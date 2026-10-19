/**
 * features 子系统的 CLI 接线。
 *
 * 导出 `registerFeaturesCommands(program)`,由主 CLI(src/cli/index.ts)
 * 调用一次。命令面:`cgraphx features [list|sync|show|check]` —— 实时扫描
 * docs/features/,按负责人/关键词/阶段定位需求目录。团队里每个人跑
 * `--mine` 拿自己的清单(负责人 = git config user.name,在
 * write-spec/write-plan 创建时声明)。
 */

import * as path from 'node:path';

import type { Command } from 'commander';

import { checkFeatures } from './check';
import { exitCodeForCheckReport, exitCodeForError } from './errors';
import { listFeatures } from './index';
import { showFeature } from './show';
import { gitUserName, syncMyFeatures } from './sync';
import { resolveProjectRoot } from '../directory';
import type {
  BasisState,
  CheckReport,
  FeatureArtifactRow,
  FeatureDetail,
  FeatureEntry,
} from './types';

/** 组合根可注入的读取函数(本项目类型表缓存等)。 */
export interface FeaturesCommandDeps {
  readProjectArtifactTypes?: (projectRoot: string) => readonly string[] | null;
}

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

interface JsonOptions {
  json?: boolean;
}

interface CheckCliOptions extends JsonOptions {
  staged?: boolean;
}

/** 内置类型显示「显示名 + 标识」;自定义类型只显示标识。 */
function artifactTypeLabel(row: FeatureArtifactRow): string {
  return row.typeName === null ? row.type : `${row.typeName} ${row.type}`;
}

/** 依据状态文案(spec §6.2)。 */
function basisLabel(state: BasisState): string {
  switch (state.kind) {
    case 'fresh':
      return '未过期';
    case 'stale':
      return `过期:spec 已变(${state.recorded} → ${state.current})`;
    case 'no_main_spec':
      return '无主 spec';
    case 'invalid':
      return '依据格式不对';
    case 'none':
      return '—';
  }
}

/** show 的文本输出(四段:概要 / 产物 / 平台环节 / 其他文件)。 */
function renderShow(detail: FeatureDetail): string {
  const labelWidth = 12;
  const summary = (label: string, value: string): string =>
    `${padEnd(label, labelWidth)}${value}`;

  const lines: string[] = [
    summary('feature-id', detail.featureId),
    summary('负责人', detail.owner ?? '-'),
  ];
  if (detail.task !== null) {
    lines.push(summary('任务', detail.task));
  }
  lines.push(summary('阶段', detail.stage ?? '-'));
  lines.push(summary('spec 指纹', detail.specFingerprint ?? '无主 spec'));

  lines.push('', '产物');
  if (detail.artifacts.length === 0) {
    lines.push('  无');
  } else {
    const typeWidth = Math.max(
      ...detail.artifacts.map((row) => displayWidth(artifactTypeLabel(row))),
    );
    const pathWidth = Math.max(
      ...detail.artifacts.map((row) => displayWidth(row.path)),
    );
    for (const row of detail.artifacts) {
      const via = row.via === 'header' ? '头部' : '路径';
      lines.push(
        `  ${padEnd(artifactTypeLabel(row), typeWidth + 2)}` +
          `${padEnd(row.path, pathWidth + 2)}` +
          `${padEnd(via, 6)}${basisLabel(row.basis)}`,
      );
    }
  }

  lines.push('', '平台环节(按默认类型表;任务类型按「需求开发」估)');
  for (const phase of detail.phases) {
    let status: string;
    if (phase.paths.length > 0) {
      status = `✓  ${phase.paths.join('、')}`;
    } else if (phase.required) {
      status = '✗  缺(必需)';
    } else {
      status = '—';
    }
    lines.push(`  ${padEnd(phase.name, 10)}${status}`);
  }
  lines.push('  实现、知识经验:由 commit 和会话承载,以平台为准');
  if (detail.customTypes.length > 0) {
    lines.push(
      '  项目自定义类型(环节以平台配置为准):' +
        detail.customTypes.map((item) => item.type).join('、'),
    );
  }

  lines.push('', '其他文件');
  if (detail.otherFiles.length === 0) {
    lines.push('  无');
  } else {
    for (const file of detail.otherFiles) {
      lines.push(`  ${file}`);
    }
  }

  return lines.join('\n');
}

/** check 的文本输出;每条结果都带「改法」行。 */
function renderCheck(report: CheckReport): string {
  if (report.findings.length === 0) {
    return `共检查 ${report.checkedFiles} 个文件:全部通过`;
  }

  const lines: string[] = [];
  for (const finding of report.findings) {
    const level = finding.level === 'fail' ? '失败' : '警告';
    lines.push(`${level}  ${finding.path}  ${finding.message}`);
    if (finding.fix !== null) {
      lines.push(`      改法:${finding.fix}`);
    }
  }
  lines.push(
    `共检查 ${report.checkedFiles} 个文件:` +
      `${report.failures} 处失败,${report.warnings} 处警告`,
  );
  return lines.join('\n');
}

/** 把 `features` 命令组挂到 commander 程序上。主 CLI 调用一次。 */
export function registerFeaturesCommands(
  program: Command,
  deps: FeaturesCommandDeps = {},
): void {
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
      const projectRoot = pathArg ? path.resolve(pathArg) : resolveProjectRoot(process.cwd());

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
      const projectRoot = pathArg ? path.resolve(pathArg) : resolveProjectRoot(process.cwd());
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

  features
    .command('show <feature-id> [project-path]')
    .description('展示一个产出目录的全貌(实时计算,不写文件)')
    .option('--json', '输出机器可读 JSON')
    .action(
      (
        featureId: string,
        projectPath: string | undefined,
        options: JsonOptions,
      ) => {
        const projectRoot = projectPath
          ? path.resolve(projectPath)
          : resolveProjectRoot(process.cwd());
        try {
          const detail = showFeature(projectRoot, featureId);
          process.stdout.write(
            options.json
              ? JSON.stringify(detail, null, 2) + '\n'
              : renderShow(detail) + '\n',
          );
        } catch (err) {
          console.error(
            `[features] ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exitCode = exitCodeForError(err);
        }
      },
    );

  features
    .command('check [targets...]')
    .description('校验新产物的头部与首屏(实时计算,不写文件)')
    .option('--json', '输出机器可读 JSON')
    .option('--staged', '只检查暂存区里 docs/features/ 下新增和修改的文件')
    .action((targets: string[] | undefined, options: CheckCliOptions) => {
      const projectRoot = resolveProjectRoot(process.cwd());
      try {
        const report = checkFeatures(projectRoot, targets ?? [], {
          projectTypes: deps.readProjectArtifactTypes?.(projectRoot) ?? null,
          staged: options.staged === true,
        });
        process.stdout.write(
          options.json
            ? JSON.stringify(report, null, 2) + '\n'
            : renderCheck(report) + '\n',
        );
        process.exitCode = exitCodeForCheckReport(report);
      } catch (err) {
        console.error(
          `[features] ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = exitCodeForError(err);
      }
    });
}
