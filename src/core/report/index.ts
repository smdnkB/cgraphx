/**
 * report 子系统公共门面。
 *
 * 外部调用方(CLI)必须用它 —— 不得直接伸手进内部模块。
 * 职责:把 run-ui-test 产出的结构化结果转成 xlsx 报告(spec「UI测试报告改xlsx」)。
 * 纯文件读写,无 DB、不依赖 .cgraphx/ 初始化,不依赖其它子系统。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { UI_TEST_REPORT_MD_SUFFIX, UI_TEST_REPORT_XLSX_SUFFIX } from './constants';
import { loadUiTestResult } from './ui-test-result';
import { buildUiTestWorkbook, summarizeCases } from './ui-test-workbook';
import { writeWorkbook } from './xlsx/workbook';
import type { UiTestReportOutcome } from './types';

export * from './constants';
export type * from './types';
export { ReportError, ReportArgError, ReportValidationError } from './errors';
export { loadUiTestResult } from './ui-test-result';

/**
 * 校验结构化结果并生成同目录的 xlsx 报告(覆盖),成功后删除同目录旧 md 报告。
 * 校验或写入失败时不改动任何已有产物。
 */
export function generateUiTestReport(jsonPath: string): UiTestReportOutcome {
  const loaded = loadUiTestResult(jsonPath);
  const xlsx = writeWorkbook(buildUiTestWorkbook(loaded));

  const xlsxPath = path.join(loaded.dir, `${loaded.prefix}${UI_TEST_REPORT_XLSX_SUFFIX}`);
  const tmpPath = `${xlsxPath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmpPath, xlsx);
    fs.renameSync(tmpPath, xlsxPath);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }

  const mdPath = path.join(loaded.dir, `${loaded.prefix}${UI_TEST_REPORT_MD_SUFFIX}`);
  let removedMdPath: string | null = null;
  if (fs.existsSync(mdPath)) {
    fs.unlinkSync(mdPath);
    removedMdPath = mdPath;
  }

  return { xlsxPath, removedMdPath, summary: summarizeCases(loaded.result.cases) };
}
