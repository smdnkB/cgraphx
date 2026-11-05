/**
 * replica 子系统公共门面(plan C-4)。
 *
 * 外部调用方必须用它 —— 不得直接伸手进内部模块(task、sync、features、cli 一律只 import 本门面)。
 * 职责:需求副本的开、列、删与登记(主目录 `.cgraphx/replicas/<副本目录名>.json`,spec D19);
 * 是不是副本、主目录在哪(replicaLinkOf,只给版本流程与 features 用);以及根汇总:调用方传入 timeline
 * 记下的根和当前根,这里挂上副本登记(spec:2026-11-05-数据按项目放用户目录 D11)。无库表,只依赖基础层
 * (directory、db)与 agents 门面(spec D1)。命令注册 `registerReplicaCommands` 在 cli.ts。
 */

export type {
  CreateReplicaResult,
  ProjectRoot,
  RemoveReplicaResult,
  ReplicaEntry,
  ReplicaLink,
  ReplicaLinkState,
  ReplicaStatus,
} from './types';
export { replicaLinkOf } from './main-dir';
export {
  listProjectRoots,
  listReplicas,
  locateFeatureRoot,
  matchProjectRoot,
  replicaOfCwd,
  resolveMainRoot,
} from './roots';
export { createReplica } from './create';
export { listReplicaStatus } from './status';
export { removeReplica } from './remove';
export { ReplicaError, exitCodeForError } from './errors';
