/**
 * 绑定段 → 归属事件(归属口径:上一个需求 spec §3.2)。
 *
 * 事件 e 归属绑定 b ⇔ e.session_id = b.session_id 且 b.bound_at ≤ e.ts < b.unbound_at
 * (unbound_at 为空视为无上界)。timeline 查询的 until 是闭区间,这里再剔除 ts ≥ unbound_at。
 * `task show`(getTaskDetail)与任务报告共用本模块,左闭右开规则只有这一处。
 */

import { queryEvents, type TimelineEvent } from '../timeline';
import type { TaskBinding } from './types';

/** 单条绑定段查询 timeline 的上限(timeline 查询硬上限)。 */
export const EVENTS_PER_BINDING_LIMIT = 10_000;

/**
 * 取一条绑定段的归属事件(按 ts、id 升序)。
 * truncated = timeline 返回条数达到 EVENTS_PER_BINDING_LIMIT(此时保留的是该段最近的 10000 条)。
 */
export async function queryBindingEvents(
  projectRoot: string,
  binding: TaskBinding,
): Promise<{ events: TimelineEvent[]; truncated: boolean }> {
  const raw = await queryEvents(projectRoot, {
    session: binding.sessionId,
    since: binding.boundAt,
    until: binding.unboundAt ?? undefined,
    limit: EVENTS_PER_BINDING_LIMIT,
  });
  const events = raw
    .filter((e) => e.ts >= binding.boundAt && (binding.unboundAt === null || e.ts < binding.unboundAt))
    .sort((a, b) => a.ts.localeCompare(b.ts) || a.id - b.id);
  return { events, truncated: raw.length >= EVENTS_PER_BINDING_LIMIT };
}
