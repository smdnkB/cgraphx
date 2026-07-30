/**
 * web 子系统公共门面。
 *
 * 外部调用方(组合根 src/cli/index.ts)必须经此接入 —— 不得直接伸手进
 * 内部模块(coding-standards「门面是硬约定」)。web 与 CLI 是 core 的两个
 * 平行消费方,共享同一 DB 文件;web 仅依赖 src/core/(分层铁律),cli→web
 * 的 wiring import 是唯一已记录例外。
 */

export { registerWebCommand } from './register';
export { startWebServer } from './server';
export type { WebServer } from './server';
export { WebError, WebStartupError, exitCodeForWebError } from './errors';
