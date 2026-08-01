---
name: write-api-doc
disable-model-invocation: true
description: 在 feature 接口开发完毕后(可选环节),从 spec 的接口章节 + 实际代码反向提取,生成静态只读 HTML 接口文档,默认输出到 docs/features/<feature-id>/<文件前缀>-接口文档.html。覆盖本次 feature 新增的接口(严格新增,不含修改),支持 Node/Python/Java/Go/Rust/C#/PHP/Ruby 主流 web 框架。不做交互式 Swagger、不重新定义 spec。
---

# Write API Doc

## 定位

把 feature 实际落地的新增接口,整理成**静态只读 HTML 接口文档**,作为事后技术沉淀归档到 feature 目录。

接口文档的目标是让后续维护者、对接方、测试、新成员快速看懂本 feature 加了哪些接口、怎么调、返回什么、出错怎么办。接口文档**不重新定义 spec 已锁定的契约**,只是事实沉淀。

<HARD-GATE>
不要重新定义 spec 已锁定的接口契约、参数语义、错误码、权限边界。如果发现 spec 与代码现实不符,标注【待确认】而不是自行解释。
不要编造未在代码或 spec 中体现的接口、参数、响应字段或错误码。
范围严格限定"本次 feature 新增的接口",不得自行扩展到修改的老接口或全项目接口。
只用 grep + Read 查代码;不依赖外部图谱或索引工具。
</HARD-GATE>

## Trigger

使用此 skill 当:

- 用户完成 feature 接口开发后,要求"生成接口文档"、"写 API 文档"、"整理一份 HTML 接口文档"
- 用户说"自测完了,接口文档沉淀一下"、"该写接口文档了"
- 用户要求把 feature 新增的接口整理成可分享的 HTML 文档

不要使用此 skill 当:

- 写 spec(使用 `write-spec` skill,接口文档不重新定义规格契约)
- 写设计文档(使用 `write-design-doc` skill,设计文档覆盖架构/模块/决策,接口文档只覆盖接口)
- 探索陌生项目(使用 `knowledge-init` skill)
- 查询代码调用关系(使用 grep / Read)

## 与 write-design-doc 的边界

| 维度 | write-api-doc | write-design-doc |
|---|---|---|
| 主题 | 仅接口 | 整个 feature 的设计(架构/模块/决策/限制/扩展) |
| 来源 | spec 接口章节 + 代码 | knowledge + spec + plan |
| 产物 | `<前缀>-接口文档.html` | `<前缀>-设计文档.md`(或 .html) |
| 触发时机 | 接口开发完毕即可 | 自测通过后 |
| 关系 | 独立产物,与设计文档并列 | 独立产物,与接口文档并列 |

两个 skill 互不替代;同一个 feature 可以同时产出设计文档和接口文档,各自服务不同读者。

## 依赖

- 当前 feature 目录下有 spec(`docs/features/<feature-id>/<文件前缀>-spec.md`)
- 用户能提供"本次 feature 改动涉及哪些文件或接口前缀"的提示(若不提供,skill 启动时询问)

## feature-id 与文件前缀规则

**feature-id 识别(优先级从高到低)**:

1. 用户调用时显式传 feature-id 或输出路径参数 → 使用用户指定
2. skill 自动从 cwd 向上探测最近的 `docs/features/<feature-id>/` 目录 → 使用探测结果
3. 都失败 → skill 报错并要求用户显式传 feature-id 或输出路径

**文件前缀算法**(与 write-prd / write-spec / write-plan / docgen 一致):

feature-id 格式:`YYYY-MM-DD-[业务ID-]<标题>`

- 有业务ID:文件前缀 = `<业务ID>-<标题>`(如 `CRM-req19230-号百商品详情查询接口`)
- 无业务ID:文件前缀 = `<标题>`(如 `features目录结构调整`)

业务ID 段允许字母数字 + 连字符;标题段允许中文、英文或混合。**不得**对中文做英文 slug 转换。

文件名不得包含 `/`、`:`、`*`、`?`、`"`、`<`、`>`、`|`;若含敏感字符,要求用户重命名,不自动替换。

**默认输出路径**:`docs/features/<feature-id>/<文件前缀>-接口文档.html`

用户可显式参数覆盖默认路径。

## 工作流

在写任何 api-doc 内容前,**必须**先与用户确认两件事:

1. **业务 ID**:本次需求是否有对应的工单号 / 需求单号 / 项目代号?允许留空,但**留空也必须显式确认**(用户明确说"没有/留空"),不得默认跳过。
2. **标题语言**:用中文 / 英文 / 中英混合?由用户选定,**禁止** Agent 因为"目录看起来更整齐"/"和现有 feature 命名一致"/"避免中文路径问题"等原因,擅自把中文需求转成英文 slug。

- 用户主动给过完整 feature-id 或文件名 → 直接复用,跳过本步。
- 用户用 `/write-api-doc` 触发但未给命名决策 → **第一步就问这两个问题**,问完再写。
- 不得"先写 api-doc 内容,命名最后再说"。命名决策必须在内容产出之前落定,否则会在文件名上反复返工。

### 第一步:确认需求与识别 feature-id

向用户确认(如果未明确指定):

1. **feature-id / 输出路径** — 默认按上方规则识别,用户可覆盖
2. **本次 feature 改动涉及哪些文件或接口前缀** — 用于界定"新增接口"的范围
   - 用户可给:文件列表、模块路径、路由前缀(如 `/api/v2/`、`/admin/users`)、handler 函数名等
   - 用户给的越精确,skill 越快锁定
3. **可选:补充章节** — 用户可指定排除某些章节或追加自定义章节

### 第二步:读 spec 拿业务口径

Read `docs/features/<feature-id>/<文件前缀>-spec.md`,重点关注:

- "接口、页面与系统边界"章节 — 拿到本 feature 声明的接口清单、业务输入输出、权限边界、错误语义
- "数据、状态与口径"章节 — 拿到字段语义和状态枚举
- "权限、安全与审计"章节 — 拿到鉴权方式和数据可见性
- "异常与边界场景"章节 — 拿到错误码和异常处理

如果 spec 里没有专门的接口章节,如实记录"spec 未明确接口清单,从代码反向提取"。

### 第三步:grep 找路由注册点

根据用户提示的文件/模块范围,在代码里 grep 路由注册点。下面是常见框架的 grep pattern 库;用户提示的框架优先匹配,其他自适应:

**Node / TypeScript / JavaScript**:
- Express / Fastify / Koa:`app\.(get|post|put|delete|patch)\s*\(`、`router\.(get|post|put|delete|patch)\s*\(`
- NestJS:`@(Get|Post|Put|Delete|Patch)\s*\(`、`@Controller\s*\(`

**Python**:
- FastAPI:`@(app|router)\.(get|post|put|delete|patch)\s*\(`、`@APIRouter\.(get|post|put|delete|patch)`
- Django / DRF:`urlpatterns\s*=`、`path\s*\(`、`re_path\s*\(`、`@action\s*\(`
- Flask:`@(app|bp)\.(route|get|post|put|delete|patch)\s*\(`

**Java / Kotlin**:
- Spring:`@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*\(`、`@RestController\s*(`、`@Controller\s*(`

**Go**:
- Gin:`(r|router|engine)\.(GET|POST|PUT|DELETE|PATCH)\s*\(`、`\.Handle\s*\(`
- Echo:`(e|echo)\.(GET|POST|PUT|DELETE|PATCH)\s*\(`
- net/http:`http\.Handle(Func)?\s*\(`、`mux\.Handle(Func)?\s*\(`

**Rust**:
- Axum:`\.route\s*\(`、`Router::new\(\)`、`#\[(get|post|put|delete|patch)\s*\(`

**C# / .NET**:
- ASP.NET:`\[Http(Get|Post|Put|Delete|Patch)\]`、`\[Route\(`、`\.Map(Get|Post|Put|Delete|Patch)\s*\(`

**PHP**:
- Laravel:`Route::(get|post|put|delete|patch)\s*\(`、`Route::(resource|apiResource)\s*\(`

**Ruby**:
- Rails:`(get|post|put|delete|patch)\s+['"]`、`resources?\s+:`、`match\s+['"]`

**用户提示其他框架**:agent 根据框架文档自适应 grep pattern,在文档里如实标注"非默认覆盖框架,自适应提取"。

### 第四步:筛选"本次 feature 新增"的接口

- 严格只算**新增**(本 feature 新加的路由注册行)
- 修改老接口(原有路由,handler 内部改了实现) **不在范围**
- 删除的接口 **不在范围**
- 判定方式:用户提示 + spec 接口清单对照。spec 声明 + 代码 grep 都命中的优先算新增;只在代码命中但 spec 没声明的,询问用户是否本次新增
- 找到 0 个新增接口 → 见"失败处理"

### 第五步:Read handler 源码,提取字段

对每个新增接口,Read 对应的 handler 函数,提取:

- **方法**:HTTP 方法(GET/POST/PUT/DELETE/PATCH)
- **路径**:完整路由(包括 base path,若可推断)
- **请求参数**:
  - path 参数(从路由模板提取,如 `/users/:id` → `id`)
  - query 参数(从 handler 签名 / 框架注入提取)
  - body 参数(从 DTO / 解构代码 / 类型注解提取)
  - header 参数(从鉴权注入 / 自定义 header 提取)
- **响应示例**:从 return 语句 / 序列化代码 / 类型注解 / spec 错误码推断
- **错误码**:从异常处理 / 抛错代码 / spec 异常章节提取
- **业务说明**:结合 spec 的接口业务口径 + handler 实现的关键逻辑,写一句简述

提取不到的字段:在文档里标注"待补充"或"代码未体现",**不要编造**。

### 第六步:组装 HTML 文档

按"章节结构"组装 HTML,生成单文件独立 HTML(内联 CSS、不依赖外部资源)。生成前阅读 [template-api-html.md](template-api-html.md) 获取完整 CSS 和结构参考。

### 第七步:保存文件并反馈

写入 `docs/features/<feature-id>/<文件前缀>-接口文档.html`。

反馈:
1. 告知用户文件保存位置
2. 列出本次提取的接口总数和清单
3. 列出"提取失败 / 字段不全"的接口,提示用户补充代码注释或 spec
4. 不触发分析(本 skill 只读取 spec + 代码,不写入 `docs/knowledge/`)

## 章节结构

```html
<!DOCTYPE html>
<html>
<head>...</head>
<body>
  <div class="container">
    <!-- 文档头 -->
    <h1>{feature 标题} — 接口文档</h1>
    <p class="meta">feature-id: {feature-id} | 生成日期: YYYY-MM-DD | 接口总数: N</p>

    <!-- 目录 -->
    <nav class="toc">
      <h3>目录</h3>
      <ul>
        <li><a href="#概览">概览</a></li>
        <li><a href="#接口清单">接口清单</a></li>
        <li><a href="#接口详情">接口详情</a>
          <ul>
            <li><a href="#{anchor-1}">{METHOD} {path-1}</a></li>
            <li><a href="#{anchor-2}">{METHOD} {path-2}</a></li>
            ...
          </ul>
        </li>
      </ul>
    </nav>

    <!-- 概览 -->
    <section id="概览">
      <h2>概览</h2>
      <p>本 feature 新增接口的业务背景(从 spec 摘录)。</p>
      <table>
        <tr><th>Base URL</th><td>{若可推断,否则"待补充"}</td></tr>
        <tr><th>鉴权方式</th><td>{若可推断,否则"待补充"}</td></tr>
        <tr><th>主要内容</th><td>{一句话总结}</td></tr>
      </table>
    </section>

    <!-- 接口清单 -->
    <section id="接口清单">
      <h2>接口清单</h2>
      <table class="endpoint-list">
        <thead><tr><th>方法</th><th>路径</th><th>简述</th></tr></thead>
        <tbody>
          <tr><td><span class="api-method get">GET</span></td><td>/api/path</td><td>...</td></tr>
          ...
        </tbody>
      </table>
    </section>

    <!-- 接口详情 -->
    <section id="接口详情">
      <h2>接口详情</h2>

      <section id="{anchor}" class="endpoint">
        <h3><span class="api-method get">GET</span> <code>/api/path/:id</code></h3>
        <p class="endpoint-desc">业务说明...</p>

        <h4>请求参数</h4>
        <table>
          <thead><tr><th>位置</th><th>参数</th><th>类型</th><th>必填</th><th>说明</th></tr></thead>
          <tbody>
            <tr><td>path</td><td>id</td><td>string</td><td>是</td><td>资源 ID</td></tr>
            <tr><td>query</td><td>expand</td><td>boolean</td><td>否</td><td>是否展开关联</td></tr>
            ...
          </tbody>
        </table>

        <h4>响应示例</h4>
        <pre><code class="json">{
  "id": "xxx",
  "name": "xxx"
}</code></pre>

        <h4>错误码</h4>
        <table class="error-table">
          <thead><tr><th>状态码</th><th>含义</th><th>触发场景</th></tr></thead>
          <tbody>
            <tr><td>404</td><td>资源不存在</td><td>id 无效</td></tr>
            ...
          </tbody>
        </table>
      </section>

      ...
    </section>
  </div>
</body>
</html>
```

## 模板

阅读 [template-api-html.md](template-api-html.md) 获取完整 CSS 和结构参考。

模板复用 `template-design-html.md` 的 CSS 变量(`:root` 里的颜色 / 字体 / 间距变量)以保持视觉一致;额外增加 `.api-method`、`.endpoint`、`.endpoint-list`、`.error-table` 等接口文档专用样式。

## 内容来源与改写规则

### 事实性内容必须可溯源

- 接口路径、方法、参数、响应字段:必须来自代码(grep + Read)
- 业务说明、错误语义、权限边界:必须来自 spec 或代码,二者冲突时以 spec 为准并标注【待确认】
- base URL、鉴权方式:可推断时填,不可推断时填"待补充",不编造

### 改写但忠实

- handler 里的代码注释、参数解构、return 语句 → 改写为表格化的请求参数 / 响应示例
- spec 里的业务口径 → 改写为接口的"业务说明"短句
- 不要照贴 handler 源码;不要贴整段 spec 原文

### 不重新定义契约

- 接口文档**不得**改写 spec 已锁定的接口契约、参数语义、错误码
- 发现 spec 与代码冲突时,以 spec 为准;代码明显违背 spec 时,标注【待确认】并提示用户

## 失败处理

| 场景 | skill 响应 |
|---|---|
| 用户未提供文件/接口前缀提示,且无法从上下文推断 | skill 启动时显式询问,不自行猜测 |
| grep 找到 0 个新增路由注册点 | 报错并提示:"未在用户指定范围找到新增接口。请确认范围,或检查路由注册是否用框架默认 pattern 之外的方式" |
| 找到的接口 spec 未声明 | 列出"代码命中但 spec 未声明"的接口清单,询问用户是否本次新增,默认不算 |
| handler 源码字段提取不全 | 在对应字段标"待补充",在反馈里汇总列出 |
| spec 与代码明显冲突 | 在文档对应字段标【待确认】,在反馈里列出冲突清单 |
| 框架不在默认覆盖列表 | agent 自适应 grep pattern,在文档"概览"章节标注"非默认覆盖框架,自适应提取" |

## 收尾方式

输出接口文档后,只提示用户:
1. 文件保存位置
2. 提取的接口清单
3. 字段不全或冲突的待补充清单

不要主动调用 docgen 或其他 skill。不写 knowledge 文件。不修改 spec / plan / 代码。
