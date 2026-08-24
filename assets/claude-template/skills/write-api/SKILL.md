---
name: write-api
description: 基于需求生成 bruno 测试接口(.bru + 接口测试规格 + 环境配置)。流程:识别接口范围(用户显式给 / spec 接口章节 / AI 读 spec 理解)→ 生成接口测试规格文档 → 单次 AI 调用生成 .bru(含真实参数 + 内嵌断言)→ 首次接入时生成 bruno.json + environments/*.bru 骨架。产物:接口测试规格随 feature 走;.bru collection 按 <服务>/<需求前缀>/<接口名>/<场景> 组织在 docs/bruno/(按需求隔离,跨需求不覆盖);environments 统一管理。本 skill 不跑 bru run、不核实 DB、不出报告——那是 /run-api-test 的职责。不调 write-api-doc、不自动修代码、不引入程序化配置文件(微服务/通用接口识别由 AI 判断)。Use when 用户要求生成测试接口 / 写接口测试 / 准备 bruno 测试 / 帮需求补接口 / 免去手动录接口。
---

# Write API

## 定位

造弹药 skill:基于需求生成 bruno 测试接口的"原料"——接口测试规格 + .bru + 多环境配置。跑测试 + DB 核实 + 出报告由 `/run-api-test` 接管,本 skill 不做。

## HARD-GATE

- 不重新定义 spec 已锁定的接口契约——发现 spec 与代码现实不符,标注【待确认】而不是自行解释
- 不编造未在代码或 spec 中体现的接口、参数、响应字段、断言
- 编写的请求地址禁止使用 baseUrl,因为一个项目会有很多服务, 必须使用服务名称作为地址变量(如 `so-assist: http://127.0.0.1:8087`)

## Trigger

**使用此 skill 当**:
- 用户要求"生成测试接口""写接口测试""准备 bruno 测试""write-api"
- 用户在 `/implementation` 或 `/subagent-implement` 完成编码后,触发本 skill 准备测试接口
- 用户想为某个需求生成 / 补接口,免去手动录

**不要使用此 skill 当**:
- 跑接口测试 → 用 `/run-api-test`
- 写 PRD / spec / plan → 用 `/write-prd` / `/write-spec` / `/write-plan`
- 写 HTML 接口文档 → 用 `/write-api-doc`
- 探索陌生项目 → 用 `/knowledge-init`
- 查代码调用关系 → 用 grep / Read

## 与既有 skill 边界

| skill | 关系 | 说明 |
|---|---|---|
| `run-api-test` | 下游 + 独立 | 消费本 skill 产的 .bru + 接口测试规格跑测试;本 skill 不调它,跑测试由用户显式触发;同一份 .bru 可被多次 run-api-test 复用 |
| `db-query` | 复用 | S3 查真实测试数据;DB 副作用核实由 `/run-api-test` R4 做 |
| `write-api-doc` | 独立并列 | 不互相调用;本 skill 产 .bru + 接口测试规格,write-api-doc 产 HTML 接口文档 |
| `implementation` / `subagent-implement` | 上游 | 编码阶段,跑完触发本 skill |
| `write-design-doc` | 独立 | 发布后按需产设计文档 |

## 依赖

- feature 编码已完成(`/implementation` 或 `/subagent-implement` 跑完)
- `docs/features/<feature-id>/<文件前缀>-spec.md` 存在(S1 优先级 2 要用)
- `docs/guides/interface-standards.md` 存在(接口约定;缺失 → 提示 `/init-project-guides` 补齐,见工作流前置)
- 项目已配置 db-query profile(S3 查真实数据)—— 未配置则 S3 降级

## feature-id 与文件前缀规则

复用既有规则(同 `/write-prd` / `/write-spec` / `/write-plan` / `/write-api-doc` 的算法):

- feature-id 格式:`YYYY-MM-DD-[业务ID-]<标题>`
- 文件前缀:有业务ID = `<业务ID>-<标题>`,无业务ID = `<标题>`
- 标题段允许中文、英文或混合,**不得**对中文做英文 slug 转换
- 文件名不得包含 `/`、`:`、`*`、`?`、`"`、`<`、`>`、`|`

产物文件名:
- 接口测试规格:`docs/features/<feature-id>/<文件前缀>-接口测试-spec.md`
- .bru:`docs/bruno/<服务>/<文件前缀>/<接口名>/<场景>.bru`(按需求隔离,见 `references/collection-layout.md`)
- bruno.json + environments:见 `references/environment-setup.md`

接口测试报告 / JSONL 不由本 skill 产——`/run-api-test` 跑完后产,落 `docs/features/<feature-id>/`。

## 工作流

按 S1-S4 顺序执行,每步的规范细节在对应 reference 文件。

**前置(每次执行,先于 S1):读接口规范** `docs/guides/interface-standards.md` —— 约束 S1 接口识别(路径/版本约定,从 spec/代码里认出真正的接口)与 S3 .bru 生成(请求路径、参数形态、header、错误码断言预期)。**缺失 → 中断,提示用户先跑 `/init-project-guides` 补齐**,用户明确表示不需要规范才可继续——不对齐项目约定的测试接口,测了也白测。

### S1. 确认接口范围

- **前置**:用户调用 `/write-api`,提供需求(feature-id / spec / 需求名)
- **行为**:按 `references/interface-scope.md` 识别接口范围(用户显式给 > spec 接口章节 > git diff)
- **无论哪种来源,接口清单必须显示给用户确认**——避免 AI 理解偏差测错接口;用户确认后才进 S2
- **拿到接口并用户确认** → 进 S2
- **拿不到** → 报错"未检测到接口范围,请显式给接口清单或确认 spec 接口章节完整"并退出,不生成任何产物

### S2. 生成接口测试规格文档

- **前置**:S1 接口清单已确认
- **行为**:按 `references/接口测试-spec-format.md` 六节结构生成接口测试规格文档;AI 做微服务识别 + 通用接口判断(prompt 见 `references/ai-prompts.md` §S2),结果写入 §1 接口清单的"服务"和"通用"列
- **用户校正**:AI 识别结果在 §1 列出后,用户可在 S3 前校正"服务"和"通用"两列,skill 以校正后为准
- **结果**:落盘 `docs/features/<feature-id>/<文件前缀>-接口测试-spec.md`

### S3. 生成 bruno 测试接口

- **前置**:S2 接口测试规格就绪(含用户校正后的服务/通用标注)
- **行为**:**单次 AI 调用**生成全部 .bru(不拆两阶段、不逐接口循环,见 `references/ai-prompts.md` §S3)
  - .bru 格式 / 断言 / 入参 / docs 段 → `references/bru-format.md`
  - 落盘路径 / 按需求隔离 / 根级 bruno.json → `references/collection-layout.md`
  - 使用 db-query skill 获取基于数据库的测试数据
  - 拿不到真实数据时 → 留 `{{var}}` 占位 + 接口测试规格 §3 标注"需用户手填"
- **AI 调用失败**(超时/限流)→ 报"AI 增强失败" + 保留 S2 接口测试规格,**不继续 S4**
- **结果**:全部 .bru 落盘到 `<服务>/<需求前缀>/<接口名>/<场景>.bru` + 根级 bruno.json 就绪

### S4. 首次接入环境准备

- **前置**:S3 .bru 已生成
- **行为**:按 `references/environment-setup.md` 检查并准备 bruno collection 基础设施:
  - `bruno.json` 缺失 → 生成
  - `environments/local.bru` 缺失 → 生成三环境骨架 + AI 填 non-secret + secret 留空 + 暂停提示用户填
  - 已存在 → 沿用,**不重写**
- **结果**:基础设施就绪,用户可调 `/run-api-test` 跑测试

## 工作流结束

S4 完成后 skill 结束。**不跑 bru run、不核实 DB、不出报告**。

产物:
- `docs/features/<feature-id>/<文件前缀>-接口测试-spec.md`(接口测试规格)
- `docs/bruno/<服务>/<文件前缀>/<接口名>/<场景>.bru`(测试接口,按需求隔离)
- `docs/bruno/bruno.json` + `docs/bruno/environments/*.bru`(首次接入生成)

## 异常速查

| 场景 | 行为 |
|---|---|
| 无新增接口 | 报错退出,不生成空产物 |
| 接口范围三种来源都拿不到 | 报错退出 |
| AI 拿不到真实测试数据 | 留 `{{var}}` 占位 + 接口测试规格标注"需用户手填",继续跑能跑的部分 |
| AI 调用失败 | 报"AI 增强失败" + 保留接口测试规格,不继续 S4 |
| 同需求重复触发 write-api | 覆盖该需求的 .bru + 覆盖接口测试规格(数据从当前需求 spec + DB 重新取) |
| 跨需求同接口同场景 | 各需求独立保留,不覆盖(分别在自己需求目录下) |
| 项目首次接入 | 自动创建 `docs/bruno/` + bruno.json + environments/ |
| env 文件缺失 | S4 生成骨架 + AI 填 non-secret + 暂停提示用户填 secret |

详细异常边界参考对应 reference 文件。

## 质量检查

跑完后自检:
- 接口测试规格文档落盘 feature 目录,六节齐全
- .bru 按 `<服务>/<需求前缀>/<接口名>/<场景>.bru` 组织,无 `collection.bru`
- 根级 `bruno.json` 存在;首次接入时 `environments/` + 三环境 .bru 生成,secret 留空
- .bru 用旧版 tests 语法(`test("name", function() { res.getStatus()/res.getBody()... })`),无 `assert` 段、无 `function onResponse`
- .bru 的 docs 段含业务说明(关联需求由目录层级表达,docs 段不写关联需求列表)
- 入参写真实值,变量化只用于环境级 / 前置动态 / 拿不到时占位
- header 名 / `{{var}}` 变量名大小写与项目既有 .bru 对齐
- 接口路径 / 参数形态 / 错误码断言符合 `docs/guides/interface-standards.md`(用户豁免规范的除外)
- 无程序化配置文件(`.services.yml` / `.config.yml`)
- **工作流停在 S4,没跑 bru run,没核实 DB,没出报告**

## 收尾

提示用户:
1. 接口测试规格位置(`<文件前缀>-接口测试-spec.md`)
2. .bru collection 位置(`docs/bruno/<服务>/<文件前缀>/<接口名>/`)
3. 首次接入:bruno.json + environments/*.bru 已生成,需填 `local.bru` 的 secret 变量
4. 下一步:**跑 `/run-api-test` 跑测试 + 核实 DB + 出报告**

不主动调用 `/run-api-test` 或其他下游 skill。不写 knowledge 文件。不修改 spec / plan / 代码 / .bru。
