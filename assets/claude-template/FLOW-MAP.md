# 流程地图

本项目开发流程的总索引:只放定位、顺序、依赖、指针——各 skill 的内部规则读 skill 本身。

**阶段判断**:看需求目录 `docs/features/<日期>-<编号>-<前缀>/` 已有产物(有无 spec / plan / 实现)+ 对话上下文,决定现在哪一步、下一步做什么。

## 依赖总览

```text
                knowledge-recall(先聊概念,实体条目优先)
                        │
                        ▼
  clarify-requirements(必经;只锁业务决策和技术约束,手段归 plan)
    结束时在对话里给流程图和决策表;没看懂可以用 visual-explain 出图解
                        │       ▲
                        │       ▼ 涉及 UI 时,可在 clarify 前后、spec 后来回迭代
                        │   write-wireframe(低保真 HTML 线框 v1、v2…)
                        │
                        ├── 要开新会话 → handoff-session
                        │   (确认产出目录 + 交接文件,可拆 1 到 N 个)
                        ▼
                  write-spec ◄── 唯一契约(声明负责人;引用已确认的线框版本)
                        │
                        ▼ 小需求可跳过;大需求必走
                    write-plan
            (手段:无业务可观察后果 plan 自主;有则回跳 spec)
            (一个任务一个文件;大需求给一句 /subagent-implement 启动语)
                        │
                        ▼
  implementation(小需求)或 subagent-implement(大需求:一个会话按任务派子 agent,统一验证后 /code-review)
                        │
        ┌───────────────┼────────────────────────┐
        ▼               ▼                        ▼
  write-api        write-unit-test-spec     交付收尾:
  → run-api-test   → write-unit-test-code   沉淀提示 → knowledge-write
  (接口测试)     (单元测试,代码完成后)     平台环节缺口提醒
                                           需求做完 → /end(收口档案;已上线时写发布记录)
  ↓ 推荐(非硬前置)                          commit 门禁 → features check + git-standards.md
  write-ui-test
  → run-ui-test
  (UI 功能测试)

  ── 发布后 · 按需(不在主链,不参与门禁)──────────────────
  write-docs(需求文档、设计文档、接口文档,运行时选)

guides:write-plan 读取并结晶,任务打「强制引用」标注(implementation 执行标注,没有 plan 时自己识别)· write-api 独立读接口规范 · write-unit-test-code 独立读测试规范 · commit 门禁指向 git-standards;缺失时先 init-project-guides 补齐(中断)
```

## 设计流程

- **链**:`/clarify-requirements` → `/write-spec` →(小需求可跳过 `/write-plan`,大需求必走);涉及 UI → `/write-wireframe` 可插在 clarify 前、clarify 与 spec 之间、或 spec 后,与 clarify 来回迭代(看界面才能定业务交互的项目先画线框);探索结束要开新会话 → `/handoff-session`
- **前置**:knowledge-recall 先聊相关概念(clarify 第 1 步内置提示)
- **分工**:clarify 只锁业务边界 + 技术约束(读无界、决策有界);spec 是唯一契约,澄清总结只是输入;手段选型在 plan 结合代码定,按业务可观察性分档——无业务可观察后果的 plan 自主并记录,有的回跳 spec 业务拍板
- **人工确认点**:澄清结果(对话里的流程图和决策表,没看懂可以出图解页),人说对了才写 spec;线框(涉及 UI 时),人看着界面确认布局和交互;plan index「设计预览」的重点决策表,人确认后才进实现。
- **产物**:`docs/features/<feature-id>/<前缀>-spec.md`、`<前缀>-交接提示词.md`、图解页 `<前缀>-<主题>-v<N>.html`(visual-explain 出,讨论稿,不登记)、`plan/<前缀>-index.md` 加一个任务一个文件;spec / 交接文件头部声明 `> 负责人:`(也是任务负责人判定依据),会话按读写的产出目录自动关联任务;收尾自动进个人需求索引(`cgraphx features list --mine` 按人找需求)
- **事后文档不在主链上**:`/write-docs` 发布后按需执行,写的是实际交付的行为。

## 开发流程

- **链**:小需求一个会话跑 `/implementation`;大需求先 `/write-plan`,再 `/subagent-implement` 在一个会话里按任务派子 agent 跑完,全部做完统一验证,最后提示跑 `/code-review`。判断看需求规模(预估变更文件 ≥10,且跨 ≥3 个相互独立的模块),不看任务量;拿不准先 `/write-plan`。
- **前置**:spec 必有;大需求要有 plan。
- **强制读**:规范由 plan 打「强制引用」标注(write-plan 按任务类型机械标:schema → data-standards.md;接口 → interface-standards.md;动码 → coding-standards.md);有 plan 时 implementation 只读标注,无 plan 时 implementation 自行识别;**缺失 → 中断,先 `/init-project-guides` 补齐**
- **提交**:任务文件写提交点。大需求由 subagent-implement 的主会话按提交点提交,不构建、不测试,全部做完统一验证;小需求由 implementation 按 plan 的提交点提交。`git-standards.md` 的提交规范结晶进 index「提交规范」节,precommit 门禁兜底;push 永远归用户。
- **收尾**:沉淀提示(新增或变更的实体、坑、隐式约束,走 `/knowledge-write`);平台环节缺口提醒(按 `cgraphx features show`,只提醒不拦);需求做完跑 `/end` 写收口档案,已上线时写发布记录;commit 门禁由 precommit-check hook 先跑 `cgraphx features check --staged`(产物不合格必须改对),再指向 `docs/guides/git-standards.md` 自查。

## 接口测试流程

- **链**:`/write-api`(生成 .bru + 测试规格)→ `/run-api-test`(跑测试 + 核实写接口 DB 副作用 + 出报告;**写接口必查 DB 验数据,HTTP 200 ≠ 通过**)
- **前置**:spec + 实现完成;run-api-test 也可独立跑已有 .bru
- **强制读**:write-api 执行前读 `docs/guides/interface-standards.md`(缺失 → `/init-project-guides` 中断)
- **产物**:`docs/bruno/<服务>/<需求前缀>/`(bruno app 可直接打开)+ feature 目录下测试规格与报告
- **后续**:接口通过后推荐跑 `/write-ui-test` → `/run-ui-test`(UI 功能测试,非硬前置)

## UI 功能测试流程

- **链**:`/write-ui-test`(从 spec 派生用例,一功能点一用例)→ `/run-ui-test`(Playwright MCP 驱动浏览器执行 + 截图 + 报告;**不验库,只看 UI 表现**)
- **前置**:spec + 实现完成 + 目标项目已装 Playwright MCP;推荐在接口测试后跑(非硬前置);服务启动 / 测试数据 / headed 与否归人工
- **产物**:`docs/features/<feature-id>/ui功能测试/`(用例规格 + xlsx 报告 + 结构化结果 + 按功能点命名的截图)

## 单元测试流程

- **链**:`/write-unit-test-spec`(零代码依赖,从 spec 派生场景)→ `/write-unit-test-code`(填实测试 + 跑 + 出报告;找不到测试规格直接退出要求先跑前者)
- **前置**:spec + 实现完成(代码写完后独立流程,与接口测试同节奏)
- **强制读**:write-unit-test-code 执行前读 `docs/guides/testing-standards.md`(缺失 → `/init-project-guides` 中断)
- **产物**:feature 目录下测试规格与报告 + 项目测试目录的测试代码

## 知识库

- **写**:`/knowledge-write`(双层结构:实体 `concept` 主条目 + 流程条目,正向引用 + 反查派生参与业务;写入前必过 `cgraphx docs validate`)| `/knowledge-init`(陌生项目批量探索建档)
- **读**:knowledge-recall(子 agent 语义召回,实体条目优先;精确查询用它列出的 `cgraphx docs` 命令)
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
| `testing-standards.md` | plan 不读;`write-unit-test-code` 执行前自读(内容全是单测向);接口测试规范由 `write-api` 读 `interface-standards.md` 送达 |
| `git-standards.md` | 结晶进 index「提交规范」节(plan 级,一次)+ precommit-check 门禁兜底(deny → 按已结晶的检查点自查) |
- **执行期**:有 plan 时 implementation 只读任务的「强制引用」标注,没有 plan 时自己识别;write-api 执行前自读 `interface-standards.md`;write-unit-test-code 执行前自读 `testing-standards.md`;`git-standards.md` 由 plan 结晶进 index「提交规范」节,门禁兜底。

## 事后文档(发布后 · 按需,不在开发主链)

设计原则:前期文档越少,变更时的回归成本越低;spec 是唯一契约,其余文档发布后按实际交付物生成,避免「文档描述预期、系统做了另一件事」的漂移。

| skill | 产物 | 推荐时机 | 说明 |
|---|---|---|---|
| `/write-docs` | 需求文档、设计文档、接口文档(运行时选,可多选) | 发布后按需 | 写实际交付的行为,不重新定义 spec。 |

## 其他能力

- `/visual-explain` 图解:没看懂就说「画个图讲讲」,出一页图解;和需求有关的放需求目录,无关的放 `.cgraphx/visual/`
- `/developer-timeline` 开发事件流与日报/周报/月报 | `/write-workload` 交付工作量汇报
- `/iboc-check` 老需求补头部、补单测产物和收口档案
- 可视化:handdrawn-sketch-engine / handdrawn-deck(手绘信息图与翻页演示)
