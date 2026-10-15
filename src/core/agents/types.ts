/**
 * agent 描述层类型:cgraphx 支持的 AI 编码 agent 差异统一在 AgentProfile 中声明。
 */

/** 已知 agent id(登记顺序即优先级;未登记描述的 id 在 profiles 中不存在属预期)。 */
export const AGENT_IDS = ['claude-code', 'codebuddy'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

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
  /** 用于 PATH 检测的 CLI 命令名。 */
  readonly cliCommands: readonly string[];
  /** 写类工具名(task PostToolUse 匹配用)。 */
  readonly writeTools: readonly string[];
  readonly capabilities: { readonly statusLine: boolean; readonly contextMonitor: boolean };
  /** 部署资产时按序执行的字面替换规则。 */
  readonly assetReplacements: ReadonlyArray<readonly [from: string, to: string]>;
}

export interface SessionFromEnv { sessionId: string; agent: AgentId }
