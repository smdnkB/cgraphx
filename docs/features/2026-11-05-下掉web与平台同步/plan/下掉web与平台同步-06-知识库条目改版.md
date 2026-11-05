### T-6: 知识库条目改版(六篇 deprecated,五篇改段落)

> 产物: plan
> 依据: spec@1fedd36

- 目标: 整篇讲已下掉功能的六篇知识条目标 `deprecated` 并在摘要开头指向本需求;部分相关的五篇只改讲到上报、任务的段落;改完知识库全部合法、索引重建。
- 对应 spec 编号: D15。(执行者据此读 spec 原文,不凭任务转述猜)
- 强制引用: `docs/guides/coding-standards.md`(文档无代码,守中文与事实准确的约定即可)
- 涉及范围(都在 `docs/knowledge/` 下):
  - 改 `status: deprecated` 六篇:`cgraphx-web.md`、`平台上报.md`、`开发任务.md`、`开发任务绑定.md`、`开发任务浏览.md`、`开发任务投入时长口径.md`。
  - 只改段落五篇:`会话id来源约束.md`、`开发时间线工具事件契约.md`、`需求副本.md`、`并旧数据.md`、`Bash事件cwd是执行后的目录.md`。
  - 与同一步同时跑的任务(T-1、T-4、T-5)不重叠。
- 必须严格执行:
  - 六篇:frontmatter 的 `status` 改成 `deprecated`(其余 frontmatter 字段不动);Summary(摘要段)开头加一句:「2.0.14 起已下掉,见 `docs/features/2026-11-05-下掉web与平台同步/`」;正文其余内容**不删不改**(后期按副本记任务、补历时时还要参考原口径)。
  - 五篇:只改讲到上报、任务的段落——把已下掉的部分改成一句「已下掉(见上)」式的短说法或删掉该段,其余段落一字不动;不整篇标 deprecated。
  - 全部改完跑 `cgraphx docs validate`(须全过),再 `cgraphx docs index` 重建索引。
- 允许局部适配:
  - 五篇里被改段落的收法(删段 / 改写成一句),以「读的人不会再照旧口径行事」为准。
- 具体要求:
  - 六篇的 `status` 当前值可能是 active 或其他,一律改 `deprecated`(取值域:draft / active / superseded / deprecated)。
  - 不新建文件、不删文件、不改 `docs/knowledge/` 里这 11 篇以外的条目。
  - 若某篇里「平台」「上报」「任务」的说法散在多处,只动「讲了被下掉功能本身」的段落;顺带提及(如举例)的不必清。
- 完成条件:
  - `cgraphx docs validate` 全部通过;`cgraphx docs index` 成功;`cgraphx docs find --status deprecated` 能列出这六篇。
- 提交点:
  1. `docs(knowledge): 下掉功能六篇转 deprecated——五篇改上报任务段落`:11 个文件。
- 风险/注意事项:
  - 知识库索引是本目录本地 `.cgraphx/` 的库——validate 与 index 都在本仓库根目录跑,别去别的目录。
