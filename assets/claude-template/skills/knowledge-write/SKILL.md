---
name: knowledge-write
description: 维护可供 cgraphx docs 索引的 Markdown 知识文件(docs/knowledge/)。用于创建、编辑、规范化或提取元数据,将对话、代码探索结果、教程、指南、运维手册、安装说明、决策、经验教训、业务实体概念或面向 AI 的项目知识保存为可被 cgraphx docs 检索的 .md 文件。
---

# 知识沉淀 (Knowledge Write)

## 定位

- **知识库 = 业务概念与代码的索引,不是百科**:条目只存代码给不了的东西(概念定位、黑话映射、跨文件才看得出的关系、代码入口指针),行为细节让 agent 从代码入口进去读。代码是事实来源,条目是指北针。不存细节,所以没有东西可腐烂。
- **重构幸存测试**(该不该进库的判据):代码重构之后这条还成立吗?概念名 / 文件级入口 / 跨文件关系成立;行号 / 步骤时序 / 实现逻辑不成立——后者一律不写。
- **双层结构**:实体层(`concept` 条目,一个业务实体一个文档)+ 流程层(exploration/guide 等,一个业务流程一个文档),靠概念引用连接——召回精度的根基。

## 流程

1. **定目标路径**(`docs/knowledge/` 下,一个文档一个主题;目录不存在则创建;知识文件不存到别处)。
2. **命名新概念前先查已有词汇**(见 CLI):含义相同 → 复用规范名;替代名称走 `aliases`,不造重复 concept。
3. **更新已有文件 → 先读取并保留其 frontmatter**(见「维护」)。
4. **写 frontmatter**(见「Frontmatter 规范」)+ 正文必含 `## Summary`——唯一进索引的章节。
5. **Write 后立刻 `cgraphx docs validate <file>`**:非法 → 修 frontmatter 再 Write 再校验,直到合法才告知用户已保存(非法文件 index 时整个跳过,校验前置不是可选)。
6. **合并检查**:三条件全满足才提示用户(见「维护」)。
7. **询问是否触发扫描**;未经确认不跑 `cgraphx docs index`(全量覆盖式重建,事务性:失败回滚,不坏旧索引)。

## 双层结构:实体条目与流程条目

- **实体主条目**(`document_type: concept`):业务实体 = 能用名词指代、有属性和生命周期、被多个流程引用(商品 / 礼包 / 订单)。按 [template-concept.md](template-concept.md) 写——只做定位与指引(定义 / 黑话 / 跨文件约束 / 代码入口),行为细节留给代码。
- **流程条目的正向引用**:必须在 `concepts:` 声明所涉实体(规范实体名);漏标 → 该流程从实体视图消失。
- **反查 = 派生的"参与业务"视图**:`find --concept=<实体>` 返回所有引用该实体的文档。**任何条目里都不手动维护全量清单**——手动维护必陈旧,反查永远最新。
- **同名严格性**:流程条目里的实体名与实体条目的规范 concept 名逐字一致;建条目前先 `docs concepts` 查名,错一个名反查就断。
- **不是所有概念都配主条目**:机制概念(Scene 分发机制、准三层)、动作概念(礼包续订)留作 tag;只有业务实体升级。
- **沉淀时机**:功能交付完成时最佳(理解最新鲜);implementation/subagent-implement 收尾会提示识别实体;只从一两个流程抽出的条目用 `status: draft` + Open Questions 标记未补全。

## Frontmatter 规范

```yaml
---
title: Redis 本地安装指南
document_type: guide
domains:
  - infra
concepts:
  - Redis
  - 本地开发环境
aliases:
  - Local Development Environment
  - Redis Setup
tags:
  - tutorial
  - cache
status: active
source_type: human_note
owners:
  - platform
related_code:
  - src/main/java/demo/OrderService.java
related_documents:
  - docs/guides/order-flow.md
created: 2026-04-28
updated: 2026-04-28
---
```

- **必填 7 项**:title / document_type / domains / concepts / status / source_type / updated。
- **时间**:`YYYY-MM-DD`;`created` 可选推荐。
- **`related_code`**:仅作元数据保存(不建反向链接,不校验路径存在);用文件级路径或全限定类名,不写行号。
- **`document_type` 枚举(17)**:conversation 对话总结 · exploration 探索发现 · finding 调查结论 · analysis 深度分析 · lesson 经验教训 · warning 警告/陷阱 · decision 决策记录 · rule 团队规则 · architecture 架构说明 · guide 指南 · tutorial 教程 · runbook 运维手册 · installation 安装说明 · api API 文档 · faq 常见问题 · note 笔记 · **concept 实体概念主条目**。
- **`source_type` 枚举(7)**:ai_session · human_note · code_review · debugging · architecture_review · manual(默认)· external_summary。
- **`status` 枚举(4)**:draft · active · superseded · deprecated。

## Summary 章节(唯一进索引)

- 只有 `## Summary`(中文别名 `## 摘要`)进索引;**标题大小写敏感,必须正好两个 # + 一个空格**。其他章节留在文件里,AI 想看就 Read。
- 章节按 `document_type` 选模板——模板是写作指南,不是索引契约:

| document_type | 模板 |
|---|---|
| conversation / exploration / finding / analysis / decision / lesson / warning / rule / architecture | [template-memory.md](template-memory.md) |
| guide / tutorial / installation / api / faq / note | [template-guide.md](template-guide.md) |
| runbook | [template-runbook.md](template-runbook.md) |
| concept | [template-concept.md](template-concept.md) |

## 命名与语言

- **concept**:一个概念一个规范名,优先复用已索引名(`docs concepts` 查);不造翻译重复项(Redis / redis server / Redis Installation 算重复);替代名(译名 + 同义词 + 缩写)进 `aliases`。
- **命名由检索机制决定**:`find --q` 是整串 LIKE,**只匹配 title + Summary**(concept 名不参与)→ 黑话/口语变体要在 Summary 出现一次才可被 `--q` 命中;`find --concept` 是精确过滤、召回子 agent 用 concept 名做语义匹配 → 规范名用项目实际用词;aliases 只归一,不参与搜索。
- **语言**:中文概念不硬翻英文——代码标识符/协议/产品名保留真实形式(Redis / SqliteStore / FTS5),业务/流程概念用项目语言(本地开发环境、任务办理流程);正文用中文,术语/标识符/路径保留英文;Summary 标题保留英文。
- **domain**:稳定有界(order-service / infra / cache / billing);**tags**:松散分组,不替代 concepts/domains。
- **文件名**:主题 slug 跟项目实际叫法(常说"流程"就用"流程",常说 redis 就用 redis),不二次翻译;不进索引、不参与检索,中文名不影响命中。

## CLI

- **查已有词汇**:`cgraphx docs concepts`(concept + 关联文档数 + domain)/ `docs domains` / `docs tags`;查特定:`find --q=<词>`(整串 LIKE,title+Summary)/ `find --concept=<名>`(精确过滤,也是实体反查入口)。索引未建 → `grep -rl "concepts:" docs/knowledge/ --include="*.md"`。
- **校验**:`docs validate <file>`(exit 0 合法 / 2 非法;`--json` 出 {valid, skipReason, detail})。规则与 index 扫描一致(单一事实源 `src/core/markdown/validator.ts`):title 非空 · document_type 属 17 枚举 · domains/concepts ≥1 项 · status 属 4 枚举 · source_type 属 7 枚举 · updated 为 YYYY-MM-DD。
- **扫描**:`docs index`——全量覆盖式重建,事务性(任一步失败回滚,旧索引不坏)。

## 质量规则

- **应记录**(满足任一):非显而易见的业务逻辑 · 决策原因(尤其有替代方案时)· 跨系统的执行流程与运维操作 · 陷阱与隐式约束 · 跨系统依赖 · 历史背景(事故/变通/遗留约束)。
- **不记录**:代码/配置已记录的 · 通用编程知识 · 已应用的一次性修复 · 逐字对话记录(提取结论,不提取过程)· 工具使用说明 · 可从文件结构推导的 · **行号与符号偏移**(只写文件级路径)· **步骤时序与代码逻辑复述**(条目给代码入口,写步骤就种下腐烂)。
- **通用**:持久知识优于对话日志;保留证据(文件级路径/符号名/命令输出)使他 AI 可信任;不确定性用 Open Questions 或 `status: draft`;陷阱用 `warning`;被替代用 `superseded` + `related_documents` 链替代者;教程/指南尽量含 Validation / Troubleshooting。

## 维护

### 更新已有文件

提取现有 frontmatter;保留未知字段(明显有误除外);列表字段规范化;补缺失必填项;**未查已有用法前不重命名 concepts/domains**;保留有用标题;优先追加带日期新发现,而非重写历史结论(除非已过时)。

### 合并检查

仅三条件**同时满足**才提示:① document_type 匹配或兼容(guide/installation、conversation/exploration 互兼容;**concept 与流程类永不互合**——实体新发现追加进实体条目);② 核心概念高度重叠(至少一个核心 concept 出现在对方 `concepts:` 中,边缘重叠不算);③ 范围相似(覆盖同一知识领域,不只是提到相同概念)。

查候选:`find --concept=<核心概念>` / `find --q=<标题关键词>`(无索引则 grep)。合并时:读全文 → 带日期标题下追加 → 更新 `updated` + 合并 concepts/aliases/tags/related_code/related_documents → 删除新文件 → 保留已有 `title`(除非用户给了更好的)。

### 拆分

一个文档覆盖多个不相关概念 → 拆:每文档聚焦一个核心概念;章节不共享 concepts/domains/type → 分文件;相关但目的不同且概念显著重叠 → 可同文档;按主题命名,`related_documents` 互链。

## 红线(绝对不能做)

1. ❌ **知识文件不出 `docs/knowledge/`**。
2. ❌ **不跳过校验 Write**——修到 validate 合法才告知已保存。
3. ❌ **未经用户确认不跑 `docs index`**。
4. ❌ **不造重复 concept**——先查词汇,替代名走 aliases。
5. ❌ **不写行号 / 步骤时序 / 代码复述**——索引层只存定位与指针。
6. ❌ **不手动维护"参与业务"全量清单**——`find --concept` 反查派生。
7. ❌ **不硬翻中文概念为英文**——用项目实际话语。
