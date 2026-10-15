/**
 * report 子系统的 CLI 接线。
 *
 * 导出 `registerReportCommands(program)`,由主 CLI(src/cli/index.ts)调用一次。
 * 命令面:`cgraphx report ui-test <结构化结果.json> [--json]` —— 校验 run-ui-test
 * 的结构化结果并生成同目录 xlsx 报告。
 *
 * 退出码(exitCodeForError):0 成功 / 1 其它 / 2 ReportValidationError / 3 ReportArgError。
 */

import type { Command } from 'commander';

import { generateUiTestReport, ReportArgError, ReportValidationError } from './index';

function exitCodeForError(err: unknown): number {
  if (err instanceof ReportValidationError) return 2;
  if (err instanceof ReportArgError) return 3;
  return 1;
}

/** stderr 输出 `[report] <message>`。 */
function writeErr(msg: string): void {
  process.stderr.write(`[report] ${msg}\n`);
}

interface UiTestOptions {
  json?: boolean;
}

/** 把 `report` 命令组挂到 commander 程序上。主 CLI 调用一次。 */
export function registerReportCommands(program: Command): void {
  const report = program
    .command('report')
    .description('由结构化结果生成测试报告(xlsx)');

  report
    .command('ui-test <resultJson>')
    .description('校验 run-ui-test 的结构化结果(*-ui功能测试结果.json)并在同目录生成 xlsx 报告')
    .option('--json', '以 JSON 输出结果')
    .action((resultJson: string, opts: UiTestOptions) => {
      try {
        const out = generateUiTestReport(resultJson);
        if (opts.json) {
          process.stdout.write(`${JSON.stringify({ ok: true, ...out })}\n`);
          return;
        }
        const s = out.summary;
        process.stdout.write(`已生成 ${out.xlsxPath}\n`);
        process.stdout.write(`共 ${s.total} 条:通过 ${s.passed} · 失败 ${s.failed} · 跳过 ${s.skipped}\n`);
        if (out.removedMdPath) process.stdout.write(`已删除旧报告 ${out.removedMdPath}\n`);
      } catch (err) {
        process.exitCode = exitCodeForError(err);
        if (err instanceof ReportValidationError) {
          if (opts.json) {
            const errors = err.issues.map((i) => ({ case: i.caseIndex, message: i.message }));
            process.stdout.write(`${JSON.stringify({ ok: false, errors })}\n`);
            return;
          }
          writeErr(err.message);
          for (const issue of err.issues) {
            writeErr(issue.caseIndex === null ? `  ${issue.message}` : `  用例 ${issue.caseIndex}:${issue.message}`);
          }
          writeErr(`修正 ${resultJson} 后重新执行 cgraphx report ui-test ${resultJson}`);
          return;
        }
        writeErr(err instanceof Error ? err.message : String(err));
      }
    });
}
