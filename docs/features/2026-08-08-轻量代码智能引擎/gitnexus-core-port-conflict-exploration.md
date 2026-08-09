# 移植冲突探索:fork 定制 → 当前 GitNexus 基线

> 日期:2026-08-08 · 状态:探索完成,供 spec/plan 消费
> 背景:新项目 = 当前 GitNexus 主分支(裁剪)+ fork 定制阶段(移植),CLI-only
> fork 位置:`/Users/smdnk/objects/ai/code-workflow/gitnexus/gitnexus`(v1.6.6 + 10 个定制 commit)
> 基线位置:`/Users/smdnk/objects/ai/GitNexus`(v1.6.9,main,含 8 月最新修复)

## 1. 结论摘要

**兼容性良好,无架构级冲突。** 定制阶段依赖的 `PipelinePhase` 契约在基线中未变,且基线新增了 `PhaseRegistry`(`enabledWhen` 谓词),注册反而更干净。主要工作量不在"移植"而在两块:① 基线热点文件漂移后**重新定位集成点**(尤其 local-backend 的 impact 边类型枚举);② 基线本身的**裁剪**(删 web/PDG/group/embeddings/wiki/MCP 层)。

## 2. fork 定制资产清单(10 个纯定制 commit)

fork point = `2cf7e7fa`(v1.6.6 release)。注意:`72039269 "import in-progress changes"` 是上游在途代码导入(uninstall/taint substrate/cpp lattice 等),**基线已含正式版,移植时整体丢弃**。

| 资产 | 文件 | 规模 | 性质 |
|---|---|---|---|
| workspace-config 解析器 | `core/ingestion/workspace-config.ts` + test | ~73 行 | 新文件,仅依赖 js-yaml |
| rpc-edges 阶段 | `pipeline-phases/rpc-edges.ts` + 2 test | ~370 行 | 新文件;deps=['parse'];读盘检测 @注解,serviceId+methodName 匹配,单边节点挂 ExternalService |
| http-api-calls 阶段 | `pipeline-phases/http-api-calls.ts` + 2 test | ~373 行 | 新文件;deps=['parse','rpcEdges'];前端 axios URL → 后端 Method |
| schema 扩展 | `gitnexus-shared`:graph/types.ts + schema-constants.ts | ~8 行 | ExternalService node + RCALLS/HTTP_CALLS rel |
| 阶段注册 | pipeline.ts + pipeline-phases/index.ts | +6 行 | 基线已改 PhaseRegistry 机制 |
| ignore 覆盖 | config/ignore-service.ts + filesystem-walker.ts | ~31 行 | workspaceDirs 覆盖 gitignore,保证子工程被扫到 |
| plain-folder 模式 | cli/analyze.ts | +4/-14 行 | 无 .git 自动降级为根目录索引 |
| RCALLS 进 impact | mcp/local/local-backend.ts | +4 行 | VALID_RELATION_TYPES + 遍历边类型数组 |
| 停止注入 agent-context | cli/ai-context.ts | -39 行 | 不再写 CLAUDE.md/AGENTS.md 块 |

验证基线:fork commit `0ab6fa61` 记录 hx 实测 **1,595 条 RCALLS 边** —— 可作为移植后的验收锚点。

## 3. 逐项兼容性判定

| 项 | 基线现状 | 判定 |
|---|---|---|
| PipelinePhase 契约 | `types.ts` 未变:ctx.repoPath / ctx.graph / deps / execute 签名一致 | ✅ 原样可用 |
| 阶段注册 | 基线已升级为 `PhaseRegistry.register()` 链(fork 当时是手写数组) | ✅ 更简单:插两行 `.register()` |
| schema 扩展 | NODE_TABLES/REL_TYPES 结构未变,上游改动均为增量(如 PDG 标签) | 🟢 低风险手工补 |
| workspace-config | 独立文件 | ✅ 原样移植(但需按新需求泛化为任意 RPC 框架可配 = 新设计,不是移植) |
| ignore/walker 补丁 | ignore-service 上游 3 commit、walker 1 commit 漂移 | 🟡 低中风险,手工重打 |
| plain-folder(analyze.ts) | 上游 20 commit 大改,**但同样的 "Not inside a git repository" 报错点仍在(~871 行)**,patch 位置可定位;注意 1.6.7 新增多分支特性,plain-folder 下需验证 staleness/branch 逻辑容忍无 git | 🟡 小补丁 + 测试项 |
| RCALLS 进 impact | local-backend **47 commit 漂移**:fork 改的 JS 数组仍在,但上游新增了**硬编码 Cypher `WHERE r.type IN [...]` 字面量**(~3871/4026 行)枚举遍历边类型 | 🔴 本次发现的**最大冲突点**:不能照搬 patch,必须全量 grep 重定位所有边类型枚举处(JS 数组 + Cypher 字符串 + 置信度表 ~441 行),并用 hx 实测验证 |
| ai-context 注入移除 | 基线**仍在注入**(upsertGitNexusSection ×3,13 commit 漂移) | 🟢 不移植 patch;新项目直接决策:不注入(CLI-only,由 cgraphx skill 编排),删除或最小化该模块 |

## 4. 裁剪面(基线做减法,工作量主体)

需要移除/降级:
- `gitnexus-web/` 整包(web UI)
- `server/`(serve + mcp-http;CLI-only 不需要;eval-server 也不留)
- `mcp/` server 与 tools 注册层 —— **保留 `mcp/local/local-backend.ts` 作为内部 API 接缝**,只留勾选工具的 dispatch
- PDG 层:taint-summaries / call-summaries 阶段、taint/ 子系统、explain/pdg_query 相关
- `core/group/`(跨仓)、`core/wiki/`、`core/embeddings/`、markdown/cobol 阶段
- skills/plugin 安装器(claude-plugin、cursor-integration、ai-context 注入)
- 未勾选 MCP 工具:rename、group_* 等
- 保留:ingestion 主链(scan→structure→parse→routes→tools→crossFile→scopeResolution→spring 系列→prune→mro→di→communities→processes)+ rpcEdges + httpApiCalls、lbug 存储、search(BM25)、staleness(手动刷新用)、CLI-direct 命令模式

风险:裁剪是交叉性改动(import 网、pipeline wiring、测试依赖),比移植更费时间;建议按模块分批删 + 每批跑构建与测试。

## 5. 移植工作清单(plan 的输入)

| # | 工作项 | 预估 |
|---|---|---|
| P1 | schema 扩展(ExternalService / RCALLS / HTTP_CALLS) | 0.5d |
| P2 | workspace-config 移植 + **任意 RPC 框架可配的泛化设计**(新需求,spec 定 schema) | 移植 0.5d + 泛化设计另计 |
| P3 | rpc-edges + http-api-calls + 测试移植,PhaseRegistry 注册 | 1-1.5d |
| P4 | ignore/walker 的 workspaceDirs 补丁重打 | 0.5d |
| P5 | analyze.ts plain-folder 降级 + 多分支/无 git 兼容验证 | 0.5-1d |
| P6 | **local-backend RCALLS/HTTP_CALLS 全量重定位**(JS 数组 + Cypher IN 列表 + 置信度) | 1-2d |
| P7 | ai-context 注入移除/模块最小化 | 0.5d |
| P8 | 基线裁剪(web/PDG/group/embeddings/wiki/MCP 层/未选工具) | 3-7d |
| P9 | hx 全量验证:重建索引 ~2min、RCALLS≈1595、HTTP_CALLS 非零、impact 走 RCALLS、CLI 各命令冒烟 | 1d |

## 6. 验收锚点(来自 fork 实测)

- hx 索引:~10015 文件 / ~223k nodes / ~433k edges / 300 processes,全量 ~2 分钟
- RCALLS 边 ≈ 1,595(`0ab6fa61` 实测)
- 单边 RPC 挂 ExternalService 节点,impact 可达(`3ac5b845`)
- RPC 去重按 methodId(`bffa2e84`)

## 7. 遗留决策(不阻塞 spec,但 plan 前要有倾向)

- 存储:默认随基线 LadybugDB(未选 SQLite 改造)
- `list_repos` 去留(单项目单图,倾向砍)
- 新项目命名与仓库位置
- cgraphx 子系统接缝形态(库调用 vs CLI 封装)——并入阶段再设计
