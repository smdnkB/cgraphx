/**
 * agent 描述层类型:cgraphx 支持的 AI 编码 agent 差异统一在 AgentProfile 中声明。
 */

/** agent id 由登记处提供,新增来源不受封闭枚举限制。 */
export type AgentId = string;

/** 会话文件读取器标识(每家已登记 agent 与只读来源各一个,读取器在 timeline/ingest/;接新 agent = 加一个读取器)。 */
export type SessionReaderId = string;

/**
 * 会话来源 id:已登记 agent 之外,还有只读会话来源(如 deepseek——只读它的会话文件进时间线,
 * 不进安装器 / 副本;会话 id 进提交归属、门禁与会话提示,所以不是 AgentId、没有 AgentProfile,D12)。
 */
export type SessionSourceId = string;

import type { AgentSessionEnvironmentAdapter } from './adapter';

/** 只读会话来源:会话文件在哪、怎么列;补录与重建的会话文件枚举统一经它(sources.ts)。 */
export interface SessionSource extends AgentSessionEnvironmentAdapter {
  readonly id: SessionSourceId;
  readonly displayName: string;
  /** 会话文件根目录(含环境变量覆盖语义);来源没装 / 没有固定位置 → null(不列举)。 */
  sessionsRoot(env?: Readonly<NodeJS.ProcessEnv>, userHome?: string): string | null;
  /** 列出根目录下全部会话文件(绝对路径,升序)。 */
  listFiles(root: string): string[];
  /** 会话 id 环境变量名(提交归属、门禁片段与提示按它取值);来源不提供时为 null。 */
  readonly sessionIdEnv: string | null;
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
  /** 指引位于项目根而非配置目录。 */
  readonly instructionsAtRoot?: boolean;
  /** 项目根下除配置目录、指引文件外还要带走的额外配置文件(相对项目根,如 `.mcp.json`)。 */
  readonly extraConfigFiles: readonly string[];
  /** settings 文件名(位于配置目录内)。 */
  readonly settingsFileName: string;
  /** 宿主不使用 Claude 格式的 settings 时不读写 JSON 配置。 */
  readonly settingsFormat?: 'claude-json' | 'none';
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
  /** 会话目录有特殊环境变量语义时使用,否则按 sessionsDir 解析。 */
  readonly sessionRoot?: (env: Readonly<NodeJS.ProcessEnv>, userHome: string) => string | null;
  readonly sessionFileLayout?: 'project-jsonl' | 'recursive-jsonl';
  readonly capabilities: {
    readonly statusLine: boolean;
    readonly contextMonitor: boolean;
  };
  /** 部署资产时按序执行的字面替换规则。 */
  readonly assetReplacements: ReadonlyArray<readonly [from: string, to: string]>;
  readonly transformAssetText?: (content: string) => string;
  readonly assetTopLevel?: readonly string[];
  readonly excludedAssetPaths?: readonly string[];
  readonly managedRootAssets?: readonly string[];
}

/** 从环境变量解析出的会话:agent 是会话来源 id(含只读来源),sessionIdEnv 是取到值的变量名。 */
export interface SessionFromEnv { sessionId: string; agent: SessionSourceId; sessionIdEnv: string }
