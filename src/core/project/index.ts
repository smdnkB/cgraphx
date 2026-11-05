/**
 * project 子系统公共门面(spec:2026-11-05-数据按项目放用户目录 D1、D17;index C-12)。
 *
 * 外部调用方(主 CLI 的 install / uninstall 等)只通过本模块调用,不得直接伸手进内部模块。职责:
 * - F2 查和改名:这个目录属于哪个项目(showProject)、改项目名称(renameProject)、install 时问名字与记名字
 *   (planInstallName、applyInstallName)
 * - F4 并旧数据:把目录本地的旧库并进用户目录里这个项目的项目库,先备份、两段并、写记号后删旧表
 *   (mergeLegacyData、hasUnmergedLegacyData)
 * - F5 列出和删除:用户目录里的项目数据(listProjects、planRemoval、executeRemoval)
 * - 升级清理:清掉已下掉功能(平台同步、开发任务)留在数据位置与本地 `.cgraphx/` 的表和运行文件
 *   (cleanupRemovedFeatureData;spec:2026-11-05-下掉web与平台同步 F3 D6)
 *
 * 无库表。只依赖基础层(project-identity、repo-projects、user-data-dir、session-registry、data-location、directory、
 * db)与 timeline、replica 的门面(spec D1);它们都不依赖 project。命令注册 registerProjectCommands 在
 * cli.ts(同其他子系统,主 CLI 从 `../core/project/cli` import)。
 */

export type {
  InstallNamePlan,
  MergeOutcome,
  ProjectKind,
  ProjectListItem,
  ProjectRef,
  ProjectRootInfo,
  ProjectShowReport,
  RemovalPlan,
  RenameOutcome,
} from './types';
export { showProject } from './show';
export { renameProject, planInstallName, applyInstallName } from './name';
export { listProjects } from './list';
export { planRemoval, executeRemoval } from './remove';
export { mergeLegacyData, hasUnmergedLegacyData } from './merge';
export { cleanupRemovedFeatureData } from './cleanup';
export type { RemovedFeatureCleanup } from './cleanup';
export { ProjectError, PROJECT_ERROR_CODES, exitCodeForError } from './errors';
export type { ProjectErrorCode } from './errors';
