# S4 bruno 环境配置规范

## 文件位置与格式

```
docs/bruno/environments/
├── local.bru          # 本地环境(默认)
├── staging.bru        # 测试环境
└── production.bru     # 生产环境
```

每个 .bru 是 bruno 原生运行时格式,`vars { ... }` 段:

```
vars {
    <服务名或baseUrl>: http://127.0.0.1:<端口>
    <非敏感业务变量>: <值>
    <鉴权变量1>:
    <鉴权变量2>:
}
```

环境名固定三档,英文:`local` / `staging` / `production`(避免命令行传中文编码问题)。

## 首次接入生成逻辑

`docs/bruno/environments/local.bru` 不存在时,skill 生成三个 .bru 文件骨架,然后:

### non-secret 变量(AI 填)

AI 扫项目配置(pom.xml / package.json / application.yml / go.mod 等)探明端口,填入 `local.bru`:
- 服务的地址变量(如 `so-assist: http://127.0.0.1:8087`)
- region、租户等非敏感业务变量

`staging.bru` / `production.bru` 的 non-secret **留空**,提示用户填(避免 AI 瞎猜外部环境地址)。

### secret 变量(AI 决定字段名,值留空)

AI 看项目既有 .bru 的**鉴权 header 名**决定有哪些 secret 字段:

- 若既有 .bru 用 `accesstoken` / `staffcode` / `regionid` → secret 字段就是这些名
- 若既有 .bru 用 `Authorization` / `X-API-Key` → secret 字段就是 `Authorization` / `xApiKey`
- 不固定 hx 的字段名,其他项目不同

**值留空**,字段加 `secret: true`(bruno-environment 格式支持;bruno 原生 .bru 格式无 secret 标记,值留空即可,bruno app 里手动标 secret)。

### 生成后暂停

skill 暂停提示用户:

```
环境配置已生成骨架:
- docs/bruno/environments/local.bru(non-secret 已填,secret 留空)
- docs/bruno/environments/staging.bru(全空)
- docs/bruno/environments/production.bru(全空)

请填 local.bru 的 secret 变量(staffcode/accesstoken 等),填完回车继续。
```

不直接结束,等用户填完回车。

## 已存在不覆盖

`docs/bruno/environments/local.bru` 已存在 → 沿用,**不重写**。

理由:用户可能已经手动调过端口或 secret,重写会覆盖用户配置。

## 环境切换

- 默认 `local`
- 用户调用 `/run-api-test --env staging` 切换,透传 `bru run --env staging`
- write-api 阶段不跑 bru run,所以 write-api 不关心环境切换;环境切换是 `/run-api-test` 的事

## 不自动生成 secret 的理由

**为什么 secret 不自动填值**:AI 不应该接触真实 token / 密码 / API key——
1. 避免泄露,skill 资产或日志可能记录
2. AI 无法知道真实值(这些值通常是用户从浏览器、运维系统手动取的)
3. 让用户明确填一次,后续 `environments/local.bru` 沿用,不需要每次跑都填

## 模板示例(参考,不照搬)

hx 项目 local.bru 示例(变量名 + 值都是 hx 特定,AI 生成时按目标项目实际探明,**不套此模板**):

```
vars {
    so-assist: http://127.0.0.1:8087
    regionid: 8323300
    staffcode:
    accesstoken:
}
```

其他项目可能长这样(AI 按 zq 项目探明):

```
vars {
    baseUrl: http://127.0.0.1:8080
    zqassis: http://127.0.0.1:8080
    Authorization:
    xApiKey:
}
```

变量名和端口都从项目实际探明,不预设。
