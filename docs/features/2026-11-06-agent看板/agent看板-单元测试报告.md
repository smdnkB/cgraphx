# 单元测试报告: agent看板

> 产物: unit_test_report
> 依据: spec@90c1887
> feature-id: 2026-11-06-agent看板
> 测试人: liulongfei
> 测试时间: 2026-11-07
> 关联测试规格: agent看板-单元测试-spec.md
> 关联被测实现: src/core/agents/sources.ts、src/core/timeline/ingest/deepseek-session.ts、src/core/timeline/ingest/ingest.ts、src/core/timeline/ingest/rebuild.ts、src/core/timeline/store.ts、src/core/timeline/board-read.ts、src/core/board/(compute.ts、match.ts、server.ts、cli.ts)、src/core/timeline/constants.ts
> 关联测试代码: __tests__/core/timeline/deepseek-session.test.ts、__tests__/core/timeline/ingest-sources.test.ts、__tests__/core/timeline/session-titles.test.ts、__tests__/core/board/match.test.ts、__tests__/core/board/compute.test.ts、__tests__/core/board/server.test.ts、__tests__/core/board/cli.test.ts、__tests__/cli/installer/deepseek-zero-change.test.ts
> 测试框架: vitest 2.1.9(真实栈,无 mock;临时 HOME)
> 运行时: Node v26.3.0(本机)/ engines >=22.5 <27

## 结论

原来这块新能力(DeepSeek 只读来源、会话标题表、board 子系统)一行测试都没有;这次按 52 场景规格填实了 7 个测试文件。**52 个场景:通过 51、跳过 1、失败 0,可以交付**。跳过的 1 条是「Node 无 zstd API 时的提示」(内置模块命名空间不可改写、仓库规范禁 vi.mock,无法在本运行时模拟,已注明基建缺口)。另外**测试过程抓到并修掉一个真实回归**:上一轮评审修复把 `jsonExtract` 单键误包成 `coalesce(单参数)`,SQLite 直接抛错导致看板查询整体失败——typecheck 与既有 611 个测试都没盖到这条路径,新写的看板装配测试第一轮就抓出来了(单独提交 7fd47e9)。

| 计数 | 值 |
|---|---|
| 场景总数(规格) | 52 |
| 通过 | 51 |
| 失败 | 0 |
| 跳过(it.skip 占位) | 1(A9b,见下) |
| 全量套件 | 45 个文件,661 通过 + 1 跳过(含既有 37 个文件,零改动零红) |
| 本轮新增耗时 | 套件整体 8s 级,新增文件合计 <1s |

## 逐场景结果(按规格分组)

### A. DeepSeek 读取器(`deepseek-session.test.ts`,D13、K4、验收 3)

| # | 用例 | 状态 | 关键断言 |
|---|---|---|---|
| A1 | 五种行 → 事实映射 + 工具名归一(表外原样传) | ✅ | head/title/prompt/tool×2/turn_end;`read→Read`、`mcp__custom__tool` 原样 |
| A2 | 增量读只出新帧 | ✅ | 第二帧只有「第二轮」的 prompt |
| A3 | 子会话事实归根主会话、头带自己的 cwd | ✅ | 全部事实 sessionId=parent;head.startCwd=子目录 |
| A4 | 续接会话各算一行 | ✅ | 全部事实 sessionId=自己 |
| A5 | 尾帧截断留下次、补齐后读出 | ✅ | consumedBytes 停在前一帧末尾;补齐后两条 prompt 都出 |
| A6 | 挂起调用留下次、配对后出事实 | ✅ | 偏移收回帧头;补结果帧后 tool 事实出现 |
| A7 | DSH_HOME 覆盖根目录 | ✅ | 设了 → `<DSH_HOME>/.dsh/sessions`;没设 → 家目录 |
| A8 | 未知行类型跳过不报错 | ✅ | 只有 prompt + session_head |

### B. 补录与标题(`ingest-sources.test.ts`、`session-titles.test.ts`,D8、D9、D12、验收 5)

| # | 用例 | 状态 | 关键断言 |
|---|---|---|---|
| B1 | DeepSeek 会话落库 agent=deepseek | ✅ | 四类事件齐;turn_id=cwd=会话编号都对 |
| B2 | 标题优先级 custom>ai>agent、同级取新/旧不回退 | ✅ | 六连 upsert 序列逐条断言 |
| B3 | claude 标题行产事实(ts 取前一条带时间行);codebuddy 不产 | ✅ | 两条标题事实 ts 相同;codebuddy 文件可解析但无标题事实 |
| B4/B5 | 回填一次:标题写入、事件数不变、第二趟无变化 | ✅ | 验收 5 三点全覆盖 |
| B6 | schema 幂等、版本号不升 | ✅ | 双次应用;MAX(version)=2 |
| B7 | CodeBuddy 无标题来源 | ✅ | 并入 B3(文件级断言) |
| B8 | 改名(未知 ts)覆盖;已知 ts 盖回;未知 ai 不盖 custom | ✅ | upsert 层 3 组 + 端到端改名生效(评审修复的回归测试) |
| B9 | 坏帧单文件隔离(增量 + 重建两路) | ✅ | 状态 synced/rebuilt 而非 failed;提示含「读取失败」;好文件照常入库;坏文件偏移不推进 |
| A9a | 本运行时来源可用 | ✅ | unavailableReason()=null |
| A9b | 无 zstd API 时的提示 | ⏭️ | 无法模拟内置模块缺失,见「待确认项」 |

### C. 认任务(`match.test.ts`,K8–K11、D14、验收 6)

| # | 用例 | 状态 | 关键断言 |
|---|---|---|---|
| C1–C6 | K9 六条定挂逐条(副本/分支/提交文件/写工具/流程命令+Skill/消息路径) | ✅ | 每条各一个 it,依据文案逐一断言;K9① 窗口=整个会话、已删副本也算 |
| C7 | K10 两条可能相关 | ✅ | Read 读过目录 / 消息提标题,fixed=false |
| C8 | K8 参与面 | ✅ | 主目录/子目录/副本算,上级目录不算 |
| C9 | 一个会话挂多个任务 | ✅ | 两任务各得一条命中 |
| C10 | 3 字标题不算可能相关 | ✅ | 未挂上,进 unmatched |
| C11 | 只在 Bash 文字里出现不算(K11) | ✅ | 混入的 Bash 事件不产生挂靠 |
| C12 | Windows 开始目录不参与 | ✅ | sessions/byTask 双空 |
| C13 | 标题原文比较 | ✅ | `order_export-v2` 命中、空格变体不命中 |
| K6 | 多任务窗口取命中区间;副本依据整个会话 | ✅ | from/to 逐条断言 |
| D12 | dirLabel 三档 | ✅ | 副本 X / 主目录 X / basename |

### D. 看板装配(`compute.test.ts`,K1–K3、K5、K12–K14、F1④⑤、D7)

| # | 用例 | 状态 | 关键断言 |
|---|---|---|---|
| D1 | 同名项目目录归并一组、根取还在的 | ✅ | 一组、dirs 只留在的、roots 含不在的、dataDirs 两个 |
| D2 | 任务行字段 | ✅ | 标题/阶段=已规划/计数/agents/lastActiveAt/会话行全字段 |
| D3 | 未归类 ≥5 条门槛 | ✅ | 6 条进未归类、3 条不进 |
| D4 | K1 算/不算 | ✅ | 讨论稿/spec 算,空目录不算 |
| D5 | K2 30 天分界 + 只有可能相关也列 | ✅ | tasks/older 各归其位;0 定挂 1 可能相关 |
| D6 | K5 标题兜底 | ✅ | 第一条消息前 40 字;无消息 `-` |
| D8/D9 | 提示映射与目录不在 | ✅ | 五种状态文案 + 目录已不在 |
| D10 | fileExists 现查 | ✅ | 在=true;删了=false 但照样列出(F2①) |
| D11 | 无项目空态 | ✅ | `{projects: []}` |

### E. 看板服务(`server.test.ts`,D2 🔒、D3、验收 1)

| # | 用例 | 状态 | 关键断言 |
|---|---|---|---|
| E1 | 三路由 | ✅ | 页面 200 html、数据 200 JSON、刷新 200 且替换内存数据 |
| E2 | 三项 403 + 404 | ✅ | 令牌错/Host 域名错/Host 端口错/Origin 错;localhost 与同源 Origin 放行 |
| E3 | 并发刷新 409 | ✅ | 第二个刷新 409、期间 GET 200 旧数据、第一个完成后 200 |
| E4 | 只听回环 | ✅ | 地址形状 `http://127.0.0.1:<port>/?t=<hex>` |

### F. 命令启动链(`cli.test.ts`,D4、F1③、验收 9)

| # | 用例 | 状态 | 关键断言 |
|---|---|---|---|
| F1/F3 | 任意目录全链 + SIGINT 退出 | ✅ | cwd=系统临时目录跑通;地址带令牌;服务探活 200;emit SIGINT 后 promise 正常 resolve |
| F2 | 打开函数抛错降级 | ✅ | 不崩、服务照常、照常退出(验收 9) |

### G. 零变化守护(`deepseek-zero-change.test.ts`,D12 🔒、验收 2)

| # | 用例 | 状态 | 关键断言 |
|---|---|---|---|
| G2 | AGENT_PROFILES 不动 | ✅ | 恰好 claude-code/codebuddy;parseAgentList('all') 同;无 .dsh 配置目录;来源表含 deepseek |
| G1 | DSH_SESSION_ID 不触发门禁 | ✅ | resolveSessionIdFromEnv 返回 null;两家已登记的照旧认 |

## 实现与 spec 偏差小结

- **无行为偏差**。规格里的 B8/B9(评审修复行为)按当前实现测试,spec 未显式写机制——见规格待确认项,建议下次动 spec 时补 D 编号。
- **测试发现实现 bug 1 个(已修)**:`board-read.ts` 的 `jsonExtract` 在评审修复(16641b6)中被改为可变参数,单键时生成 `coalesce(单参数)` → SQLite 抛 `wrong number of arguments` → `readTimelineBoardData` 对任何项目库都失败,看板数据全空(被 merge 的 catch 吞成空)。修复:单键不包 coalesce(提交 7fd47e9)。这条路径 typecheck 与既有 611 测试都不经过,是本轮测试的直接产出。

## 待确认项汇总

1. **A9b 跳过**:「Node 无 zstdDecompressSync 时的『要 Node 22.15 以上』提示」无法在本运行时模拟(内置模块命名空间只读、规范禁 vi.mock)。补法:把 sources.ts 的可用性探测改成可注入参数(一行改动),或接受跳过。
2. **G1 端到端降级**:「install -t all 不部署 .dsh」「开副本不带 .dsh」按规格待确认项的允许降级为登记面守护(PROFILES 集合 + configDirName + 会话变量);需要端到端断言时在 installer 套件补一条。
3. **describe 语言**:测试规格的骨架映射写了「describe 中文」,与 `docs/guides/testing-standards.md`「describe/it 一律英文」冲突——按规范执行(英文 + spec 条款号);仓库最新的 `ingest-foreign-start-dir.test.ts` 用中文,规范与现状本身有漂移,建议后续归一。
4. 页面交互(复制/剪贴板降级/灰显)不在单元测试范围,留 `/ui-case` 或手动。

## 下一步建议

- 全绿可交付:51/52 通过,唯一跳过项有明确补法;需求可以 `/dev-merge agent看板` 合入。
- 可选:把 sources.ts 可用性探测改为可注入(连 A9b 一起补);installer 套件补 .dsh 端到端断言。
- 规格待确认项 1 的两条 D 编号决策(标题未知 ts 覆盖、读取器错误隔离)下次动 spec 时回填。
