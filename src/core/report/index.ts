/**
 * report 子系统公共门面。
 *
 * 外部调用方(CLI)必须用它 —— 不得直接伸手进内部模块。
 * 职责:把 run-ui-test 产出的结构化结果转成 xlsx 报告(spec「UI测试报告改xlsx」)。
 * 纯文件读写,无 DB、不依赖 .cgraphx/ 初始化,不依赖其它子系统。
 */

export * from './constants';
export type * from './types';
export { ReportError, ReportArgError, ReportValidationError } from './errors';
export { loadUiTestResult } from './ui-test-result';
