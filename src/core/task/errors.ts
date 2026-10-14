/**
 * task 子系统错误层级。
 *
 * 与 cgraphx 其它子系统的错误相互独立(直接继承 Error),子系统可整体移除。
 * CLI 层经 exitCodeForError 映射退出码:TaskConfigError → 2、TaskArgError → 3、
 * TaskStoreError → 4、其它 → 1。用户可修复的错误,消息带修复提示。
 */

export class TaskError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TaskError';
  }
}

/** 项目未初始化 / task 配置非法 / schema 版本比本构建新。 */
export class TaskConfigError extends TaskError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TaskConfigError';
  }
}

/** 参数错误、会话拿不到、任务解析失败。 */
export class TaskArgError extends TaskError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TaskArgError';
  }
}

/** DB 读写失败。 */
export class TaskStoreError extends TaskError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TaskStoreError';
  }
}

/** 外部任务接口不可用(非 2xx / 超时 / body 非法 / 网络失败)。`reason` 为不带修复提示的原因。 */
export class TaskSourceUnavailableError extends TaskError {
  constructor(
    public readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(
      `任务接口不可用:${reason}。检查 .cgraphx/task-source.json 的 url / headers 与接口服务状态,` +
        '或改用本地数据(task list --local;task use 本地已有的任务 / --manual)',
      options,
    );
    this.name = 'TaskSourceUnavailableError';
  }
}
