/**
 * 根汇总(spec:2026-11-05-数据按项目放用户目录 D11)。
 *
 * task 的路径换算、找需求目录、判断会话开在哪个副本,都按「timeline 记下的根 + 当前根 + 这些根上的副本登记」:
 * 传入的起点按 D2 认出当前根(不再换成主目录),timeline 记下的根取数据位置那份库的 timeline_roots,副本登记由
 * replica 挂上。一轮里取一次,传给各处共用(replica 按这份数组建一次查找表)。sync 也经门面用它。
 */

import * as path from 'node:path';

import { findProjectRoot } from '../data-location';
import { listProjectRoots, type ProjectRoot } from '../replica';
import { listTimelineRoots } from '../timeline';

export interface ProjectRootSet {
  currentRoot: string;
  roots: ProjectRoot[];
}

/**
 * spec D11:currentRoot = 起点按 D2 认出的根,没有根就是起点本身;roots = timeline 记下的根(最近活动时间取各根的
 * lastTs)+ currentRoot + 这些根上的副本登记(listProjectRoots)。读不出 timeline 记下的根时只有当前根和它的副本登记。
 */
export function collectProjectRoots(start: string): ProjectRootSet {
  const currentRoot = findProjectRoot(start) ?? path.resolve(start);
  const baseRoots = listTimelineRoots(start).map(({ root, lastTs }) => ({ root, lastActiveAt: lastTs }));
  return { currentRoot, roots: listProjectRoots(baseRoots, currentRoot) };
}
