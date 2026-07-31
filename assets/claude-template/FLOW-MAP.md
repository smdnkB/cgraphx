# 流程地图

本项目开发流程的总索引:只放定位、顺序、依赖、指针——各 skill 的内部规则读 skill 本身。

**阶段判断**:看需求目录 `docs/features/<日期>-<编号>-<前缀>/` 已有产物(有无 spec / plan / 实现)+ 对话上下文,决定现在哪一步、下一步做什么。

## 依赖总览

```text
                knowledge-recall(先聊概念,实体条目优先)
                        │
                        ▼
  clarify-requirements(必经;只锁业务决策 + 技术约束,手段归 plan)
                        │
                        ▼
                  write-spec ◄── 唯一契约(声明负责人,进个人需求索引)
                        │
                        ▼ 可选
                    write-plan
                (手段:无业务可观察→plan 自主;有→回跳 spec)
                        │
                        ▼
    implementation(简单)│ subagent-implement(复杂,需 plan)
                        │
        ┌───────────────┼────────────────────────┐
        ▼               ▼                        ▼
  write-api        write-unit-test-spec     交付收尾:
  → run-api-test   → write-unit-test-code   沉淀提示 → knowledge-write
  (接口测试)     (单元测试,代码完成后)     commit 门禁 → git-standards.md

  ── 推荐发布后 · 按需(不在主链,不参与门禁); 原因: 发布前写 PRD:写的是预期,实现过程中一定会漂移,发布后 PRD 就过期了,给业务方看反而误导 ──────────────────
  write-prd(业务方/客户审阅,任意时刻可执行,推荐发布后)
  write-design-doc(设计文档,自测通过后)
  write-api-doc(接口文档,接口开发完毕后)

guides:write-plan 读取并结晶 + 任务打「强制引用」标注(implementation / subagent-implement 执行标注,仅无 plan 时自识别)· write-api 独立读接口规范 · commit 门禁 → git-standards;缺失 → init-project-guides 先补(中断)
```

## 设计流程

- **链**:`/clarify-requirements` → `/write-spec` →(`/write-plan` 可选)
- **前置**:knowledge-recall 先聊相关概念(clarify 第 1 步内置提示)
- **分工**:clarify 只锁业务边界 + 技术约束(读无界、决策有界);spec 是唯一契约,澄清总结只是输入;手段选型在 plan 结合代码定,按业务可观察性分档——无业务可观察后果的 plan 自主并记录,有的回跳 spec 业务拍板
- **产物**:`docs/features/<feature-id>/<前缀>-spec.md`、`plan/<前缀>-index.md` 等;spec 头部声明 `> 负责人:`,收尾自动进个人需求索引(`cgraphx features list --mine` 按人找需求)
- **PRD 不在主链上**:`/write-prd` 是补充文档,任意时刻可执行,推荐功能发布后按需执行——发布后写的是实际交付的行为,不存在文档与系统漂移的问题

## 开发流程

- **链**:`/implementation`(简单:1-3 文件 / 单模块)| `/subagent-implement`(复杂:≥3 任务跨域,主 agent 只协调、派子 agent 实现)
- **前置**:spec 必有;subagent-implement 需 plan
- **强制读**:规范由 plan 打「强制引用」标注(write-plan 按任务类型机械标:schema → data-standards.md;接口 → interface-standards.md;动码 → coding-standards.md);有 plan 时 implementation / subagent-implement 只读标注,无 plan 时 implementation 自行识别;**缺失 → 中断,先 `/init-project-guides` 补齐**
- **小步提交**:plan 把可独立提交的任务(完成后仓库可工作)标「独立提交」并把 `git-standards.md` 提交规范结晶进 index「提交规范」节;implementation / subagent-implement 每完成一个标注任务并按规范自查后提交(原子历史,好 review / revert / bisect),precommit 门禁退化为兜底。未标注的任务不擅自提交,push 永远归用户。
- **收尾**:沉淀提示(新增/变更实体、坑、隐式约束 → `/knowledge-write`);commit 门禁由 precommit-check hook 指向 `docs/guides/git-standards.md`,被拦 → 按 plan 已结晶的「提交前检查点」自查 staged diff(plan 无结晶时才 Read 原文件)

## 接口测试流程

- **链**:`/write-api`(生成 .bru + 测试规格)→ `/run-api-test`(跑测试 + 核实写接口 DB 副作用 + 出报告;**写接口必查 DB 验数据,HTTP 200 ≠ 通过**)
- **前置**:spec + 实现完成;run-api-test 也可独立跑已有 .bru
- **强制读**:write-api 执行前读 `docs/guides/interface-standards.md`(缺失 → `/init-project-guides` 中断)
- **产物**:`docs/bruno/<服务>/<需求前缀>/`(bruno app 可直接打开)+ feature 目录下测试规格与报告

## 单元测试流程

- **链**:`/write-unit-test-spec`(零代码依赖,从 spec 派生场景)→ `/write-unit-test-code`(填实测试 + 跑 + 出报告;找不到测试规格直接退出要求先跑前者)
- **前置**:spec + 实现完成(代码写完后独立流程,与接口测试同节奏)
- **产物**:feature 目录下测试规格与报告 + 项目测试目录的测试代码

## 知识库

- **写**:`/knowledge-write`(双层结构:实体 `concept` 主条目 + 流程条目,正向引用 + 反查派生参与业务;写入前必过 `cgraphx docs validate`)| `/knowledge-init`(陌生项目批量探索建档)
- **读**:knowledge-recall(子 agent 语义召回,实体条目优先)| knowledge-api(已知概念名精确查)
- **目录**:`docs/knowledge/*.md`;沉淀时机由开发流程交付收尾提示触发

## 数据库与 Schema

- **全量(单一事实源)**:`docs/schema-knowledge/<工程>/ddl/<表名>.sql`,一表一文件、始终最终态——维护规则见 `docs/guides/data-standards.md`「Schema 变更约定」节(全量写透 + 需求内增量流水 `sql/[<工程>/]<序号>-<动作名>.sql`)
- **基线与校准**:`/export-table-ddl`(建基线 / 周期校准,DISCOVERED 块重导保留)
- **查数据**:`db-query`(首选读本地 DDL,缺失连库兜底;探索发现回写 DISCOVERED 块;只读)

## 规范(guides)

- `/init-project-guides` 生成 `docs/guides/`:`coding-standards.md` / `interface-standards.md` / `data-standards.md`(数据与模型,含 schema 变更约定)/ `testing-standards.md` / `git-standards.md`(提交门禁文件)
- **决策时读点(write-plan,缺失中断;规范结晶进具体契约)**:

| guide 文件 | write-plan 读点 |
|---|---|
| `data-standards.md` | schema 任务(含「Schema 变更约定」) |
| `interface-standards.md` | 接口任务 |
| `coding-standards.md` | 所有任务(契约部分) |
| `testing-standards.md` | plan 不读;由测试流程(`write-unit-test-code` / `run-api-test`)自读 |
| `git-standards.md` | 有「独立提交」任务时结晶进 index「提交规范」节(plan 级,一次)+ precommit-check 门禁兜底(deny → 按已结晶的检查点自查) |
- **执行期送达**:任务按映射打「强制引用」标注(schema → data-standards.md;接口 → interface-standards.md;动码 → coding-standards.md);有 plan 时 implementation / subagent-implement 只读标注、不自行识别,无 plan 时 implementation 自行识别;write-api 不依赖 plan,执行前独立读 interface-standards.md(自有门禁)。**git-standards.md 例外**:不是每任务强制引用,而是 plan 级结晶进 index「提交规范」节,实施期提交时直接用、门禁仅兜底——消除多次小步提交的重复读取成本。**testing-standards.md 也不走 plan 标注**:测试不进 plan,由独立测试流程(`write-unit-test-code` / `run-api-test`)自读。

## 事后文档(发布后 · 按需,不在开发主链)

设计原则:前期文档越少,变更时的回归成本越低;spec 是唯一契约,其余文档发布后按实际交付物生成,避免「文档描述预期、系统做了另一件事」的漂移。

| skill | 产物 | 推荐时机 | 说明 |
|---|---|---|---|
| `/write-prd` | 业务需求文档 | 发布后按需 | 给领导/客户/业务方审阅;发布后写 = 记录实际交付的行为,不是事前审批件 |
| `/write-design-doc` | 设计文档 | 自测通过后 | 从 knowledge + spec/plan 合成,面向研发/技术负责人/维护者 |
| `/write-api-doc` | 接口文档 | 接口开发完毕后 | 仅覆盖本次新增接口,从 spec + 代码反向提取 |

## 其他能力

- `/developer-timeline` 开发事件流与日报/周报/月报 | `/write-workload` 交付工作量汇报
- 可视化:handdrawn-sketch-engine / handdrawn-deck(手绘信息图与翻页演示)
