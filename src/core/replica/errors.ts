/**
 * replica 子系统错误层级。
 *
 * 与其它子系统的错误相互独立(直接继承 Error),子系统可整体移除。
 * CLI 层经 exitCodeForError 映射退出码:invalid_args → 3、其余 ReplicaError → 2(前置条件不满足)、
 * 非 ReplicaError → 1。用户可修复的错误,消息带修复提示。
 */

/** C-5 的九个 code。 */
export const REPLICA_ERROR_CODES = [
  'invalid_args',
  'not_main_dir',
  'dirty_main',
  'no_cow',
  'target_exists',
  'unsupported_platform',
  'dirty',
  'not_found',
  'unsafe_target',
] as const;

export type ReplicaErrorCode = (typeof REPLICA_ERROR_CODES)[number];

/** 附加字段:`--json` 失败输出时平铺进对象。 */
export interface ReplicaErrorDetails {
  /** dirty_main、dirty:改了没提交的文件(仓库相对路径) */
  files?: string[];
  /** no_cow:整份复制需要的字节数 */
  requiredBytes?: number;
}

export class ReplicaError extends Error {
  constructor(
    public readonly code: ReplicaErrorCode,
    message: string,
    public readonly details: Readonly<ReplicaErrorDetails> = {},
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ReplicaError';
  }
}

/** 消息里最多列几个文件,其余只报个数(完整列表在 details.files)。 */
const MAX_LISTED_FILES = 10;

/** 拼进消息的文件列表:`a、b、c`,超过上限时写成 `a、b … 等 N 个`。 */
export function formatFileList(files: readonly string[]): string {
  const shown = files.slice(0, MAX_LISTED_FILES).join('、');
  return files.length > MAX_LISTED_FILES ? `${shown} … 等 ${files.length} 个` : shown;
}

/** 错误类型 → CLI 退出码。 */
export function exitCodeForError(err: unknown): number {
  if (!(err instanceof ReplicaError)) return 1;
  return err.code === 'invalid_args' ? 3 : 2;
}
