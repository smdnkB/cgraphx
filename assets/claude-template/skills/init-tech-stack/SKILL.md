---
name: init-tech-stack
disable-model-invocation: true
description: 新项目启动技术选型 — 按 12 层决策树(产品形态→语言生态→后端框架→数据库→ORM→缓存→部署形态→前端框架→路由→状态缓存→CSS→工程结构)逐层给推荐+备选优劣对比,分组与用户敲定,产出 docs/adr/ 下的技术栈选型 ADR;新项目在 /init-guides 前跑,需求引入新技术栈时在 /dev-spec 前跑,系统迁移由 /dev-migrate 提示用户跑。Use when 新项目选型/技术选型/选型敲定/技术栈选型/技术栈敲定/选什么数据库/选什么框架/选什么ORM/新项目启动/项目初始化/产品形态选型/生态选型/前后端选型/工程结构怎么定/tech stack/选型.
---

# 技术栈选型 (init-tech-stack)

## 定位

每个新项目启动都有一套选型要做:产品形态、生态、框架、数据库、前端、工程结构。自由讨论时容易漏层、没有推荐依据、聊完不落档,下次重聊。本 skill 把选型固化为**依赖有序的 12 层决策树**:每层给出推荐 + 相对备选的优缺点,分组与用户敲定,最后落 ADR 文档作为后续 spec/plan 的选型约束(plan 不得重开选型)。

**流程位置**:新项目启动时,在 `/init-guides` 前跑;需求里要引入新技术栈时,在 `/dev-spec` 前跑,ADR 作为 spec 的输入;系统迁移时由 `/dev-migrate` 提示用户跑。

**边界**:只做选型决策与归档——不搭脚手架、不写代码、不写 spec/plan;不自动进入下游。没有 spec 也能跑(纯选型),此时 ADR 是后续 spec 的输入。

## 流程

0. **前置读取**:看会话上下文 / spec / clarify 产物,已拍板的形态与约束如实接收(如「服务端 + web 看板」「无登录纯 MVP」),**不重开、不推翻**。选型不得违反 spec 业务契约;冲突时回跳,让用户改 spec 或改选型,不硬凑。
1. **定树(按 L1 裁剪)**:L1 产品形态决定下游哪些层适用(web 全套;CLI 砍 L8–L11;移动端把前端层换成 RN/原生;无后端砍 L3/L5……)。先把裁剪后的层清单告诉用户,再开问。
2. **逐层给推荐**:每层格式 = **推荐项(标「推荐」)+ 2–4 个备选的优劣对比表**。优劣必须是**相对取舍**(相对谁、为什么取/舍、代价是什么),不写「生态好」「性能强」这类空话。推荐随用户约束变(单人/团队、性能敏感度、运维能力),基线见「决策树」节。
3. **分组敲定**:用 AskUserQuestion,**每组 ≤4 问、一次只发一组**;每问推荐项放首位并标「(推荐)」,description 写清选它的后果。用户全按推荐走也要逐组确认——**推荐不是锁定**。用户明说某层跳过 = 接受推荐,记入产物。
4. **允许回跳**:后面层倒逼前面层(如想上 SSR → 回改 L8/L9;要移动端 → 回改 L1)就退回重敲,不将就。
5. **落档**:产物写 `docs/adr/<NNN>-技术栈选型.md`(模板见下;目录已有 ADR 则编号递增)。
6. **收口**:spec 的设计决策表引用 ADR,不重开选型;新项目尚未写 spec 时,ADR 作为 spec 的输入;没有 spec 则跳过。提示用户审阅,**不自动进 plan/实现**。

**单层咨询**(用户只问「数据库选啥」这类):只跑对应层,格式不变(推荐 + 优劣表 + 确认),不摊开整棵树。

## 决策树(12 层,依赖有序)

| 层 | 问题 | 基线推荐(2026-10) | 裁剪条件 |
|---|---|---|---|
| L1 产品形态 | web / 桌面壳 / App / PWA / CLI? | 纯 Web 响应式(看板/管理台类) | —(L1 裁剪下游) |
| L2 语言生态 | TS / Go / Java / Python? | TS 全栈 | — |
| L3 后端框架 | Fastify / NestJS / Hono / tRPC? | Fastify + zod + OpenAPI | 无后端则砍 |
| L4 数据库 | PostgreSQL / MySQL / SQLite? | PostgreSQL | 无持久化则砍 |
| L5 ORM | Drizzle / Prisma / Kysely / 裸 SQL? | Drizzle | 无库则砍 |
| L6 缓存 | 不上 / Redis / 进程内存? | MVP 不上,慢了再加 | — |
| L7 部署形态 | 同仓单进程 / 同仓分离 / 独立仓? | 同仓 monorepo,server 托管 web 静态 | — |
| L8 前端框架 | React / Vue / Svelte? | React | 非 web 前端则换层 |
| L9 路由 | React Router / TanStack Router / Next.js? | React Router v7(SPA data 模式) | 无前端/SSR 需求变化则砍/换 |
| L10 状态缓存 | TanStack Query + Zustand / Redux / SWR? | TanStack Query + Zustand | 无前端则砍 |
| L11 CSS | Tailwind v4 + shadcn/ui / MUI / UnoCSS? | Tailwind v4 + shadcn/ui | 无 UI 则砍 |
| L12 工程结构 | monorepo 三包 / 单包 / +turbo? | pnpm workspaces:`apps/server` + `apps/web` + `packages/shared` | — |

各层取舍要点速查(对话中的优劣表要结合用户约束**真实生成**,不要照抄):

- **TS 全栈**:与 agent hook/SDK 同语言,前后端共享 zod schema/类型;弃 Go(双栈双构建)、Java(仪式重)、Python(类型共享弱)。
- **Fastify**:快、schema 驱动、插件全;弃 NestJS(单人拖慢)、tRPC(外部接入方须 HTTP+JSON,免双协议)。
- **PostgreSQL**:聚合/窗口函数合报表统计;弃 SQLite(迁库痛苦)、MySQL(报表无优势)。
- **Drizzle**:TS 原生、SQL 透明、轻;弃 Prisma(引擎二进制重)、TypeORM(老旧)。
- **无缓存**:现算打库,缓存是查询慢了之后的手段,早上是负资产。
- **同仓单进程**:一仓一部署、类型共享、日后可拆;弃独立仓(契约人肉同步)、分离部署(运维双份)。
- **React + Tailwind v4 + shadcn**:生态与既有经验复用;弃 MUI/Ant(与 Tailwind 路线冲突)。
- **TanStack Query + Zustand**:服务端状态缓存契合「现算」模式;弃 Redux(单人过重)。
- **pnpm 三包**:`packages/shared` = API 契约唯一真相,依赖方向 `shared ← server/web`;弃 turbo(单人 YAGNI)。

## 产物模板

`docs/adr/<NNN>-技术栈选型.md`:

```markdown
# ADR-<NNN>: 技术栈选型

> 状态: 已采纳 | 日期 | 决策人 | 关联需求/文档

## 背景
(为什么选型;输入了哪些已拍板约束)

## 决策(逐层)
| 层 | 选定 | 相对备选的取舍理由 |
|---|---|---|
(裁剪后各层一行,取舍理由写「为什么取它/弃谁/代价是什么」)

## 工程结构约定
(目录树 + 依赖方向 + API 契约归属 + 业务规则归属)

## 与 spec 的关系
(收口「由 plan 选型」表述;或声明本 ADR 为 spec 输入)

## 后果
(正面 / 负面与风险,含回补路径)
```

## 推荐下一步

- 新项目:把 ADR 交给 `/init-guides`,按选型生成 `docs/guides/` 五份规范。
- 需求引入新技术栈:把 ADR 带进 `/dev-spec`,在它的设计决策表里引用,不重开选型。
- 系统迁移:回到 `/dev-migrate` 第 3 步(模块划分、表映射、切片路线图)。
- 不自动跑下游;用户说继续再走。

## 红线

1. ❌ **推荐不是锁定**——用户没确认的不写「已采纳」;全按推荐也要逐组点过。
2. ❌ **不重开已拍板的层**(spec / clarify / 会话里定过的,如实接收)。
3. ❌ **不搭脚手架、不写代码、不自动进 plan/实现**。
4. ❌ **优劣表不写空话**——「生态好」「性能强」不算数,要写相对谁、为什么取/舍。
5. ❌ **适用层不得静默跳过**——层可裁剪(不适用),但适用层要么问、要么用户明说跳过(=接受推荐,记入产物)。
6. ❌ **选型不得违反 spec 业务契约**——冲突回跳用户拍板,不硬凑。
