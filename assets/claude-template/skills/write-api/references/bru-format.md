# S3 .bru 文件格式规范

## 各段结构(必须含)

每个 .bru 符合 bruno-lang v2 语法,段顺序固定:

```
meta {
    name: <场景名,如 正常 / 缺prodInstId / 产品不存在>
    type: http
}

# HTTP 方法段:get / post / put / delete / patch
get {
    url: {{baseUrl}}/api/v1/users/:id
    body: none
}

# 写接口示例:
# post {
#     url: {{baseUrl}}/api/v1/users
#     body: json
# }

params:query {
    # 查询参数,写真实值
}

params:path {
    # 路径参数,写真实值(如 id: 12345)
    # 唯一例外:前置接口动态传递的值用 {{var}}
    id: 12345
}

headers {
    Content-Type: application/json
    # 鉴权 header 由 AI 按项目既有 .bru + environments/local.bru 的变量名对齐后追加
    # 不同项目鉴权方式不同(accesstoken/staffcode/regionid 或 Authorization/X-API-Key 等)
    # 不在此硬编码示例,避免 AI 套模板
}

# 写接口的请求体(查询接口删此段):
# 入参写真实值,不变量化
# body:json {
#     {
#         "name": "测试用户",
#         "email": "test@example.com"
#     }
# }

tests {
    # 用旧版 tests 语法(见下方"断言语法")
}

docs {
    # 见下方"docs 段写法"
    业务说明: <一句话>
}
```

## 断言语法(必须用旧版)

**必须用** `test("name", function() { ... })` + `res.getStatus()` / `res.getBody()` 旧版语法——这是项目既有 bruno 版本支持的写法,新版语法 `function onResponse(request, response)` 不认。

**不要用** `assert { ... }` 段——项目 bruno 版本可能不支持,断言全放 `tests` 段。

断言内容:

```bru
tests {
    test("HTTP 200", function() {
        expect(res.getStatus()).to.equal(200);
    });

    test("响应体关键字段", function() {
        const body = JSON.parse(res.getBody());
        expect(body.code).to.equal(0);
        expect(body.data).to.exist;
    });

    # 写接口额外写 DB 副作用预期注释,供下游 /run-api-test 的 R4 AI 核实参考:
    # DB 预期:users 表新增一行,name=测试用户,email=test@example.com
    # DB 鄄期:user_profile 表同步新增一行,user_id=本次返回的 id
}
```

### 断言内容要求

- **HTTP 状态码断言** — 每个场景都要(正常场景通常 200/201,异常场景可能 400/404/409)
- **响应体关键字段断言** — 从 spec 接口语义或代码返回结构提取,用 `JSON.parse(res.getBody())` 取 body
- **写接口额外写 DB 副作用预期注释** — 用 `#` 注释,写预期会写/改/删哪些表哪些字段,供 `/run-api-test` R4 AI 核实参考

## 入参写真实值,不变量化

接口入参(如 `prodInstId`)优先写 AI 从 DB 查到或代码推断的**真实值**,直接写死在 `body:json` / `params` 段里。

**不变量化的理由**:入参是测试数据,每次跑测试应该用具体值才能稳定复现;变量化只用于"跨环境或跨接口的动态值"。

`{{var}}` 占位**只在以下三种情况使用**:

| 场景 | 说明 |
|---|---|
| 环境级变量 | `baseUrl`、服务端口、鉴权凭据等 → 写在 `environments/local.bru` 里,.bru 用 `{{var}}` 引用 |
| 前置接口动态传递 | 登录 token、前接口返回 id 等 → 用 `vars:post-response` 段提取,.bru 用 `{{var}}` 引用 |
| AI 拿不到真实值 | DB 无数据、代码无可推断默认值时 → 留 `{{var}}` 占位 + 测试规格 §3 标注"需用户手填" |

第 3 种情况发生时,在测试规格 §3 标注哪些参数需用户手填,skill 继续跑能跑的部分,不因此中断。

## docs 段写法

```
docs {
    业务说明: <一句话,从 Javadoc 或 spec 提取;提取不到占位"(scan 阶段未提取到 Javadoc,请补充业务说明)">
}
```

- 仅业务说明一句,不写关联需求列表(关联需求由 .bru 所在的 `<服务>/<需求前缀>/<接口名>/` 目录层级表达,扫目录即可知)
- 不在 docs 段写断言推理 / 场景预期等详细内容(简短,bruno 不渲染 markdown)

### 为什么 docs 段不写关联需求

之前 docs 段含"关联需求"列表,是为让 `/run-api-test` 在"只指定接口"时反查接口关联哪些需求。现在 .bru 落盘路径含需求层(`<服务>/<需求前缀>/<接口名>/`),反查需求只需扫 `docs/bruno/<服务>*/<需求前缀>/<接口名>/` 哪些存在即可,无需 docs 段冗余维护。

## header 名 / 变量名对齐

AI 生成 headers 段时,必须先看项目既有 .bru 的 header 名和 `{{var}}` 变量名大小写(如 `accesstoken` vs `accessToken`),避免大小写漂移导致 env 注入失败。

不同项目鉴权方式不同:

| 项目示例 | 鉴权 header |
|---|---|
| hx 项目 | `accesstoken` / `staffcode` / `regionid`(全小写) |
| 其他项目 | 可能是 `Authorization: Bearer xxx` / `X-API-Key: xxx` 等 |

AI 按目标项目实际探明,不套任何模板示例。

## 模板

完整骨架见 `assets/template-request.bru`。
