/**
 * board 子系统公共门面(2026-11-06-agent看板 D1 🔒)。
 *
 * 外部调用方(cli、server)只经本门面,不得直接伸手进 match / compute / versions 内部模块;board 只
 * import project、timeline、features、replica、agents、release 六个门面与基础层,不依赖任何子系统
 * 内部模块。轻形态:无库表、无 schema,数据全部现算——认任务与认版本都是纯函数,每次补录后重算,
 * 不写绑定(D14、D15)。
 * 看板除补录外不写任何东西(全局约束)。命令注册 registerBoardCommands 在 cli.ts(T-5),服务与页面在
 * server.ts / page.html(T-4)。
 */

export type {
  BoardData,
  BoardProject,
  BoardTask,
  TaskVersion,
  BoardSession,
  BoardProjectGroup,
  BoardSyncItem,
} from './types';
// 补录结果类型(timeline 门面的再导出,CLI 的逐项目输出要用)
export type { TimelineSyncOutcome, TimelineSyncStatus } from '../timeline';
export { enumerateBoardGroups, syncProjects, computeBoardData } from './compute';
export { BoardError, BoardDataError, exitCodeForError } from './errors';
