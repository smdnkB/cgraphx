/**
 * web 子系统错误类型。
 *
 * 与其余子系统同构(coding-standards「错误与日志」):类型化错误层级,直接
 * 继承 Error,保持可整体移除。启动类错误(WebStartupError)带 kind 判别
 * 字段用于退出码映射;用户可修复的错误消息均带修复提示。
 *
 * 退出码经 exitCodeForWebError 统一映射(interface-standards「退出码」——
 * 禁字面量退出码散落在 action 里)。
 */

/** web 子系统错误基类。 */
export class WebError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebError';
  }
}

/** 启动预检失败的判别字段:未初始化 / schema 缺失 / 端口占用。 */
export type WebStartupErrorKind = 'uninitialized' | 'schema-missing' | 'port-in-use';

/**
 * 启动预检序列中抛出的错误。
 *
 * - `kind` 标识失败阶段(决定退出码);
 * - `missing` / `port` 携带定位信息,供错误消息与调用方使用。
 */
export class WebStartupError extends WebError {
  constructor(
    public readonly kind: WebStartupErrorKind,
    message: string,
    public readonly detail?: {
      /** schema-missing:缺失的 schema 名。 */
      missing?: ('markdown' | 'timeline')[];
      /** port-in-use:被占用的端口。 */
      port?: number;
    },
  ) {
    super(message);
    this.name = 'WebStartupError';
  }
}

/**
 * 把任意错误映射到进程退出码。
 *
 * - `uninitialized` / `schema-missing` → 2(沿用 `status` 未初始化退出码 2 的先例)
 * - `port-in-use` → 1
 * - 其他 / 未知 → 1
 */
export function exitCodeForWebError(err: unknown): number {
  if (err instanceof WebStartupError) {
    if (err.kind === 'uninitialized' || err.kind === 'schema-missing') return 2;
    if (err.kind === 'port-in-use') return 1;
  }
  return 1;
}
