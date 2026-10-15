/**
 * report 子系统错误层级。
 *
 * 与其它子系统的错误相互独立(直接继承 Error),子系统可整体移除。
 * CLI 层经 exitCodeForError 映射退出码:ReportValidationError → 2、
 * ReportArgError → 3、其它 → 1。
 */

import type { ValidationIssue } from './types';

export class ReportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ReportError';
  }
}

/** 参数错误(如输入文件名后缀不符)。 */
export class ReportArgError extends ReportError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ReportArgError';
  }
}

/** 结构化结果校验未通过;issues 携带全部问题。 */
export class ReportValidationError extends ReportError {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(`结构化结果校验未通过(${issues.length} 项)`);
    this.name = 'ReportValidationError';
    this.issues = issues;
  }
}
