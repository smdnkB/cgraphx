/**
 * project 子系统错误层级(spec:2026-11-05-数据按项目放用户目录 D17)。
 *
 * 与其它子系统的错误相互独立(直接继承 Error),子系统可整体移除。CLI 层经 exitCodeForError 映射退出码:
 * 认不出项目、记不下名字、这个目录还有没并过去的旧数据 → 2(前置条件不满足),其余 → 1。用户可修复的错误,
 * 消息带修复提示。
 */

/** index C-12 的七个 code。 */
export const PROJECT_ERROR_CODES = [
  'no_project',
  'invalid_name',
  'cannot_record',
  'legacy_data',
  'not_found',
  'needs_yes',
  'unsafe_target',
] as const;

export type ProjectErrorCode = (typeof PROJECT_ERROR_CODES)[number];

export class ProjectError extends Error {
  constructor(
    public readonly code: ProjectErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ProjectError';
  }
}

/** 退出码 2 的 code:前置条件不满足,换个目录或先 install 才行。 */
const PRECONDITION_CODES: ReadonlySet<ProjectErrorCode> = new Set<ProjectErrorCode>([
  'no_project',
  'cannot_record',
  'legacy_data',
]);

/** 错误 → CLI 退出码:no_project、cannot_record、legacy_data → 2;其余 ProjectError 与非 ProjectError → 1。 */
export function exitCodeForError(err: unknown): number {
  return err instanceof ProjectError && PRECONDITION_CODES.has(err.code) ? 2 : 1;
}
