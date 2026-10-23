/** 版本记录文件名,放在各 agent 配置目录下,如 `.claude/cgraphx-version.json`(spec D1)。 */
export const SKILL_VERSION_FILE = 'cgraphx-version.json';

/** 首个写版本记录的发布版本:没有记录的项目按「在它之前装的」提示(spec 提示 B)。 */
export const FIRST_RECORDED_VERSION = '2.0.11';

/** 提示行开头:要求 agent 在第一句回复里转告用户(spec D8)。 */
export const NOTICE_PREFIX = 'cgraphx 提示(请在你的第一句回复里告诉用户):';

/** 提示行结尾:更新命令与生效时机(spec 提示 A / B 共用)。 */
export const NOTICE_UPDATE_HINT = '运行 cgraphx install -y 更新(只覆盖 cgraphx 自带的文件),新开会话后生效。';

/** 不提示的会话开始类型:上下文压缩发生在会话中途(spec D7)。 */
export const SILENT_SOURCES: ReadonlySet<string> = new Set(['compact']);

/** settings 中判定「已接 task 会话开始 hook」的命令子串(spec D6)。 */
export const TASK_SESSION_START_COMMAND = 'cgraphx task-session-start-hook';
