/**
 * UI 测试结构化结果 JSON 的严格校验与加载(spec「UI测试报告改xlsx」§3、§4.2)。
 *
 * 一次运行收集全部问题,最后统一抛 ReportValidationError;
 * 只有「读不到 / 解析不了 / 顶层不是对象」这类前置问题会短路。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  RUN_MODES,
  UI_TEST_RESULTS,
  UI_TEST_RESULT_SUFFIX,
  UI_TEST_SCHEMA_VERSION,
} from './constants';
import { ReportArgError, ReportValidationError } from './errors';
import { readImageInfo } from './image';
import type {
  LoadedScreenshot,
  LoadedUiTestResult,
  RunMode,
  UiTestCase,
  UiTestResultValue,
  ValidationIssue,
} from './types';

const EXECUTED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

/** 可选字符串:字符串 / null / 缺省。 */
function isOptionalString(v: unknown): boolean {
  return v === undefined || v === null || typeof v === 'string';
}

/**
 * 读取并校验结构化结果;通过则返回规范化结果与已加载的截图。
 * 文件名后缀不符 → ReportArgError;其余问题 → ReportValidationError(含全部 issues)。
 */
export function loadUiTestResult(jsonPath: string): LoadedUiTestResult {
  const absPath = path.resolve(jsonPath);
  const base = path.basename(absPath);
  if (!base.endsWith(UI_TEST_RESULT_SUFFIX)) {
    throw new ReportArgError(`输入文件名须以 ${UI_TEST_RESULT_SUFFIX} 结尾:${base}`);
  }
  const dir = path.dirname(absPath);
  const prefix = base.slice(0, -UI_TEST_RESULT_SUFFIX.length);

  let raw: string;
  try {
    raw = fs.readFileSync(absPath, 'utf8');
  } catch {
    throw new ReportValidationError([{ caseIndex: null, message: `找不到文件:${absPath}` }]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ReportValidationError([{ caseIndex: null, message: `无法解析 JSON:${msg}` }]);
  }
  if (!isObject(parsed)) {
    throw new ReportValidationError([{ caseIndex: null, message: '顶层必须是 JSON 对象' }]);
  }

  const issues: ValidationIssue[] = [];
  const top = (message: string): void => {
    issues.push({ caseIndex: null, message });
  };

  if (parsed.schemaVersion !== UI_TEST_SCHEMA_VERSION) {
    top(`不支持的 schemaVersion:${JSON.stringify(parsed.schemaVersion)}(本命令支持 ${UI_TEST_SCHEMA_VERSION})`);
  }
  for (const key of ['featureId', 'executedAt', 'entryUrl'] as const) {
    if (!isNonEmptyString(parsed[key])) top(`字段 ${key} 缺失或不是非空字符串`);
  }
  if (isNonEmptyString(parsed.executedAt) && !EXECUTED_AT_RE.test(parsed.executedAt)) {
    top(`字段 executedAt 须为带时区偏移的 ISO 8601 时间(如 2026-10-15T14:30:00+08:00):${parsed.executedAt}`);
  }
  if (!(RUN_MODES as readonly unknown[]).includes(parsed.mode)) {
    top(`字段 mode 须为 ${RUN_MODES.join(' / ')}:${JSON.stringify(parsed.mode)}`);
  }

  const cases: UiTestCase[] = [];
  const screenshots: LoadedScreenshot[][] = [];
  if (!Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    top('字段 cases 缺失或为空数组(至少 1 条用例)');
  } else {
    const seen = new Set<number>();
    parsed.cases.forEach((c, i) => {
      const loaded = checkCase(c, i, dir, seen, issues);
      if (loaded) {
        cases.push(loaded.testCase);
        screenshots.push(loaded.shots);
      }
    });
  }

  if (issues.length > 0) throw new ReportValidationError(issues);

  return {
    jsonPath: absPath,
    dir,
    prefix,
    result: {
      schemaVersion: UI_TEST_SCHEMA_VERSION,
      featureId: parsed.featureId as string,
      executedAt: parsed.executedAt as string,
      mode: parsed.mode as RunMode,
      entryUrl: parsed.entryUrl as string,
      cases,
    },
    screenshots,
  };
}

/** 校验单条用例;有问题时记入 issues 并返回 null。 */
function checkCase(
  c: unknown,
  position: number,
  dir: string,
  seen: Set<number>,
  issues: ValidationIssue[],
): { testCase: UiTestCase; shots: LoadedScreenshot[] } | null {
  if (!isObject(c)) {
    issues.push({ caseIndex: position + 1, message: '用例必须是 JSON 对象' });
    return null;
  }
  const caseIndex = isPositiveInt(c.index) ? c.index : position + 1;
  const before = issues.length;
  const add = (message: string): void => {
    issues.push({ caseIndex, message });
  };

  if (!isPositiveInt(c.index)) {
    add('字段 index 缺失或不是 ≥1 的整数');
  } else if (seen.has(c.index)) {
    add(`index 重复:${c.index}`);
  } else {
    seen.add(c.index);
  }
  if (!isNonEmptyString(c.featurePoint)) add('字段 featurePoint 缺失或不是非空字符串');
  for (const key of ['steps', 'expected'] as const) {
    const v = c[key];
    if (v === undefined) add(`缺少字段 ${key}`);
    else if (!isStringArray(v) || v.length === 0) add(`字段 ${key} 须为至少 1 项的字符串数组`);
  }
  const resultOk = (UI_TEST_RESULTS as readonly unknown[]).includes(c.result);
  if (c.result === undefined) add('缺少字段 result');
  else if (!resultOk) add(`未知结果 ${JSON.stringify(c.result)}`);
  if (!(c.reachedStep === undefined || c.reachedStep === null || isPositiveInt(c.reachedStep))) {
    add('字段 reachedStep 须为 ≥1 的整数或 null');
  }
  for (const key of ['actual', 'note'] as const) {
    if (!isOptionalString(c[key])) add(`字段 ${key} 须为字符串`);
  }

  // 视结果必填(spec §3.3)
  if (resultOk) {
    const actual = typeof c.actual === 'string' ? c.actual.trim() : '';
    const note = typeof c.note === 'string' ? c.note.trim() : '';
    if (c.result === '跳过') {
      if (note === '') add('跳过须填写 note');
    } else if (actual === '') {
      add(`结果为「${String(c.result)}」须填写 actual`);
    }
  }

  const shots: LoadedScreenshot[] = [];
  if (c.screenshots === undefined) {
    add('缺少字段 screenshots');
  } else if (!isStringArray(c.screenshots)) {
    add('字段 screenshots 须为字符串数组');
  } else {
    for (const rel of c.screenshots) {
      let data: Buffer;
      try {
        data = fs.readFileSync(path.resolve(dir, rel));
      } catch {
        add(`截图不存在:${rel}`);
        continue;
      }
      const info = readImageInfo(data);
      if (!info) {
        add(`截图不是 PNG/JPEG 图片:${rel}`);
        continue;
      }
      shots.push({ relPath: rel, data, info });
    }
  }

  if (issues.length > before) return null;
  return {
    testCase: {
      index: c.index as number,
      featurePoint: c.featurePoint as string,
      steps: c.steps as string[],
      expected: c.expected as string[],
      actual: typeof c.actual === 'string' ? c.actual : '',
      result: c.result as UiTestResultValue,
      reachedStep: isPositiveInt(c.reachedStep) ? c.reachedStep : null,
      note: typeof c.note === 'string' ? c.note : '',
      screenshots: c.screenshots as string[],
    },
    shots,
  };
}
