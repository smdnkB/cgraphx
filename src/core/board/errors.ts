/**
 * board 子系统错误层级(与其它子系统相互独立,直接继承 Error,子系统可整体移除)。
 *
 * 看板的数据链路以只读为主,单项目读不出按空数据继续(不让一个项目拖垮整份列表);这里抛的只有
 * 装配环节整体失败这类人要看的错。CLI 层经 exitCodeForError 映射退出码。
 */

export class BoardError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BoardError';
  }
}

/** 看板数据装配失败(枚举项目、认任务这一层抛了不该抛的异常)。 */
export class BoardDataError extends BoardError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BoardDataError';
  }
}

/** 错误类型 → CLI 退出码(board 无「目标不存在」类,一律通用错误 1)。 */
export function exitCodeForError(err: unknown): number {
  if (err instanceof BoardError) return 1;
  return 1;
}
