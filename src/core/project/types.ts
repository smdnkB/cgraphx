/**
 * project 子系统类型(index C-12)。
 *
 * `--json` 输出直接序列化这些对象,字段顺序即输出顺序;路径一律绝对路径,大小一律字节数,时间一律 ISO 原样。
 */

import type { IdentityKind } from '../project-identity';

export type ProjectKind = IdentityKind;

/** 一个项目:项目目录名(还没建为 null)、显示名(spec D18)与标识。标识缺失时 kind、origin、name 为 null,display 为目录名。 */
export interface ProjectRef {
  dir: string | null;
  display: string;
  kind: ProjectKind | null;
  origin: string | null;
  name: string | null;
}

/** 项目在本机出现过的一个根:timeline 记下的根与最近一次活动,以及目录还在不在。 */
export interface ProjectRootInfo {
  path: string;
  lastActiveAt: string | null;
  exists: boolean;
}

/** `cgraphx project show`:这个目录属于哪个项目、数据在哪、本机出现过的根。 */
export interface ProjectShowReport {
  project: ProjectRef;
  /** 旧库为本地 `.cgraphx/`,项目库为项目目录;还没有数据为 null */
  dataDir: string | null;
  mode: 'legacy' | 'project' | 'none';
  roots: ProjectRootInfo[];
}

/** 改名结果:给人看的几行(M6~M9)。 */
export interface RenameOutcome {
  lines: string[];
}

/** `cgraphx project list` 的一项:用户目录里的一个项目目录。 */
export interface ProjectListItem {
  project: ProjectRef;
  /** 整个项目目录的字节数 */
  size: number;
  /** 各根最近一次活动里最晚的;没有记录为 null */
  lastActiveAt: string | null;
  roots: ProjectRootInfo[];
  backups: { count: number; size: number };
  /** identity.json 读不出 */
  identityMissing: boolean;
}

/** `cgraphx project remove` 的预览:删什么、删多少;lines 是给人看的预览(C-13)。 */
export interface RemovalPlan {
  dirName: string;
  dir: string;
  display: string;
  backupsOnly: boolean;
  events: number;
  sessions: number;
  /** 项目目录里在的配置文件名 */
  configs: string[];
  backups: { count: number; size: number };
  lines: string[];
}

/** install 要不要问项目名称:needsName 照 spec D3;recorded 为真时 defaultName 是记下的名字,否则是默认名字。 */
export interface InstallNamePlan {
  needsName: boolean;
  defaultName: string | null;
  recorded: boolean;
}

/** 并旧数据的结果(spec D30),由 install 按 kind 打 M1~M4。 */
export interface MergeOutcome {
  kind: 'merged' | 'already' | 'nothing' | 'failed';
  display: string;
  events: number;
  sessions: number;
  duplicates: number;
  /** M2 */
  notices: string[];
  /** already:记号里的时间 */
  mergedAt: string | null;
  /** failed:原因 */
  reason: string | null;
}
