/**
 * agent 描述层类型:cgraphx 支持的 AI 编码 agent 差异统一在 AgentProfile 中声明。
 */

/** 已知 agent id(登记顺序即优先级;未登记描述的 id 在 profiles 中不存在属预期)。 */
export const AGENT_IDS = ['claude-code', 'codebuddy'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

/** 会话文件读取器标识(每家已登记 agent 一个,读取器在 timeline/ingest/;接新 agent = 加一个读取器)。 */
export const SESSION_READER_IDS = ['claude-transcript', 'codebuddy-transcript'] as const;
export type SessionReaderId = (typeof SESSION_READER_IDS)[number];

export interface AgentProfile {
  readonly id: AgentId;
  readonly displayName: string;
  /** 兼容旧用法的别名(如 `-t claude`)。 */
  readonly legacyIds: readonly string[];
  /** 项目内配置目录名(如 `.claude`)。 */
  readonly configDirName: string;
  /** 指引块所在文件名(如 `CLAUDE.md`)。 */
  readonly instructionsFileName: string;
  /** settings 文件名(位于配置目录内)。 */
  readonly settingsFileName: string;
  /** 项目根目录环境变量名。 */
  readonly projectDirEnv: string;
  /** 会话 id 环境变量名;agent 不提供时为 null。 */
  readonly sessionIdEnv: string | null;
  /** 会话文件目录相对家目录的路径段(如 `['.claude','projects']`);agent 会话文件不在固定位置时为 null。 */
  readonly sessionsDir: readonly string[] | null;
  /** 会话目录可被环境变量挪走时的变量名(sessionsDirEnv 设了以它为根拼 sessionsDir);没有为 null。 */
  readonly sessionsDirEnv: string | null;
  /** 会话文件读取器标识。 */
  readonly sessionReader: SessionReaderId;
  /** 用于 PATH 检测的 CLI 命令名。 */
  readonly cliCommands: readonly string[];
  /** 写类工具名(task PostToolUse 匹配用)。 */
  readonly writeTools: readonly string[];
  readonly capabilities: {
    readonly statusLine: boolean;
    readonly contextMonitor: boolean;
    /** 宿主是否有 PostToolUseFailure hook 事件(失败调用经它上报)。 */
    readonly postToolUseFailure: boolean;
  };
  /** 部署资产时按序执行的字面替换规则。 */
  readonly assetReplacements: ReadonlyArray<readonly [from: string, to: string]>;
}

export interface SessionFromEnv { sessionId: string; agent: AgentId }
