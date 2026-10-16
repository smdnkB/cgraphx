/**
 * sync 子系统错误层级。
 *
 * 与 cgraphx 其它子系统的错误相互独立(直接继承 Error),子系统可整体移除。
 * 错误消息不得包含 token 或密码。
 */

export class SyncError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SyncError';
  }
}

/** 参数错误(缺 --server / --user、地址非法、没有 origin、读不到密码等)。 */
export class SyncArgError extends SyncError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SyncArgError';
  }
}

/** 项目未初始化(`.cgraphx/cgraphx.db` 不存在)。 */
export class SyncNotInitializedError extends SyncError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SyncNotInitializedError';
  }
}

/** 本仓库未接入平台。 */
export class SyncNotConnectedError extends SyncError {
  constructor(message = '未接入平台,请先运行 `cgraphx sync connect --server <url> --user <name>`', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SyncNotConnectedError';
  }
}

/** sync schema 应用失败,或库内版本比本构建新。 */
export class SyncSchemaError extends SyncError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SyncSchemaError';
  }
}

/** 平台返回非 2xx 或 2xx 但响应体非法。`code` 为平台错误码或客户端派生码。 */
export class SyncPlatformError extends SyncError {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus: number,
    public readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'SyncPlatformError';
  }
}

/** 网络失败 / 超时。 */
export class SyncNetworkError extends SyncError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SyncNetworkError';
  }
}

/** 已有同步在进行(锁被占用)。 */
export class SyncBusyError extends SyncError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SyncBusyError';
  }
}

/** 错误类型 → CLI 退出码。 */
export function exitCodeForError(err: unknown): number {
  if (err instanceof SyncArgError) return 3;
  if (err instanceof SyncNotInitializedError) return 2;
  if (err instanceof SyncNotConnectedError) return 2;
  if (err instanceof SyncSchemaError) return 2;
  if (err instanceof SyncPlatformError) return 4;
  if (err instanceof SyncNetworkError) return 5;
  if (err instanceof SyncBusyError) return 1;
  return 1;
}
