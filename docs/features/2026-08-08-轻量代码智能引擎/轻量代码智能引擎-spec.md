# 规格说明: 轻量代码智能引擎

> feature-id: 2026-08-08-轻量代码智能引擎
> 负责人: liulongfei
> 日期: 2026-08-08
> 上游输入: 2026-08-08 需求澄清(对话结论)+ [移植冲突探索报告](./gitnexus-core-port-conflict-exploration.md)

---

## 1. 目标与范围

### 1.1 目标

构建一个**轻量代码智能引擎**:解析代码库建立知识图谱,向 AI agent 提供两类核心能力——

1. **写代码时**:方便地获取调用关系(谁调用谁、符号上下文、调用路径);
2. **改完代码后**:分析影响范围(改动波及的符号与执行流)。

引擎以 **CLI 为唯一对外接口**,暂作为独立项目;成熟后并入 **cgraphx 2.0**(该仓库已整体移除 1.x 图谱层)作为**可选子系统**——用户可选择本引擎、codegraph(1.x)或其他同类产品。

### 1.2 包含范围(v1)

- **项目命名 `cgraph`**,仓库目录 `/Users/smdnk/objects/ai/cgraph/`(与其他项目并列),先纯本地 git,不推远端;v1 CLI 命令名为 `cgraph`;并入 cgraphx 2.0 后以 `cgraphx code *` 子命令族形式存在(集成时另行设计);
- 以**当前 GitNexus 主分支**(工作区副本 `/Users/smdnk/objects/ai/GitNexus`,1.6.9+)为基线做裁剪;
- 移植 fork(`/Users/smdnk/objects/ai/code-workflow/gitnexus/gitnexus`,v1.6.6+定制)的 4 项定制资产:workspace-config 解析、rpc-edges 阶段、http-api-calls 阶段、plain-folder 模式,以及 RCALLS 纳入 impact 遍历;
- §4 所列 10 个 CLI 能力 + 索引构建/状态命令;
- v1 语言:**Java / JavaScript / TypeScript**;
- 保留执行流(processes)抽象与 Spring 系列阶段。

### 1.3 明确的非目标(v1 不做)

| 非目标 | 说明 |
|---|---|
| MCP server | 不提供 MCP 接入层;agent 经 CLI 调用(未来 MCP 由 cgraphx 侧承担) |
| Web UI / HTTP serve | 删除 `gitnexus-web`、`server/` 整层 |
| embeddings / 向量检索 | 删除 embeddings 子系统与 onnxruntime 依赖 |
| **query / FTS 概念检索** | `query` 命令与 FTS 索引整体砍除。发现层(概念 → 符号/执行流)由调用方承担:cgraphx 知识库召回(knowledge-recall)提供精准入口,兜底为 grep + `cypher` CONTAINS;analyze 不再建 FTS 索引 |
| PDG 层 | 不做 `--pdg`、`explain`、`pdg_query`、taint/call-summaries 阶段 |
| 跨仓 group 机制 | 无 Contract Registry / group_* 工具;一个项目一张图,契约连接靠 workspace 配置(§6) |
| rename | 写侧重构工具,v1 砍掉 |
| 自动增量同步 | 无 FSEvents/watch;索引刷新为手动全量重建(§5.3) |
| markdown / COBOL 阶段 | v1 语言范围之外 |
| wiki 生成、skills/plugin 安装器、agent-context 注入 | 不向被索引项目写 CLAUDE.md/AGENTS.md 块 |

### 1.4 平台支持矩阵

- **正式支持**:macOS(arm64/x64)、Linux(x64/arm64)、Windows(x64)——即 `@ladybugdb/core` 预编译包覆盖的五平台;安装为预编译二进制下载,主流平台**无需构建工具链**;
- **不支持**:Windows ARM(无 LadybugDB 预编译包);
- **兜底**:无预编译环境(老 glibc、其他架构)走 Docker 镜像(保留上游 Dockerfile.cli,随裁剪适配);
- **native 依赖策略**:v1 保持基线 native 路线(LadybugDB + tree-sitter);解析层 WASM 化(codegraph 1.x 路线)留作未来选项,v1 不做——WASM 化不能消除 LadybugDB 的 native 属性,且有解析性能回退风险(威胁 §11.1 索引耗时锚点)。

---

## 2. 术语与业务对象

| 术语 | 含义 |
|---|---|
| **项目根(workspace)** | 索引单位。一个目录,**可以不是 git 仓库**;其下每个子工程可各自独立 git 管理(hx 模式) |
| **子工程(service)** | 项目根下的独立工程目录,在 workspace 配置的 `services` 中声明 |
| **一项目一图** | 一个项目根产出一张知识图谱,覆盖所有子工程;不使用跨仓 group 机制 |
| **plain-folder 模式** | 项目根无 `.git` 时自动降级为纯目录索引:不跟踪 commit、不做分支作用域 |
| **执行流(process)** | 引擎把调用链聚合成的端到端业务流程(如 hx 的 300 条);impact/query/context 的结果维度之一 |
| **workspace 配置文件** | 项目根下的声明式配置(承载 services 清单、RPC 注解定义、httpApi 映射),文件名 **`cgraphx-workspace.yaml`**(启用新名,**不兼容旧名** `gitnexus-workspace.yaml`) |
| **RCALLS / HTTP_CALLS** | 跨服务契约边:RPC 注解匹配产生的调用边 / 前端 HTTP 调用到后端方法的边 |
| **ExternalService** | 合成节点:只有消费方(或只有提供方)的 RPC 服务,挂外部服务节点使 impact 可追踪外部依赖 |
| **scope-resolution** | GitNexus 的作用域受限调用解析(对比全局名匹配),本引擎的核心解析质量来源 |
| **GitNexus / fork / codegraph / cgraphx** | GitNexus=上游基线;fork=用户的 GitNexus 定制副本(1.6.6+);codegraph=cgraphx 1.x(含旧图谱层);cgraphx=2.0 源仓库(无图谱层,本引擎未来的宿主) |

---

## 3. 使用者与触发场景

- **直接使用者**:AI 编码 agent(Claude Code 等)与开发者本人,经 shell 调用 CLI。
- **场景 A(写代码时)**:agent 需要某符号的调用者/被调用者、所属执行流、两符号间调用路径、自由查图。**发现层不在本引擎职责内**:概念 → 符号入口由 cgraphx 知识库召回(knowledge-recall)提供,兜底 grep + `cypher`;agent 拿到符号名后经本引擎查图。
- **场景 B(改完代码后)**:agent/开发者把 git 变更映射到受影响符号与执行流,并对计划修改的符号做上下游爆炸半径评估。
- **编排方**:cgraphx 的 skill 体系负责在合适时机调用本引擎 CLI;本引擎自身不含流程编排逻辑。

---

## 4. v1 能力契约(CLI)

**通用契约**:
- 每个能力对应一个 CLI 子命令;参数风格沿用 GitNexus CLI-direct 模式(位置参数 + `--repo`/`--limit` 等选项);
- 结果以**结构化 JSON 输出到 stdout**,错误信息走 stderr,失败时退出码非零;
- 全部能力为**只读查询**,不修改用户源码、不修改图索引(`analyze` 除外);
- 单项目单图场景下不提供 `--repo` 多仓选择语义(仅一个已索引项目时可省略仓库参数)。

| 子命令 | 行为契约 |
|---|---|
| `analyze [path]` | 对项目根构建/重建全量索引。根无 `.git` 时自动降级 plain-folder 模式并给出警告(不报错退出)。子工程声明在 workspace 配置中时,配置内目录不受 gitignore 剪枝影响(保证子工程被完整扫描) |
| `status` | 报告索引是否存在、统计信息(文件/节点/边/执行流数)、索引时间;plain-folder 索引不报告 commit 新鲜度 |
| `context <name>` | 符号 360° 视图:调用者、被调用者、所属执行流;同名歧义时返回候选清单(含文件/行/uid)供消歧,可用 `--file`/`--uid` 精确指定 |
| `trace <from> <to>` | 两符号间最短有向调用路径(call + 类成员边);支持文件/uid 消歧 |
| `cypher <query>` | 对图执行原始 Cypher 查询,返回行集 |
| `impact <target>` | 改动爆炸半径:上游(依赖方)/下游(依赖)遍历,按深度返回受影响符号、受影响执行流与风险摘要;**遍历边类型包含 RCALLS 与 HTTP_CALLS**(跨服务影响可见);**仅 callgraph 模式,无 PDG/语句级** |
| `detect-changes` | 将 git 变更映射为受影响符号与执行流;项目根含多个 git 子工程时,聚合各子工程的变更(scope: unstaged/staged/all/compare);项目根与各子工程均无 git 时明确报错说明不可用 |
| `route-map` | API 路由 → handler → 消费方映射(含 workspace 配置声明的前端 HTTP 消费关系) |
| `api-impact <route/handler>` | 针对 API 路由 handler 的改动前影响报告 |
| `shape-check` | 接口响应形状 vs 消费方属性访问的不匹配检测 |
| `tool-map` | MCP/RPC 工具定义与 handler 映射 |

**已砍除、不得出现在 CLI 中的能力**:`query`(概念检索)、FTS 索引、`rename`、`explain`、`pdg_query`、`group_*`、`list_repos`、embedding 相关开关。

**CLI 命名**:v1 独立命令为 `cgraph`;并入 cgraphx 2.0 后映射为 `cgraphx code *` 子命令族(集成阶段设计,不改变本 spec 的行为契约)。不提供"列出本机所有索引"类命令(无全局注册表,§8)。

---

## 5. 索引模型

### 5.1 索引单位
- 索引建在**项目根**;一张图覆盖项目根内所有被扫描文件(含所有子工程);
- 子工程各自的 git 仅用于变更检测与(可选的)新鲜度提示,不影响索引边界。

### 5.2 workspace 配置文件
- 文件名:**`cgraphx-workspace.yaml`**,位于项目根;不读取旧名 `gitnexus-workspace.yaml`(存量项目迁移见 §10);
- **缺失时引擎仍可运行**:rpc/http-api 契约阶段跳过,其余阶段正常(单仓库普通项目无需配置);
- 配置存在时声明:`services` 子工程清单、RPC 注解定义、httpApi 前端与 URL 映射(详见 §6)。

### 5.3 刷新方式
- v1 仅**手动全量重建**(重新 `analyze`);hx 规模(~1 万文件)全量 ~2 分钟为可接受基线;
- 不提供增量索引、文件监听、后台同步。

### 5.4 流水线范围
保留阶段链:scan → structure → springConfig → parse → routes/tools/orm → crossFile → scopeResolution → springAutoConfiguration/springAop → pruneLocalSymbols → mro → springAopInheritance → di → communities → processes,**外加移植的 rpcEdges、httpApiCalls 阶段**。移除:markdown、cobol、taint/call-summaries(PDG)。

---

## 6. 契约连接规则(workspace 配置语义)

### 6.1 RPC 连接
- 配置声明:提供方注解、消费方注解、注解中 serviceId 的参数位置、匹配策略(v1 策略为 **methodName**:按 serviceId + 方法名跨服务匹配);
- 注解检测作用于接口/类级声明;方法级按配置匹配生成 **RCALLS** 边;
- **单边情形**:只有消费方无提供方(如调用外部服务)或只有提供方无消费方时,挂 **ExternalService** 合成节点,保证 impact 可追踪;
- 匹配去重按 **methodId**(同一 serviceDir 下重名方法不串边)。

### 6.2 前端 HTTP 连接
- 配置声明前端工程目录、API 定义目录、前端 HTTP 框架(v1:axios/fetch/自动检测);
- 从前端代码提取 API URL,按配置的 **URL 前缀 → 服务目录**映射定位后端服务,匹配到后端方法节点生成 **HTTP_CALLS** 边;未匹配的调用保留记录(统计可见)。

### 6.3 通用性要求(已锁定业务决策)
- **任意 RPC 框架可配**:注解名、serviceId 参数位置、匹配策略均来自配置,不得硬编码特定框架(如 @Center/@RCenter);
- **v1 每个 workspace 仅支持单个 RPC 框架配置**(YAGNI——当前无多框架场景);schema 设计上**预留数组化演进空间**(rpc 配置的字段组织不得把"单对象"语义写死到未来无法兼容扩展为多框架数组);
- httpApi 的 URL 映射为显式配置,不做未声明服务的自动推断。

---

## 7. 语言支持

- v1:**Java、JavaScript、TypeScript**(含 JSX/TSX);
- **语法包裁剪**:v1 默认只打包 java / javascript / typescript 三个 tree-sitter 语法(native 依赖面从基线 11 个语法包降到 3 个);其余语言语法保留 GitNexus 既有的 optional-grammar 懒加载机制,后续语言迁移时再启用,不随 v1 分发;
- Spring 生态阶段保留(springConfig / springAop / springAutoConfiguration / DI),服务 Java Spring 项目(hx 场景);
- 架构保持 GitNexus 的多语言 provider 扩展结构,其他语言(Go/Python 等)后续迁移,**迁移时不重构既有阶段链**;
- v1 不为未支持语言报错阻断:未识别语言的文件按结构层(文件/目录节点)收录,不参与符号级解析。

---

## 8. 系统边界与集成契约

- **对外仅 CLI**;不提供 MCP、HTTP、常驻守护进程;
- **无全局状态**:不维护全局索引注册表(GitNexus 的 `~/.gitnexus/registry.json` 概念一并砍除);CLI 一律对"当前目录或显式路径的项目根索引"操作,索引数据只落在项目根的数据目录(与 cgraphx 的 `.cgraphx/` 项目本地哲学一致;gitignore 由用户自行处理);
- 核心查询/遍历能力保留**内部编程 API 接缝**(LocalBackend 层语义),使未来 cgraphx 能以库形式调用而非仅 shell 封装——此接缝为 plan 必须保留项;
- **不向被索引项目写入任何文件**(不注入 CLAUDE.md/AGENTS.md,不安装 skills);
- 与 cgraphx 2.0 的集成形态(子模块/子系统接口,命令映射为 `cgraphx code *`)在本项目成熟后另行设计,不属于本 spec 范围;本 spec 仅承诺"可被集成"的上述接缝。

---

## 9. 异常与边界场景

| 场景 | 行为 |
|---|---|
| 项目根无 `.git` | plain-folder 降级 + 警告;索引正常构建;`detect-changes` 在无子工程 git 时报错说明 |
| 无 workspace 配置 | 契约阶段跳过,其余正常 |
| workspace 配置格式错误 | `analyze` 明确报错并指出配置问题,不产出半索引 |
| 符号名歧义 | `context`/`impact` 返回候选清单与消歧指引(文件/uid),不以猜测结果冒充 |
| 查询无结果 | 明确返回空结果语义(不报错) |
| 索引不存在时调用查询命令 | 明确错误提示"未索引",退出码非零 |
| 子工程目录被 gitignore 规则覆盖 | workspace `services` 声明的目录不受剪枝(§4 analyze 契约) |
| Cypher 语法错误 | 返回错误信息,退出码非零 |
| 安装平台无 LadybugDB/tree-sitter 预编译包 | 安装期明确提示不支持,指向 Docker 兜底;不以半残状态完成安装 |

---

## 10. 兼容性、迁移与既有资产

- **基线**:当前 GitNexus 主分支;fork(v1.6.6)仅作定制资产来源,不作代码基线;
- fork 的 `72039269`(上游在途代码导入)不属于迁移资产,整体丢弃;
- **存量 workspace 配置迁移**:v1 只认 `cgraphx-workspace.yaml`;已有 `gitnexus-workspace.yaml` 的项目(如 hx)需将文件改名,内容 schema 不变(字段按 §6.3 泛化调整由 plan 给出迁移对照);
- fork 定制阶段的既有测试(workspace-config / rpc-edges / http-api-calls / 消歧)**随代码一并迁移**,作为回归基线;
- 对 GitNexus 上游无兼容义务:不承诺索引格式互认、不承诺 CLI 参数与上游一致(参数风格沿用但可裁剪);
- cgraphx 1.x(codegraph)的图谱能力不在本项目中延续;cgraphx 侧的 L3(scope-bounded resolution)改造已冻结,与本项目不并行。

---

## 11. 验收标准与测试关注点

### 11.1 hx 实测锚点(移植正确性验收)
在 `/Users/smdnk/objects/java/hx`(9 子工程、~9800 文件、根非 git)上:
- 全量索引耗时【2026-08-10 T-16 实测:冷 ~320s / 暖 ~270s(warm parse-cache 已补回,解析阶段冷~60s→暖~6s 10×)】。原"~2min"锚点对 v1 全量重建架构不可达:parse-cache 只优化解析(占总流水线 ~20%),其余 scope-resolution/图构建/LadybugDB 加载/communities/processes(~265s)是全量重建固有成本,到 2min 需增量索引(v1 按设计移除)。**耗时不再作移植正确性锚点**(节点/边/RCALLS/ExternalService 才是);冷/暖差异用于验证 parse-cache 机制本身。
- **节点/边量级 223k / 433k ± 10%**(移植正确性主锚点;2026-08-09 实测 218,753 nodes / 450,066 edges,在容差内);
- **RCALLS 边**:fork 的"1,595"是 matched-only(fork 自身有 csv-generator 不持久化 ExternalService 的缺陷,orphan 边丢失);cgraph 修复后(DEFECT-1)实测 **3,115 条(1,447 matched + 1,668 orphan)**——cgraph 正确持久化了 fork 丢的 orphan 边,故总数超 fork 属预期。matched 计数(1,447 vs fork 1,595)受 hx 代码漂移影响;
- **执行流 ≈ 160 条**(1.6.9 实测自然值;**注:fork 的"300"是 `maxProcesses=300` 硬上限撞顶,非真实计数**——上游 #2198 移除该 cap 后,cgraph 报自然值 162;此值随 scope-resolution 版本与 hx 漂移变化,不适用 ±10% 容差);
- 单边 RPC(如 @RCenter 调外部服务)挂 ExternalService,且 `impact` 遍历可达(2026-08-09 实测 ExternalService 节点 35 个,DEFECT-1 修复后入图);
- 前端(so-pub-web / so-assist-web)axios 调用产生 HTTP_CALLS 边(2026-08-09 实测 601,匹配数 > 0,未匹配数有统计)。

### 11.2 功能验收
- §4 全部 CLI 命令冒烟通过(含 JSON 输出与退出码约定);
- `impact` 对跨服务调用链给出上下游符号(验证 RCALLS 已入遍历);
- `detect-changes` 在子工程内有未提交变更时正确映射受影响符号;
- 无 workspace 配置的普通单仓库项目(任一 JS/TS 项目)索引与查询正常;
- 裁剪验收:构建产物中不含 MCP server / web / embeddings / PDG / group 相关模块;依赖表无 onnxruntime。

### 11.3 测试关注点
- fork 迁移测试全绿;
- plain-folder × 多分支/新鲜度逻辑的组合(无 git 时不触发分支作用域路径);
- workspace 配置缺失/错误/边界(空 services、注解无参数、URL 无匹配)用例。

---

## 12. Plan 编写约束

1. **裁剪按模块分批**进行,每批后跑构建与既有测试,不允许一次性大删改;
2. 移植的定制阶段**必须经 PhaseRegistry 注册**(基线现行机制),不得恢复手写数组;
3. RCALLS/HTTP_CALLS 纳入 impact 时,**必须全量重定位基线中所有边类型枚举处**——含 JS 数组、内联 Cypher `WHERE r.type IN [...]` 字面量、边置信度表(探索报告 §3 已列为最大漂移点),不得只搬 fork 的 +4 行补丁;
4. **必须保留 LocalBackend 级内部 API 接缝**(§8),裁剪 MCP 层时不得把查询能力私有化进 CLI;
5. 不得引入:MCP server 依赖链、onnxruntime/embeddings、web UI 包、PDG 子系统;
6. fork 的匹配语义(serviceId+methodName、methodId 去重、ExternalService 挂载)为已验证行为,**移植时不得顺手重设计**;变更须回跳本 spec;
7. workspace 配置的解析须按 §6.3 通用化重构(去 @Center/@RCenter 硬编码),泛化 schema 设计在 plan 中给出、受 §13 待确认项约束;
8. v1 不新增语言 provider;语言扩展位保持 GitNexus 既有结构;
9. **语法包只打包 java/js/ts 三个**,其余语法不得进入默认依赖(保留 optional-grammar 机制供后续迁移);
10. **FTS 随 query 整体移除**:analyze 不再创建 FTS 索引,不保留任何替代搜索实现(发现层职责在调用方,§3)。

## 13. 不可留到实现期的决策

- v1 能力集与砍除清单(§1.2/§1.3/§4)——实现不得自行增减工具;**query/FTS 已砍,发现层由 cgraphx 知识库召回承担**;
- 平台支持矩阵(§1.4):mac×2 / linux×2 / win-x64 正式支持,win-arm64 不支持,Docker 兜底;native 路线保留,WASM 化不做;
- 语法包:v1 仅 java/js/ts 三个(§7);
- 项目命名 `cgraph`、仓库 `/Users/smdnk/objects/ai/cgraph/`、本地 git、未来并入形态 `cgraphx code *`(§1.2);
- CLI-only、无 MCP、无全局注册表(§8);
- 存储引擎 **LadybugDB**(随基线;`cypher` 能力与其绑定,换存储属架构级变更须回跳 spec);
- 索引单位 = 项目根、一项目一图(§5.1);
- 手动全量刷新、无增量(§5.3);
- workspace 配置文件名 `cgraphx-workspace.yaml`、不兼容旧名(§5.2);
- v1 单 RPC 框架配置 + schema 预留数组化演进(§6.3);
- 任意 RPC 框架可配的通用性要求(§6.3);
- 匹配语义:methodName + serviceId、methodId 去重、单边挂 ExternalService(§6.1);
- 基线选择:当前 GitNexus 主分支,fork 仅作资产来源(§10);
- 验收锚点数值(§11.1)。

## 14. 待确认项

无——全部确认项已关闭(2026-08-08):RPC 框架配置数(单框架+预留演进)、项目命名(cgraph/本地 git)、存储(LadybugDB)、配置文件名(`cgraphx-workspace.yaml` 不兼容旧名)、`list_repos`(砍)、query/FTS(砍)、平台矩阵(§1.4)、语法包裁剪(java/js/ts)。本 spec 定稿,可进 plan。
