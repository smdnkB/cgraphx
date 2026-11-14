/**
 * Agent 接入契约。
 *
 * 一个 agent 提供一个 AgentAdapter:完整接入实现安装与会话能力,只读会话来源将 installation
 * 设为 null。Claude Code、CodeBuddy、Codex 和只读来源 DeepSeek 已经接入。
 *
 * 会话事实由调用方以 TSessionFact 指定(当前 cgraphx 使用 timeline 的 SessionFact),避免
 * agents 依赖 timeline。会话适配器只读宿主文件并返回事实,不操作 cgraphx 数据库、Git 钩子或看板。
 */

/** 调用方明确提供路径和环境,适配器不依赖进程当前工作目录。 */
export interface AgentAdapterContext {
  /** 目标项目根目录的绝对路径。 */
  readonly projectRoot: string;
  /** 当前用户目录的绝对路径。 */
  readonly userHome: string;
  /** 本次操作使用的环境变量。 */
  readonly env: Readonly<NodeJS.ProcessEnv>;
}

/** 目标项目状态:检测到宿主和已安装本工具是两个不同的判断。 */
export interface AgentInstallationState {
  /** 目标项目中检测到该 agent 的配置。 */
  readonly detected: boolean;
  /** 目标项目中存在本工具管理的安装内容。 */
  readonly installed: boolean;
}

export interface AgentFileChange {
  /** 发生变化或检查过的绝对路径。 */
  readonly path: string;
  readonly action: 'created' | 'updated' | 'unchanged' | 'removed' | 'not-found' | 'kept' | 'overwritten';
}

export interface AgentInstallationResult {
  readonly files: readonly AgentFileChange[];
  /** 用户可见的提示。 */
  readonly notices: readonly string[];
}

/** 由调用方提供的安装内容;适配器负责将其放到宿主认可的位置。 */
export interface AgentInstallInput {
  /** 资产源目录的绝对路径,含 skill 及其支持文件。 */
  readonly assetsDir: string | null;
  /** 本工具要写入 agent 指引文件的内容。 */
  readonly instructions: string | null;
  /** 本工具版本,供安装状态和版本提示使用。 */
  readonly version: string | null;
}

/** 当前安装器需要按宿主能力决定是否部署的可选集成。 */
export interface AgentHostCapabilities {
  readonly statusLine: boolean;
  readonly contextMonitor: boolean;
}

/** 支持完整安装的 agent 实现此接口;项目级 Git 钩子由调用方负责。 */
export interface AgentInstallationAdapter {
  readonly capabilities: AgentHostCapabilities;
  /** 不写入文件;项目不存在配置时返回未检测、未安装。 */
  detect(context: AgentAdapterContext): AgentInstallationState;
  /**
   * 在项目中安装或更新本工具的资产与宿主配置,重复执行应幂等。
   * 按现有安装策略覆盖与模板同名的资产,保留指引标记块外和清单外的内容。
   */
  install(context: AgentAdapterContext, input: AgentInstallInput): AgentInstallationResult;
  /**
   * 按现有模板清单移除同名资产,保留指引标记块外和清单外的内容;
   * 未安装时可调用,重复执行应幂等。
   */
  uninstall(context: AgentAdapterContext, assetsDir: string | null): AgentInstallationResult;
  /**
   * 创建项目副本时需携带的 agent 配置路径,相对于项目根;调用方负责复制与 Git 处理。
   * 只返回本项目内的路径,不返回用户目录或不存在的外部位置。
   */
  replicaPaths(context: AgentAdapterContext): readonly string[];
}

export interface AgentSessionFromEnvironment {
  /** 宿主注入的原始会话编号。 */
  readonly sessionId: string;
  /** 取到该编号的环境变量名,用于识别 Git 门禁覆盖情况。 */
  readonly envName: string;
}

export interface AgentSessionReadResult<TSessionFact> {
  /** 按文件顺序产生的统一会话事实;读取器不负责净化或持久化。 */
  readonly facts: readonly TSessionFact[];
  /** 下次读取的字节偏移;不得越过未完整写入或仍需等待配对的内容。 */
  readonly consumedBytes: number;
}

/** 会话变量的轻量契约,供门禁在不依赖读取器时使用。 */
export interface AgentSessionEnvironmentAdapter {
  /** 可能提供会话编号的环境变量名,按优先级排列;供项目级 Git 门禁生成探针。 */
  readonly sessionIdEnvNames: readonly string[];
  /** 从给定环境读取原始会话编号;未提供或为空时返回 null。 */
  sessionFromEnvironment(context: AgentAdapterContext): AgentSessionFromEnvironment | null;
}

/** 会话发现、解析和编号归属;完整安装与只读来源均可实现。 */
export interface AgentSessionAdapter<TSessionFact> extends AgentSessionEnvironmentAdapter {
  /**
   * 将会话编号归属到根会话,以便关联子 agent 的工具事件与提交。
   * 不能确认归属时返回 null,调用方保留原始编号;禁止猜测父子关系。
   */
  resolveRootSessionId(context: AgentAdapterContext, sessionId: string): Promise<string | null>;
  /** 本机缺少读取依赖等原因;可以读取时返回 null,目录尚不存在不算错误。 */
  unavailableReason(context: AgentAdapterContext): string | null;
  /** 返回会话文件绝对路径,包括可发现的子 agent 文件;去重并按稳定顺序排列。 */
  listSessionFiles(context: AgentAdapterContext): Promise<readonly string[]>;
  /**
   * 从给定字节偏移读取一个会话文件,并返回统一事实及安全偏移。
   * 未知记录应跳过;文件截断、未完成行、工具调用跨批次与重复读取须有明确处理。
   * 会话头须包含可靠的开始目录;主子会话和消息 ID 应按真实来源确定。
   */
  readSessionFile(context: AgentAdapterContext, filePath: string, fromByteOffset: number): Promise<AgentSessionReadResult<TSessionFact>>;
  /**
   * 会话索引中该文件对应的编号;本次没有足够信息时可返回之前保存的编号或 null。
   * 不应假设所有宿主都能直接从文件名取得会话编号。
   */
  sessionIdForFile(filePath: string, facts: readonly TSessionFact[], previousSessionId: string | null): string | null;
  /** 可从文件布局确定的主会话文件绝对路径;无法确定时返回 null。 */
  parentSessionFile(filePath: string): string | null;
}

/**
 * 一个已知宿主的完整接入入口。
 * id 必须稳定且唯一,aliases 用于兼容旧名称;不要求新增 agent 时修改封闭的类型枚举。
 * 不支持某项能力时显式设为 null,调用方据此决定是否列入安装器或会话补录。
 */
export interface AgentAdapter<TSessionFact = unknown> {
  readonly id: string;
  readonly displayName: string;
  readonly aliases: readonly string[];
  readonly installation: AgentInstallationAdapter | null;
  readonly sessions: AgentSessionAdapter<TSessionFact> | null;
}
