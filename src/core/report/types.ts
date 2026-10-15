/**
 * report 子系统类型。
 *
 * UiTestResultFile / UiTestCase 是结构化结果 JSON 的契约形状
 * (spec「UI测试报告改xlsx」§3),字段名与语义不得随意改动。
 */

import type { RUN_MODES, UI_TEST_FAILURE_RESULTS, UI_TEST_RESULTS } from './constants';

export type UiTestResultValue = (typeof UI_TEST_RESULTS)[number];
export type RunMode = (typeof RUN_MODES)[number];

export interface UiTestCase {
  index: number;
  featurePoint: string;
  steps: string[];
  expected: string[];
  /** 缺省或 null 规范化为 ''。 */
  actual: string;
  result: UiTestResultValue;
  /** 缺省规范化为 null。 */
  reachedStep: number | null;
  /** 缺省或 null 规范化为 ''。 */
  note: string;
  screenshots: string[];
}

export interface UiTestResultFile {
  schemaVersion: number;
  featureId: string;
  executedAt: string;
  mode: RunMode;
  entryUrl: string;
  cases: UiTestCase[];
}

export interface ImageInfo {
  format: 'png' | 'jpeg';
  width: number;
  height: number;
}

export interface LoadedScreenshot {
  relPath: string;
  data: Buffer;
  info: ImageInfo;
}

export interface LoadedUiTestResult {
  /** 绝对路径。 */
  jsonPath: string;
  /** JSON 所在目录(绝对路径)。 */
  dir: string;
  /** 文件名去掉 UI_TEST_RESULT_SUFFIX。 */
  prefix: string;
  result: UiTestResultFile;
  /** 与 result.cases 同下标、同顺序。 */
  screenshots: LoadedScreenshot[][];
}

export interface ValidationIssue {
  caseIndex: number | null;
  message: string;
}

export interface UiTestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  /** 如 '33.3%'。 */
  passRate: string;
  failedByType: Record<(typeof UI_TEST_FAILURE_RESULTS)[number], number>;
}

export interface UiTestReportOutcome {
  xlsxPath: string;
  removedMdPath: string | null;
  summary: UiTestSummary;
}
