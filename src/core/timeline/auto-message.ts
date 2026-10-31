/**
 * 自动消息识别(spec 2026-10-31):后台任务通知与子 agent 交回结果也经
 * UserPromptSubmit 送达,宿主 payload 不带来源字段,只能看提问文本的开头判断。
 */

/** 自动消息来源;写入事件的 metadata.source。 */
export type AutoMessageSource = 'task_notification' | 'agent_message';

/**
 * 判断提问文本是不是自动消息,是则返回来源,否则 null。
 *
 * 去掉开头的空白后:`<task-notification>` 开头是后台任务通知;
 * `<agent-message` 开头是子 agent 交回(标签带 from 等属性,不要求紧跟 `>`)。
 * `<system-reminder>` 开头的仍按用户提问记(后面通常跟真提问)。
 */
export function classifyAutoMessage(text: string): AutoMessageSource | null {
  const head = text.trimStart();
  if (head.startsWith('<task-notification>')) return 'task_notification';
  if (head.startsWith('<agent-message')) return 'agent_message';
  return null;
}
