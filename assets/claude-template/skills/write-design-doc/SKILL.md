---
name: write-design-doc
disable-model-invocation: true
description: 功能发布后(或自测通过后)按需执行——从本地图谱知识库(docs/knowledge/)和当前 feature 目录下的 spec/plan 召回素材,合成面向研发和技术负责人的"设计文档"。默认输出到 docs/features/<feature-id>/<文件前缀>-设计文档.md。支持 HTML 和 Markdown 两种输出格式,可按章节结构进行配置。不在开发主链上,不参与流程门禁,纯事后文档合成。
---

# 生成设计文档 (Write Design Doc)

## 定位

- **发布后的事后文档,不在开发主链上**:功能发布后(或自测通过后)按需执行,从 `docs/knowledge/` 召回项目级背景(cgraphx docs),读 feature 目录的 spec/plan,合成给研发/技术负责人/维护者读的设计文档("生成设计文档"、"沉淀一下设计文档"时触发)。
- **两类来源缺一不可**:knowledge 给项目级架构/决策/风险;spec/plan 给本 feature 的目标/契约/任务拆分。knowledge 为空且无 spec/plan → **拒绝生成**,提示先备素材。
- **事后沉淀,不是契约**:不得重新定义 spec 已锁定的契约;发现 spec 与代码现实不符,标【待确认】,不自行解释。
- **边界**:写知识文件 → `knowledge-write`;查知识辅助编码 → `knowledge-api`;探索陌生项目 → `knowledge-init`;PRD/spec/plan → 各自 skill。

## 依赖

- cgraphx 已装、`docs index` 已跑(用 `docs concepts` 验证;索引为空 → 先按 `knowledge-write` 沉淀再 index)。
- feature 目录下有 spec(`<文件前缀>-spec.md`)和/或 plan(`plan/`)。

## 流程

1. **确认**:feature-id/输出路径(默认按下方规则,用户可覆盖)、输出格式(html/md)、目标章节(默认全含默认章节)、可选的主题范围补充。
2. **召回 knowledge**:`cgraphx docs find` —— 推荐 `--concept=<名>`(最精准);或 `--domain=` / `--q=<词>`(整串 LIKE title+Summary)/ `--tag=`,多维组合取交集;用 `docs concepts/domains/tags` 找主题入口。每条结果含 title/document_type/status/updated/summary/path。
3. **读 feature 目录**:spec(目标/规则/约束/不可留实现期决策)+ `plan/<前缀>-index.md`(任务/依赖/范围)+ 按需子文件。plan 不存在 → 如实标注"无 plan,任务拆分章节缺失",不凭空补。
4. **读 knowledge 详情**:Summary 不够 → `docs show <id>` 或直接 `Read <path>`(只有 Summary 进索引,其余章节靠 Read 原文);需扩展召回 → `docs refs` 看双向引用。
5. **评估覆盖度**:两类来源不足以覆盖所计划章节 → 告知用户缺什么。
6. **合成 + 格式化**:按章节菜单重组(见「合成规则」),按所选格式读模板生成:[template-design-html.md](template-design-html.md) / [template-design-md.md](template-design-md.md)。
7. **质量检查**:所有事实有来源 · 章节连贯 · 未重定义 spec 契约 · 格式排版。
8. **保存 + 反馈**:写入路径;告知位置 + 覆盖范围;列出"可能需要补充的知识"(如有)。本 skill 只读,不写 `docs/knowledge/`。

## 章节菜单

**默认章节**(未指定时全含,按此顺序):

| 章节 | 用途 | 主来源 |
|---|---|---|
| 概述 / Overview | 主题、目标、定位 | spec 目标与范围 + knowledge Summary |
| 架构设计 / Architecture | 系统架构与数据流 | spec 系统行为 + knowledge Summary + Read 原文 |
| 核心模块 / Core Modules | 模块职责与交互 | plan 任务拆分 + knowledge Summary |
| 技术决策 / Key Decisions | 重要决策及理由 | spec 不可留实现期决策 + knowledge Decisions |
| 已知限制 / Known Limits | 技术约束与已知问题 | spec 待确认项 + knowledge Findings/Risks |
| 扩展方向 / Extension Points | 可扩展点与改进方向 | knowledge Outlook |

**可选章节**(按需):数据模型 / Data Model(plan schema + spec 口径)· API 参考 / API Reference(spec 接口边界 + plan backend)· 性能特征 / Performance(knowledge Findings)· 运维指南 / Operations(knowledge Operations)· 术语表 / Glossary(spec 术语 + knowledge 术语)· 相关资源 / References(spec/plan/knowledge 引用)。

用户可指定包含/排除;未指定 → 全部默认章节。

## 合成规则

- **来源**:所有事实性内容来自 knowledge 或 spec/plan,不编造;缺失 → 如实标"待补充"或省略;可归纳但必须忠实原文。
- **结构重组**:设计文档按"知识传递"组织(概述/架构/模块/决策/限制/扩展);**不照搬** knowledge 的标题或 spec/plan 的章节;相关信息进同一章节;重复信息合并只出现一次。
- **语气转换**:knowledge 是分析记录、spec/plan 是契约/清单 → 设计文档是知识传递:被动描述转主动解释,技术分析转可操作指导。
- **引用溯源**:不引用 knowledge 文档路径、不引用 spec/plan 路径(读者已在 feature 目录);引代码用相对路径,引外部文档用 URL/标题。

## 语言与风格

- 正文中文;技术术语/标识符/路径/专有名词(Neo4j、pgvector、BM25)保留英文;章节标题可中英双语(HTML 锚点兼容);代码注释用中文。
- 排版:段落间空行;`##` 起章节;重要概念首次出现加粗;代码块标语言;超 5 行段落考虑拆分。
- 风格:精炼直接,主动语态,避免"可能/也许"式模糊;不确定性明确标注("当前不确定"、"待验证")。

## 图表

- **优先 Mermaid**(flowchart / sequenceDiagram / classDiagram / stateDiagram / erDiagram / gantt)——纯文本可维护、跨平台一致;仅 Mermaid 无法表达时(手绘风、特殊布局)用外部图片/SVG。
- 图表放相关章节、紧跟解释文字;每张图前一句用途说明;过复杂的拆多张。
- md 用 ```mermaid 代码块;html 引入 Mermaid CDN + `<pre class="mermaid">`(见模板)。

## 输出格式

- **HTML**:单文件自包含(内联 CSS,不依赖外部样式表)、响应式 + `@media print`、浅色高对比阅读主题、文档开头自动生成可点击目录;完整 CSS 与结构见模板。
- **Markdown**:无 YAML frontmatter(区别于 knowledge 文件)、层级标题、围栏代码块标语言、开头标题列表作目录、引用块注明生成日期/主题范围/feature-id。

## 保存位置与命名

- 路径:`docs/features/<feature-id>/<文件前缀>-设计文档.md`(或 `.html`);用户参数可覆盖。
- **feature-id 识别**:用户显式指定 > 从 cwd 向上探测最近的 `docs/features/<feature-id>/` > 都失败 → 报错要求用户指定。
- **feature-id 格式**:`YYYY-MM-DD-[业务ID-]<标题>`;前缀:有业务ID = `<业务ID>-<标题>`,无 = `<标题>`;标题允许中文,**不得中文转英文 slug**;敏感字符(`/ \ : * ? " < > |`)拒绝,要求用户重命名,不自动替换。

## 红线(绝对不能做)

1. ❌ **不编造**无来源的细节/数据/结论——缺失标"待补充"或省略。
2. ❌ **不重新定义 spec 已锁定的契约**;spec 与代码现实不符 → 标【待确认】。
3. ❌ **不写 `docs/knowledge/`**——本 skill 只读。
4. ❌ **正文不引用 knowledge/spec/plan 的内部路径**。
5. ❌ **不照搬来源章节结构**——必须按知识传递目的重组。
6. ❌ **不中文转英文 slug**——命名按规则。
