/**
 * UI 测试结构化结果 → 工作簿模型(spec「UI测试报告改xlsx」§5)。
 * 汇总数字只在这里由 cases 计算,不从 JSON 读。
 */

import {
  SCREENSHOT_GAP_PX,
  SCREENSHOT_THUMB_HEIGHT_PX,
  UI_TEST_FAILURE_RESULTS,
} from './constants';
import type { LoadedUiTestResult, UiTestCase, UiTestResultValue, UiTestSummary } from './types';
import type { Cell, CellStyle, Sheet, SheetImage, Workbook } from './xlsx/workbook';

const CASE_HEADERS = ['序号', '功能点', '操作步骤', '预期表现', '实际表现', '结果', '执行到', '备注', '截图'];
const CASE_COLUMN_WIDTHS = [6, 16, 40, 36, 36, 14, 10, 30, 48];
/** 「截图」列下标(0 起)。 */
const SCREENSHOT_COL = 8;
/** px → pt。 */
const PT_PER_PX = 0.75;

function isFailure(result: UiTestResultValue): boolean {
  return (UI_TEST_FAILURE_RESULTS as readonly string[]).includes(result);
}

/** 由用例计算汇总;通过率 = 通过 ÷ 总数(含跳过),保留一位小数。 */
export function summarizeCases(cases: UiTestCase[]): UiTestSummary {
  const failedByType = Object.fromEntries(UI_TEST_FAILURE_RESULTS.map((r) => [r, 0])) as UiTestSummary['failedByType'];
  let passed = 0;
  let skipped = 0;
  for (const c of cases) {
    if (c.result === '通过') passed += 1;
    else if (c.result === '跳过') skipped += 1;
    else if (isFailure(c.result)) failedByType[c.result as keyof UiTestSummary['failedByType']] += 1;
  }
  const failed = Object.values(failedByType).reduce((a, b) => a + b, 0);
  const total = cases.length;
  const passRate = total === 0 ? '0.0%' : `${((passed / total) * 100).toFixed(1)}%`;
  return { total, passed, failed, skipped, passRate, failedByType };
}

function resultStyle(result: UiTestResultValue): CellStyle {
  if (result === '通过') return 'pass';
  if (result === '跳过') return 'skip';
  return 'fail';
}

/** 从 executedAt 原串截取 `YYYY-MM-DD HH:mm`(用其自带时区,不换算)。 */
function formatExecutedAt(executedAt: string): string {
  return `${executedAt.slice(0, 10)} ${executedAt.slice(11, 16)}`;
}

function summarySheet(loaded: LoadedUiTestResult, summary: UiTestSummary): Sheet {
  const { result } = loaded;
  const pairs: [string, string | number][] = [
    ['需求', result.featureId],
    ['执行时间', formatExecutedAt(result.executedAt)],
    ['运行模式', result.mode === 'headless' ? '无头' : 'headed'],
    ['入口 URL', result.entryUrl],
    ['总数', summary.total],
    ['通过', summary.passed],
    ['失败', summary.failed],
    ['跳过', summary.skipped],
    ['通过率', summary.passRate],
    ...UI_TEST_FAILURE_RESULTS.map((r): [string, number] => [r, summary.failedByType[r]]),
  ];
  return {
    name: '汇总',
    columnWidths: [16, 48],
    rows: [
      { cells: [{ value: '项', style: 'header' }, { value: '值', style: 'header' }] },
      ...pairs.map(([k, v]) => ({ cells: [{ value: k }, { value: v }] as Cell[] })),
    ],
    freezeHeader: false,
    autoFilter: false,
    images: [],
  };
}

function casesSheet(loaded: LoadedUiTestResult): Sheet {
  const rows: Sheet['rows'] = [{ cells: CASE_HEADERS.map((h) => ({ value: h, style: 'header' as const })) }];
  const images: SheetImage[] = [];

  loaded.result.cases.forEach((c, i) => {
    const rowIndex = i + 1;
    const shots = loaded.screenshots[i] ?? [];
    let offsetX = SCREENSHOT_GAP_PX / 2;
    for (const shot of shots) {
      const heightPx = SCREENSHOT_THUMB_HEIGHT_PX;
      const widthPx = Math.round((shot.info.width / shot.info.height) * heightPx);
      images.push({
        row: rowIndex,
        col: SCREENSHOT_COL,
        offsetXPx: offsetX,
        widthPx,
        heightPx,
        data: shot.data,
        format: shot.info.format,
      });
      offsetX += widthPx + SCREENSHOT_GAP_PX;
    }
    rows.push({
      cells: [
        { value: c.index },
        { value: c.featurePoint, style: 'wrap' },
        { value: c.steps.map((s, k) => `${k + 1}. ${s}`).join('\n'), style: 'wrap' },
        { value: c.expected.join('\n'), style: 'wrap' },
        { value: c.actual, style: 'wrap' },
        { value: c.result, style: resultStyle(c.result) },
        { value: c.reachedStep === null ? '—' : `步骤 ${c.reachedStep}`, style: 'wrap' },
        { value: c.note, style: 'wrap' },
        { value: '' },
      ],
      ...(shots.length > 0 ? { heightPt: (SCREENSHOT_THUMB_HEIGHT_PX + SCREENSHOT_GAP_PX) * PT_PER_PX } : {}),
    });
  });

  return {
    name: '用例',
    columnWidths: CASE_COLUMN_WIDTHS,
    rows,
    freezeHeader: true,
    autoFilter: true,
    images,
  };
}

/** 生成两张工作表:「汇总」在前,「用例」在后。 */
export function buildUiTestWorkbook(loaded: LoadedUiTestResult): Workbook {
  const summary = summarizeCases(loaded.result.cases);
  return { sheets: [summarySheet(loaded, summary), casesSheet(loaded)] };
}
