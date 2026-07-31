---
title: cgraphx web
document_type: concept
domains:
  - web
concepts:
  - cgraphx web
  - 服务基座
aliases:
  - web 本地服务
  - web 端
  - cgraphx web 服务
  - 本地浏览服务
tags:
  - entity
  - architecture
status: active
source_type: ai_session
owners:
  - liulongfei
related_code:
  - src/web/register.ts
  - src/web/server.ts
  - src/web/bootstrap.ts
  - src/web/layout.ts
  - src/web/pages-overview.ts
  - src/web/pages-detail.ts
  - src/web/markdown.ts
  - src/web/constants.ts
  - src/core/markdown/index.ts
created: 2026-07-31
updated: 2026-07-31
---

# cgraphx web

## Summary

cgraphx web 是 cgraphx 2.0 `src/web/` 层的首个实装:`cgraphx web [project-path]` 顶层命令启动的**本地、只读、面向浏览器**的服务,让团队成员在浏览器里浏览目标项目的 docs 知识库与 timeline 开发事件流(又称 web 本地服务 / web 端 / 本地浏览服务)。服务对象是**人**,不是程序——不为 HTTP API 设计稳定契约,不是 1.x 被移除的 MCP server 的复活。与 CLI 的边界:web 与 CLI 是 core 的两个平行消费方,共享同一个 `.cgraphx/cgraphx.db`,web 不调用 CLI 进程。

## 命名与边界

- 规范名「cgraphx web」,对应命令 `cgraphx web`、源码层 `src/web/`。
- 「服务基座」是 cgraphx web 内部的分层概念:命令注册、启动预检、回环绑定、应用壳、全局错误态等公共机制,契约定义在知识库子需求的 spec 中;时间线页面依赖基座,知识库页面自足。
- 易混辨析:1.x 有 MCP server(已在 2.0 整体移除),cgraphx web 与其无继承关系——MCP 面向 agent,cgraphx web 面向浏览器。

## 关键约束与陷阱

以下契约跨文件/跨需求生效,改动前必读对应 spec,不得在实现期自行放宽:

- **仅 localhost**:只绑 127.0.0.1 回环地址,无鉴权、无用户概念。安全模型完全依赖这条边界——不得以"方便调试"为由放开 LAN 绑定;若未来放开,payload 脱敏等须重新评审。
- **只读口径**:web 不写 DB、不写源文件、**不应用 schema**(启动只检查 `*_schema_versions` 表是否存在,绝不执行 `ensure*Schema`)、无任何写操作端点。「只读」指不改变目标项目状态;CLI 侧 `cgraphx docs index` 并发重建时 web 读请求不报错、可能读到新旧快照(可接受)。
- **元数据与全文不调和**:web 的文档元数据以索引 DB 为准、全文以源文件当前内容为准;源文件改后未重建索引时两者可能不一致,不提示、不阻塞。全文渲染只接受索引 DB 记录过的文档路径(无"给路径就渲染"的端点)。
- **未初始化引导 `cgraphx install`**:2.0 无 `cgraphx init` / `cgraphx status` 命令(`.cgraphx/` 创建与两套 schema 应用由 `cgraphx install` 完成)——错误消息与文档勿写 init。
- **分层例外(仅此一处)**:`src/cli/index.ts` 作为组合根 import `src/web` 的注册入口(wiring);`src/web/` 自身只依赖 `src/core/`。
- **需求拆分**:知识库(`2026-07-30-cgraphx-web知识库浏览`,含基座)与时间线(`2026-07-30-cgraphx-web时间线浏览`)是两个平行子需求;时间线 spec 声明依赖知识库 spec 的基座条款,基座契约改动需两边对齐。
- 端口默认 2468(`--port` 指定);被占用时报错提示换端口,不自动换(行为可预测优先)。
- 技术形态已拍板且写入 spec:服务端渲染 HTML + 极少 JS(URL 即状态)、markdown-it 服务端渲染(`html:false`)、node:http 手写路由,零前端构建链,随单包 npm 分发。

## 代码入口

- `src/web/`:register(命令注册)/ server(路由与生命周期)/ bootstrap(启动预检四步)/ errors(错误层级与退出码映射)/ layout + pages-overview + pages-detail(服务端渲染页面)/ markdown(markdown-it 单例)/ constants(类型与状态显示标签映射)/ public(静态资产,经 `scripts/copy-assets.cjs` 随包分发)。
- 数据访问只经子系统门面:`src/core/markdown/index.ts`(知识库读侧;`MarkdownQuery.findPaged` / `getStats` 为 web 扩展,`find` 输出保持 CLI 兼容基线)、`src/core/timeline/index.ts`(时间线读侧)。

## 相关表

不拥有表——只读消费 `markdown_*`(知识库)与 `timeline_*`(时间线)两套前缀表,见各子系统 schema(`src/core/markdown/schema.sql` / `src/core/timeline/schema.sql`)。

## 关联流程

时间线页面为平行需求(spec 已定、实现待启动)。「参与业务」全量视图由 `cgraphx docs find --concept=cgraphx web` 反查派生,不在此维护。

## Open Questions

- 时间线子需求实现后,基座契约(应用壳、预检、错误态)可能需要小幅扩展,届时以知识库 spec 为基线增量修订。
- db(dbquery)子系统对接在导航中以"后续"灰置占位,涉及凭据与只读安全模型,另议。
