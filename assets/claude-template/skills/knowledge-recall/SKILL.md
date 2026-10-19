---
name: knowledge-recall
description: 从项目 markdown 知识库召回业务概念 — 当用户聊业务/遇到不懂的术语/需要对齐项目黑话/提到一个名词想确认项目里有没有沉淀过,或任务开始时查知识库、查历史决策、找相关文档时,强制派子 agent 在隔离上下文里加载全量 concept 列表做语义匹配,主 agent 只拿命中的概念(名+文档路径+一行说明),不直接看到全量表。Use when 聊业务/不懂这个术语/这个词什么意思/对齐黑话/项目黑话/业务概念/行业术语/这个名词/沉淀过/之前记录过/有没有相关文档/这个业务词/X是什么/这个概念什么意思/任务开始时查知识库/查历史决策/找相关文档.
---

## 这个 skill 解决什么

把"加载全量 concept + 匹配"放进子 agent 的隔离上下文,主 agent 只收命中结果 —— 全量表(几十到几百个概念)不进主上下文。

## 流程

1. **Agent tool 调用**(专用子 agent,指令已内置在 agent 定义里):
   ```
   Agent({
     subagent_type: "knowledge-recall",
     prompt: "当前任务: " + <用户原话或你的转述>
   })
   ```
2. **直接采纳** 子 agent 返回的命中概念列表 —— 不要再自己调 `cgraphx docs concepts/find` 重新查(那是浪费,且会把全量表拉进主上下文)
3. 拿到命中概念后,主 agent 决定下一步:
   - 概念够清晰,直接回答用户
   - **命中里有标"实体主条目"的** → 优先用 `cgraphx docs show <path> --body` 读正文:那是概念的枢纽(定义 / 黑话 / 关键约束 / 代码入口)。要"该实体参与了哪些业务"的全景,再 `cgraphx docs find --concept=<实体>` 反查引用它的流程条目(这是实体参与业务的派生视图,不是重复查询)
   - 需要流程细节 → 用 `cgraphx docs show <path> --body` 读子 agent 返回的流程文档正文,再从条目的代码入口进代码
   - 需要精确查某个概念的其他文档:用下面的命令
   - 子 agent 说"没有命中"→ 告诉用户项目里没沉淀这个概念,问要不要记录;是业务实体(名词、有属性和生命周期)就走 `knowledge-write` 的实体主条目(`business-entity`)

## 命令

- 查概念:`cgraphx docs concepts`
- 按概念反查文档:`cgraphx docs find --concept=<名>`
- 关键词查:`cgraphx docs find --q=<关键词>`(只匹配 title 和 Summary)
- 读正文:`cgraphx docs show <path> --body`。读知识库正文一律用它,不用 cat、Read,这样读过的条目才会记为本次任务的参考;提示 `unknown option '--body'` 说明全局 cgraphx 太旧,先 `npm i -g cgraphx` 升级
- 建索引:`cgraphx docs index`(写了或改了知识文件的 frontmatter、Summary 之后跑;全量重建)
- 以上命令都支持 `--json`
