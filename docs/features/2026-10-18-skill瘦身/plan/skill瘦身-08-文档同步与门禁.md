# 实现计划: skill瘦身 · 批次 8 文档同步与门禁

> 产物: plan
> 依据: spec@cf4712c

## 共用约定

本批必须在批次 1 到 7 全部完成之后做;执行前先读完本节。

1. 分支:在 `feat/skill瘦身` 上做;开工前 `git status` 确认暂存区是空的,并确认 `ls assets/claude-template/skills | wc -l` 为 25(批次 2 已完成)。不是 25 就停下写 `PLAN_CONFLICT: 前序批次未完成`。
2. 改动入口:skill 相关只改 `assets/claude-template/` 下的文件;本仓库根目录的 `.claude/` 不动。不改 `docs/features/` 下任何已有文件。
3. 写法(spec §4.3):新写或改写的句子不用箭头(→)、不用斜杠并列(甲/乙)、不用自造缩写;流程图、目录树这类图里的箭头和连线照常用。没被要求改的句子不为改写而重写。任务给出的原文照抄,可以改错别字和标点。
4. 改完以后的事实(本批文档都按这个写):
   - 共 25 个 skill。model-invoked 17 个:cgraphx-guide、clarify-requirements、db-query、handdrawn-sketch-engine、handoff-session、implementation、knowledge-recall、knowledge-write、run-api-test、run-ui-test、write-api、write-plan、write-spec、write-ui-test、write-unit-test-code、write-unit-test-spec、write-wireframe。user-invoked 8 个:developer-timeline、export-table-ddl、handdrawn-deck、iboc-check、init-project-guides、knowledge-init、write-docs、write-workload。命令 2 个:`/end`、`/my-query`。
   - 废弃 9 个及以后怎么做:

     | 废弃 | 以后怎么做 |
     |---|---|
     | subagent-implement | 大需求由 `/write-plan` 分批,每批开一个会话跑 `/implementation`,全部完成后回 Claude 跑 `/code-review` |
     | knowledge-api | 并入 knowledge-recall |
     | code-map-write、code-map-recall | 不再维护代码地图;web「系统地图」页和 `docs/code-map/` 保留,提示已停止维护 |
     | write-prd、write-design-doc、write-api-doc | 合成 `/write-docs`,运行时选要哪几种 |
     | knowledge-migrate | 不再提供 |
     | write-delivery-guide | 不再事后写交付讲解;clarify 结束时给出澄清结果 |

   - clarify 结束时给出澄清结果:小需求在对话里给流程图和决策表;改动牵涉多个模块或多条流程时,在需求目录出 `<前缀>-澄清结果-v<N>.html`。
   - spec 没有「一图看懂」;plan 的设计预览只有重点决策表;大需求由 write-plan 分批,每批一句启动语。
   - implementation 收尾只提示沉淀知识和平台环节缺口;`/end` 写收口档案,确认已上线时写发布记录。
   - 提交门禁:AI 提交时先跑 `cgraphx features check --staged`,有失败项必须改对才能提交;再按 `git-standards.md` 自查提交说明。
5. 每个任务做完跑 `npm run build`;T-23 还要跑 `npm test`。
6. 提交:标题格式 `type(scope): 中文描述`,补充说明用「——」,并列用「+」。本仓库的提交门禁会先拦一次,自查后用 `CGRAPHX_PRECOMMIT_REVIEWED=1 git commit ...` 重试。
7. 遇到任务要求和 spec 冲突、要改范围外的文件、点名要改的段落找不到,停下写 `PLAN_CONFLICT: <原因>`。

## T-21: FLOW-MAP、模板 CLAUDE.md、cgraphx-guide 按改后的流程重写

- 目标:流程总索引、目标项目的 CLAUDE.md 模板、使用指南三处,按改后的 25 个 skill 和新流程重写;删除「代码图谱」配置行。
- 对应 spec 条款:§9(配置行)、§10 第 1、2、3 行、§13 第 10 条。
- 强制引用:无。
- 依赖:批次 1 到 7 完成。
- 涉及范围:
  - `assets/claude-template/FLOW-MAP.md`
  - `assets/claude-template/CLAUDE.md`
  - `assets/claude-template/skills/cgraphx-guide/SKILL.md`
  - `assets/claude-template/skills/cgraphx-guide/how-to-use.md`
  - `assets/claude-template/skills/cgraphx-guide/how-to-use.html`
- 必须严格执行:
  - 改完这五个文件里不再出现已废弃 skill 的现行用法,也不再出现「一图看懂」、代码图谱配置行。
  - FLOW-MAP 只放定位、顺序、依赖、指针,各 skill 内部规则不抄进来。
- 允许局部适配:各节措辞;HTML 里的排版沿用原有 class。
- 具体要求(FLOW-MAP.md):
  1. 「依赖总览」代码块整块换成(照抄):

     ```text
                     knowledge-recall(先聊概念,实体条目优先)
                             │
                             ▼
       clarify-requirements(必经;只锁业务决策和技术约束,手段归 plan)
         结束时给出澄清结果:小需求在对话里,改动大时出澄清结果页
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
                 (大需求分批,每批一句执行会话启动语)
                             │
                             ▼
       implementation(小需求一个会话;大需求每批一个会话,全部完成后 /code-review)
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

  2. 「设计流程」:
     - 「链」里「(`/write-plan` 可选)」改为「(小需求可跳过 `/write-plan`,大需求必走)」。
     - 「人工确认点」整条改为:「**人工确认点**:澄清结果(小需求看对话里的流程图和决策表,改动大看澄清结果页),人说对了才写 spec;线框(涉及 UI 时),人看着界面确认布局和交互;plan index「设计预览」的重点决策表,人确认后才进实现。」
     - 「产物」一条补上 `<前缀>-澄清结果-v<N>.html`(讨论稿,不登记)。
     - 「PRD 不在主链上」整条改为:「**事后文档不在主链上**:`/write-docs` 发布后按需执行,写的是实际交付的行为。」
  3. 「开发流程」:
     - 「链」改为:「`/implementation`:小需求一个会话;大需求由 write-plan 分批,每批开一个会话跑 `/implementation`,全部完成后回 Claude 跑 `/code-review`。判断看需求规模(预估变更文件 ≥10,且跨 ≥3 个相互独立的模块),不看任务量;拿不准先 `/write-plan`。」
     - 「前置」改为:「spec 必有;大需求要有 plan。」
     - 「强制读」「小步提交」里的「implementation / subagent-implement」都改为「implementation」。
     - 「收尾」改为:「沉淀提示(新增或变更的实体、坑、隐式约束,走 `/knowledge-write`);平台环节缺口提醒(按 `cgraphx features show`,只提醒不拦);需求做完跑 `/end` 写收口档案,已上线时写发布记录;commit 门禁由 precommit-check hook 先跑 `cgraphx features check --staged`(产物不合格必须改对),再指向 `docs/guides/git-standards.md` 自查。」
  4. 「知识库」的「读」改为:「knowledge-recall(子 agent 语义召回,实体条目优先;精确查询用它列出的 `cgraphx docs` 命令)」。
  5. 删掉「代码地图」整节。
  6. 「规范(guides)」:保留第一条和表格;表格后「**执行期送达**:…」那一长段换成:「**执行期**:有 plan 时 implementation 只读任务的「强制引用」标注,没有 plan 时自己识别;write-api 执行前自读 `interface-standards.md`;write-unit-test-code 执行前自读 `testing-standards.md`;`git-standards.md` 由 plan 结晶进 index「提交规范」节,门禁兜底。」
  7. 「事后文档(发布后 · 按需,不在开发主链)」:设计原则一句保留;表格换成一行:`/write-docs` | 需求文档、设计文档、接口文档(运行时选,可多选) | 发布后按需 | 写实际交付的行为,不重新定义 spec。
  8. 「其他能力」加一条:「`/iboc-check` 老需求补头部、补单测产物和收口档案」。
- 具体要求(模板 `CLAUDE.md`):
  1. 「项目介绍」第二段里「主线一句话:…」到句末,换成:「主线:先用 knowledge-recall 对齐概念,再 clarify 澄清(结束时给出澄清结果),spec 是唯一契约;小需求直接 implementation,大需求先 write-plan 分批,每批一个会话跑 implementation,全部完成后 /code-review。平行支线:接口测试、单元测试、知识库、规范(guides)。」
  2. 删掉「项目约定」里「**代码图谱**:…」这一行。
  3. 其余不动。
- 具体要求(`cgraphx-guide/SKILL.md`):
  1. `description` 末尾括号里的「knowledge-api/db-query/developer-timeline」改为「knowledge-recall、db-query、developer-timeline」。
  2. 「不要用本 skill」第一条「查业务知识(`docs/knowledge/`)→ `knowledge-api` skill」改为指向 knowledge-recall。
  3. 「整体使用流程」表格按共用约定第 4 条重写,行依次为:机器级、项目级(`cgraphx install`、`/init-project-guides`、`/knowledge-init`)、日常做需求必经两步(`/clarify-requirements` 澄清并给出澄清结果,然后 `/implementation`;大需求先 `/write-plan` 分批,每批一个会话跑,全部完成后 `/code-review`)、日常做需求复杂按需(`/write-wireframe`、`/handoff-session`、`/write-spec`、`/write-plan`、`/knowledge-write`)、测试按需(三条测试线)、收尾按需(`/end`、`/iboc-check`)、发布后按需(`/write-docs`)、工作回顾按需(`/developer-timeline`、`/write-workload`)、卸载。
  4. 「各 skill 导航」两张表重写:「用户主动触发」列全部用户会敲的 21 个 skill(25 个减去 knowledge-recall、db-query、handdrawn-sketch-engine、cgraphx-guide),每个一句何时用;另加一张「命令」小表列 `/end`、`/my-query`;「agent 自动调用」列 knowledge-recall、db-query、handdrawn-sketch-engine(也被 handdrawn-deck 委托调用)。
  5. 「安装与接入」里「Node ≥ 20 且 < 25」改为「Node ≥ 22.5 且 < 27」(与 `package.json` 的 engines 一致)。
  6. 「背后自动」里「agent 经 `knowledge-api` 自动查业务知识」改为「agent 经 knowledge-recall 自动查业务知识」。
  7. 「卸载」一节改成和 `how-to-use.md` 的「卸载 · 可选」一致:先在项目里 `cgraphx uninstall`(按清单清 `.claude/` 内包自带的 skill 和配置,删 `.cgraphx/`,`--keep-data` 保留数据),再 `npm uninstall -g cgraphx`;删掉「preuninstall 钩子自动清所有 agent 的 MCP 配置」这句(2.0 不再写 MCP 配置)。
- 具体要求(`how-to-use.md`):
  1. 「工作流全景」代码块整块换成(照抄):

     ```
     knowledge-recall(自动召回)
             │
             ▼
     /clarify-requirements ──→ /write-spec ──→ /write-plan(大需求必走)
       澄清 + 澄清结果           唯一契约          分批 + 每批启动语
             │                                        │
             │            ┌───────────────────────────┘
             ▼            ▼
       /implementation(小需求一个会话;大需求每批一个会话,做完 /code-review)
             │
        ┌────┴─────────────────────────────┐
        ▼              ▼                   ▼
     /write-api    /write-unit-test-spec  交付收尾:
     → /run-api-test → /write-unit-test-code  /knowledge-write 沉淀
       接口测试       单元测试              /end 收口 + 发布记录
                                           commit 门禁(含产物检查)

     ── 发布后 · 按需(不在主链)──────────────
     /write-docs(需求文档、设计文档、接口文档)
     ```

     代码块下面一句改为:「日常默认两步:**澄清 + 实现**。大需求先 `/write-plan` 分批,复杂需求按需补规格和测试。timeline 自动记录开发事件,你不需要主动跑命令。」
  2. 「开发流程」:clarify 一条末尾补「;结束时给出澄清结果(小需求在对话里,改动大时出页面)」;「**可选** `/write-plan`…」改为「**大需求必走** `/write-plan`(小需求可跳过):拆执行计划,手段选型在这一步结合代码定;大需求分批,每批给一句执行会话启动语」;「**必经** `/implementation`…」改为「**必经** `/implementation`:小需求一个会话;大需求每批一个会话,全部完成后回 Claude 跑 `/code-review`;判据是需求规模(预估变更文件 ≥10,且跨 ≥3 个相互独立的模块),不是任务量」;「> **交付收尾**:…」一句改为「> **交付收尾**:实现收尾会提示沉淀知识(`/knowledge-write`)和平台环节缺口;需求做完跑 `/end` 写收口档案,已上线时写发布记录。」
  3. 「知识管理」删掉 `knowledge-api` 那一条;`knowledge-recall` 那一条末尾补「精确查询也走它」。
  4. 「事后文档(发布后 · 按需)」表格换成一行:`/write-docs` | 需求文档、设计文档、接口文档(运行时选,可多选) | 发布后按需。
  5. 「docs/ 目录速查」features 子树:`<前缀>-需求文档.md`、`<前缀>-设计文档.md` 两行的 skill 改为 `/write-docs`;删掉 `<前缀>-交付讲解.md` 一行;补四行:`<前缀>-澄清结果-v<N>.html  /clarify-requirements 可选 改动大时`、`<前缀>-收口档案.md  /end 可选 需求做完`、`<前缀>-发布记录.md  /end 可选 已上线时`、`<前缀>-接口文档.html  /write-docs 可选 发布后按需`(对齐方式沿用原树)。
  6. 文末日期行改为 `cgraphx 使用说明 · 2026-10-19`。
- 具体要求(`how-to-use.html`):和 `how-to-use.md` 同样改上面第 1 到 5 条对应的地方(工作流全景图、开发流程三条和收尾一条、知识管理、事后文档、docs 目录速查);HTML 结构和 class 不变,`<` `>` 按原文件转义。
- 完成条件:
  - `grep -n -e subagent-implement -e knowledge-api -e code-map -e write-prd -e write-design-doc -e write-api-doc -e knowledge-migrate -e write-delivery-guide -e 交付讲解 -e 代码图谱 assets/claude-template/FLOW-MAP.md assets/claude-template/CLAUDE.md assets/claude-template/skills/cgraphx-guide/` 无结果。
  - `grep -c "write-docs" assets/claude-template/skills/cgraphx-guide/how-to-use.html` 大于 0。
- 验证方式:上面的 grep;用浏览器打开 `how-to-use.html` 看一眼排版没坏(可选);`npm run build`。
- 独立提交:是,两笔。建议标题:`docs(skills): FLOW-MAP 和 CLAUDE.md 模板按瘦身后的流程重写——删代码图谱配置`;`docs(skills): cgraphx-guide 按 25 个 skill 更新流程和导航`
- 风险/注意事项:`how-to-use.html` 较长,只改点名的几处,不要整页重写。

## T-22: 本仓库 CLAUDE.md、README、CHANGELOG 与知识库条目

- 目标:本仓库自己的说明文档和知识库条目按改后的事实更新;CHANGELOG 记一条。
- 对应 spec 条款:§10 第 5、6、7 行、§13 第 10 条。
- 强制引用:无。
- 依赖:批次 1 到 7 完成;T-21 完成。
- 涉及范围:
  - `CLAUDE.md`、`README.md`、`README.en.md`、`CHANGELOG.md`
  - `docs/knowledge/skill-invocation轴.md`、`docs/knowledge/知识库分类体系.md`、`docs/knowledge/测试流程后置.md`、`docs/knowledge/plan手段决策三档.md`、`docs/knowledge/枚举换血排查教训.md`
- 必须严格执行:
  - 知识库条目是历史记录:不改写当时的结论,用「带日期的补充」写新事实;每个条目 `updated` 改为 `2026-10-19`;改完每个都跑 `cgraphx docs validate <file>` 通过。不跑 `cgraphx docs index`(由负责人决定)。
  - CHANGELOG 用英文,写在 `## Unreleased` 下第一条,格式和现有条目一致。
- 允许局部适配:措辞。
- 具体要求(`CLAUDE.md`):
  1. 「skill 主线」一行的「共 20+ 个 skill」改为「共 25 个 skill」。
  2. 「需求主线」一条从「→ `/write-plan`(可选,大需求)」起改为:「→ `/write-plan`(大需求必走,由它分批)→ `/implementation`(小需求一个会话;大需求每批开一个会话跑,全部完成后回 Claude 跑 `/code-review`;判据是需求规模——≥10 文件且 ≥3 独立模块,不是任务量)。日常默认两步:澄清 + 实现。」
  3. 「平行支线」里「`knowledge-recall` / `knowledge-api` 由 agent 自动召回」改为「`knowledge-recall` 由 agent 自动召回」。
  4. 「1. 文档漂移导致返工」第二条里「PRD(`/write-prd`)、设计文档(`/write-design-doc`)、接口文档(`/write-api-doc`)」改为「需求文档、设计文档、接口文档(`/write-docs`)」。
  5. 「5. 规范靠人记」里「implementation / subagent-implement 执行时只读标注的规范」改为「implementation 执行时只读标注的规范」。
- 具体要求(`README.md`、`README.en.md`):
  1. `README.md`「工作流全景」代码块换成 T-21 给 `how-to-use.md` 的那张图(原样);下面一句改为「日常默认两步:**澄清 + 实现**。大需求先 `/write-plan` 分批,复杂需求按需补规格和测试。」
  2. `README.en.md`「Workflow overview」代码块换成(照抄):

     ```
     knowledge-recall (auto)
             │
             ▼
     /clarify-requirements ──→ /write-spec ──→ /write-plan (required for large work)
       clarify + visual summary   sole contract    batches + kickoff lines
             │                                        │
             │            ┌───────────────────────────┘
             ▼            ▼
       /implementation (one session; large work: one session per batch, then /code-review)
             │
        ┌────┴─────────────────────────────┐
        ▼              ▼                   ▼
     /write-api    /write-unit-test-spec  delivery:
     → /run-api-test → /write-unit-test-code  /knowledge-write capture
       API testing     unit testing         /end closure + release record
                                           commit gate (incl. artifact check)

     ── post-release · on demand (off the critical path) ──────
     /write-docs (requirements, design and API docs)
     ```

     下面一句改为:「Everyday default: **clarify + implement**. Large work goes through `/write-plan` batches; add spec and tests as complexity grows.」
- 具体要求(`CHANGELOG.md`),在 `## Unreleased` 下插入第一条(照抄,可以改英文措辞,不改事实):

  ```markdown
  ### Breaking — skills slimmed from 33 to 25

  - Removed 9 skills. `cgraphx install` deletes their directories on upgrade;
    files under `docs/` are left alone.
    - `subagent-implement`: large work is split into batches by `/write-plan`;
      run `/implementation` in a new session per batch, then `/code-review`.
    - `knowledge-api`: merged into `knowledge-recall`.
    - `code-map-write`, `code-map-recall`: code maps are no longer maintained.
      The web 系统地图 page and existing `docs/code-map/` files stay, marked
      as no longer maintained.
    - `write-prd`, `write-design-doc`, `write-api-doc`: merged into
      `/write-docs`, which asks which documents to write. File names are
      unchanged.
    - `knowledge-migrate`: no replacement.
    - `write-delivery-guide`: no more after-the-fact delivery guides.
      `/clarify-requirements` now ends with a visual summary: in chat for
      small changes, an HTML page in the feature directory for larger ones.
  - Specs drop the 「一图看懂」 section; plan design previews keep only the
    key-decisions table.
  - Skills write the `> 产物:` header and the registered opening section for
    every new artifact; `/end` writes a release record once the work is live.
  - New `cgraphx features check --staged` checks only staged files under
    `docs/features/`. The precommit hook runs it before AI commits and blocks
    on failures, even with `CGRAPHX_PRECOMMIT_REVIEWED=1`.
  - `features check` no longer requires 「一图看懂」 in specs, checks the
    opening section of seven more artifact types, and skips that check for
    HTML files.
  ```

- 具体要求(知识库条目):
  1. `skill-invocation轴.md`:`related_code` 删掉 knowledge-migrate、write-prd、write-design-doc、write-api-doc 四个路径,加 `assets/claude-template/skills/write-docs/SKILL.md`;Summary 末尾补一句「2026-10-19 skill瘦身后为 25 个:17 个 model-invoked、8 个 user-invoked,见文末更新。」;文末加一节「## 2026-10-19 更新(skill瘦身)」,写:废弃 9 个、合并 2 处后剩 25 个;两份名单照共用约定第 4 条;write-docs 沿用三个旧 skill 的 user-invoked;knowledge-api 并入 knowledge-recall 后,knowledge-recall 仍是 model-invoked;subagent-implement 废弃后大需求由 write-plan 分批。
  2. `知识库分类体系.md`:`related_code` 删掉 knowledge-migrate 路径;Summary 里「存量经 knowledge-migrate skill 按内容主题判定迁移」后补「(该 skill 已于 2026-10-19 废弃)」;「关键约束」里「迁移工具:knowledge-migrate skill…」一条末尾补「(knowledge-migrate 已于 2026-10-19 废弃,不再提供迁移工具)」;「## 旧值映射(迁移参考,权威表在 knowledge-migrate skill)」改为「## 旧值映射(迁移参考;knowledge-migrate 已废弃,以本节为准)」;「代码入口」最后一条删掉「`knowledge-migrate/`:存量迁移流程」这半句。
  3. `测试流程后置.md`:`related_code` 删掉 subagent-implement 路径;Summary 里「implementation/subagent-implement 实现期**不作者新测试**」改为「implementation 实现期**不写新测试**」;文末加一行「2026-10-19:subagent-implement 已废弃,实现只剩 implementation 一条路。」
  4. `plan手段决策三档.md`:「残余风险」一条里「+ subagent-implement 的 spec-reviewer 实现期再审」改为「+ 全部批次完成后回 Claude 跑 `/code-review` 整体审查(2026-10-19 起;原为 subagent-implement 的 spec-reviewer 实现期再审,该 skill 已废弃)」。
  5. `枚举换血排查教训.md`:「排查清单」最后一条末尾补「(2026-10-19 起,最终复审由全部批次完成后的 `/code-review` 承担)」;「背景」里的历史描述不改。
- 完成条件:
  - `grep -n -e subagent-implement -e knowledge-api -e write-prd -e write-design-doc -e write-api-doc CLAUDE.md README.md README.en.md` 无结果。
  - 五个知识库条目 `cgraphx docs validate` 全部合法;`grep -n "updated: 2026-10-19"` 五个文件都命中。
  - `CHANGELOG.md` 的 `## Unreleased` 下第一条是本条。
- 验证方式:`for f in skill-invocation轴 知识库分类体系 测试流程后置 plan手段决策三档 枚举换血排查教训; do node dist/cli/index.js docs validate "docs/knowledge/$f.md"; done`;上面的 grep;`npm run build`。
- 独立提交:是,两笔。建议标题:`docs: CLAUDE.md、README、CHANGELOG 按瘦身后的 25 个 skill 更新`;`docs(knowledge): 五个条目补记 skill瘦身后的事实`
- 风险/注意事项:知识库条目里带日期的历史结论保留原样,只追加。

## T-23: 提交门禁接入 `features check`

- 目标:AI 发起 `git commit` 时,precommit-check 先跑 `cgraphx features check --staged --json`:有失败项就拦,带 `CGRAPHX_PRECOMMIT_REVIEWED=1` 也跳不过;只有警告放行;跑不起来放行。然后才是原有的提交说明自查。
- 对应 spec 条款:§8.4(全表)、§12 第 5 行、§13 第 7 条、§14 第 1 条(门禁最后上线)。
- 强制引用:`docs/guides/coding-standards.md`
- 依赖:批次 1 到 7 完成(T-1 提供 `--staged`;各 skill 已会写头部);T-21、T-22 完成。
- 涉及范围:`assets/claude-template/hooks/precommit-check/precommit-check.cjs`
- 必须严格执行:
  - 判断顺序:① 命令不含 `git commit`,放行;② 暂存区为空,放行(原有逻辑);③ 跑 `features check`,有失败项就 `deny`,结束;④ 命令里带 `CGRAPHX_PRECOMMIT_REVIEWED=1`,放行;⑤ 原有的提交说明自查提示,`deny`。
  - 调用:`spawnSync('cgraphx', ['features', 'check', '--staged', '--json'], { cwd: process.cwd(), encoding: 'utf-8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32' })`。参数固定,不含任何文件名或用户输入(Windows 上经 shell 才能调起 `cgraphx.cmd`,所以只能传固定参数)。
  - 跑不起来就放行:spawn 出错、超时、stdout 不是 JSON、JSON 里没有数字型 `failures` 和数组型 `findings`,都当作没跑,继续第 ④ 步。全局 cgraphx 太旧不认 `--staged` 时,stdout 为空,同样放行。
  - 只看 `failures` 和 `level === 'fail'` 的条目;警告(过期、未知类型等)不拦。
  - 拦下时的提示格式(照抄,`N` 和条目按实际填):

    ```text
    【产物检查】本次暂存的产物有 N 处不合格,改对后才能提交(带 CGRAPHX_PRECOMMIT_REVIEWED=1 也跳不过):
    - <path>:<message>;改法:<fix>
    改完重新 git add,再提交。
    ```

  - hook 的输出协议、「任何异常都吞掉,永不阻断正常流程」的原则不变;放行时不输出任何内容。
- 允许局部适配:内部函数拆分、常量命名;文件头注释措辞(要写明两项检查和顺序)。
- 具体要求:
  1. 新增常量:命令参数数组、超时毫秒数(15000)。
  2. 新增函数:跑 `features check` 并解析结果,跑不起来返回 `null`。
  3. 新增函数:把失败条目拼成上面的提示文字。
  4. 改 `main()` 的顺序为「必须严格执行」里的五步;原有的 `ENV_BYPASS` 判断挪到第 ④ 步。
  5. 更新文件头注释:写明先查产物(不能跳过)、再查提交说明(可用 `CGRAPHX_PRECOMMIT_REVIEWED=1` 跳过)。
- 完成条件:
  - `node --check assets/claude-template/hooks/precommit-check/precommit-check.cjs` 通过;`npm run build`、`npm test` 通过。
  - 下面「验证方式」各步结果符合预期。
- 验证方式(在仓库根目录执行,做完全部清理):
  1. `npm run build`;`git diff --cached --quiet` 确认暂存区为空。
  2. 做一个指向本地构建的临时 `cgraphx`:
     ```bash
     SHIM=$(mktemp -d)
     printf '#!/bin/sh\nexec node "%s/dist/cli/index.js" "$@"\n' "$(pwd)" > "$SHIM/cgraphx"
     chmod +x "$SHIM/cgraphx"
     HOOK=assets/claude-template/hooks/precommit-check/precommit-check.cjs
     ```
  3. 新建 `docs/features/2026-10-18-skill瘦身/临时-接口测试-spec.md`,内容只有一行 `# 接口测试规格: 临时`,然后 `git add` 它。
  4. `echo '{"tool_input":{"command":"git commit -m x"}}' | PATH="$SHIM:$PATH" node "$HOOK"`:输出 `"permissionDecision":"deny"`,理由含「【产物检查】」、这个文件的路径和「缺少 `> 产物:`」。
  5. `echo '{"tool_input":{"command":"CGRAPHX_PRECOMMIT_REVIEWED=1 git commit -m x"}}' | PATH="$SHIM:$PATH" node "$HOOK"`:同样被「【产物检查】」拦下。
  6. 把临时文件改成合格:一级标题下加 `> 产物: api_test_spec` 和 `> 依据: spec@<前 7 位>`(用 `node dist/cli/index.js features show 2026-10-18-skill瘦身` 查指纹),加一节 `## 覆盖范围`;再 `git add`。重跑第 5 步:无输出(放行)。重跑第 4 步:被原有的「【提交门禁】」提示拦下。
  7. 模拟太旧的 cgraphx:`printf '#!/bin/sh\necho "error: unknown option --staged" >&2\nexit 1\n' > "$SHIM/cgraphx"`;把临时文件改回只有一行标题并 `git add`;重跑第 5 步:无输出(跑不起来,放行)。
  8. 清理:`git reset -q -- docs/features/2026-10-18-skill瘦身/临时-接口测试-spec.md`,删掉临时文件,`rm -rf "$SHIM"`;`git status` 确认干净。
- 独立提交:是。建议标题:`feat(hooks): 提交门禁接入 features check——产物不合格改对才能提交`
- 风险/注意事项:
  - 本仓库根目录 `.claude/` 里部署的是旧 hook,本任务的提交不受新门禁影响;新门禁在负责人用新构建重跑 `cgraphx install` 后才在本仓库生效。
  - 不要把暂存文件名拼进命令行;不要改 `src/cli/installer/` 里的 hook 注册方式。
