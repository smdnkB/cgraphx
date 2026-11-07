/**
 * agent 描述层类型:cgraphx 支持的 AI 编码 agent 差异统一在 AgentProfile 中声明。
 */

/** 已知 agent id(登记顺序即优先级;未登记描述的 id 在 profiles 中不存在属预期)。 */
export const AGENT_IDS = ['claude-code', 'codebuddy'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

/** 会话文件读取器标识(每家已登记 agent 与只读来源各一个,读取器在 timeline/ingest/;接新 agent = 加一个读取器)。 */
export const SESSION_READER_IDS = ['claude-transcript', 'codebuddy-transcript', 'deepseek-session'] as const;
export type SessionReaderId = (typeof SESSION_READER_IDS)[number];

/**
 * 会话来源 id:已登记 agent 之外,还有只读会话来源(如 deepseek——只读它的会话文件进时间线,
 * 不进安装器、部署配置与提交门禁,所以不是 AgentId、没有 AgentProfile,D12)。
 */
export type SessionSourceId = AgentId | 'deepseek';

/** 只读会话来源:会话文件在哪、怎么列;补录与重建的会话文件枚举统一经它(sources.ts)。 */
export interface SessionSource {
  readonly id: SessionSourceId;
  readonly displayName: string;
  /** 会话文件根目录(含环境变量覆盖语义);来源没装 / 没有固定位置 → null(不列举)。 */
  sessionsRoot(): string | null;
  /** 列出根目录下全部会话文件(绝对路径,升序)。 */
  listFiles(root: string): string[];
  /** 会话文件读取器标识。 */
  readonly sessionReader: SessionReaderId;
  /** 本机读不了时的提示(如 Node 没有 zstd API);能读 → null。 */
  unavailableReason(): string | null;
}

export interface AgentProfile {
  readonly id: AgentId;
  readonly displayName: string;
  /** 兼容旧用法的别名(如 `-t claude`)。 */
  readonly legacyIds: readonly string[];
  /** 项目内配置目录名(如 `.claude`)。 */
  readonly configDirName: string;
  /** 指引块所在文件名(如 `CLAUDE.md`)。 */
  readonly instructionsFileName: string;
  /** 项目根下除配置目录、指引文件外还要带走的额外配置文件(相对项目根,如 `.mcp.json`)。 */
  readonly extraConfigFiles: readonly string[];
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
  readonly capabilities: {
    readonly statusLine: boolean;
    readonly contextMonitor: boolean;
  };
  /** 部署资产时按序执行的字面替换规则。 */
  readonly assetReplacements: ReadonlyArray<readonly [from: string, to: string]>;
}

export interface SessionFromEnv { sessionId: string; agent: AgentId }
