# R2 服务就绪检测规范

## 两种检测策略(任一通过即就绪)

按以下优先级检测,**任一通过即视为就绪**:

1. **测试规格声明的服务地址** — `<文件前缀>-api-spec.md` §1 接口清单声明的"服务地址"(由 write-api S2 生成)能 TCP 连通
2. **bruno env 的 baseUrl** — `docs/bruno/environments/local.bru` 里的 `baseUrl`(或对应服务端口变量)能 TCP 连通

两者都失败 → 视为未就绪,进入暂停等待。

## TCP 连通超时

默认 **3 秒**。

理由:本地服务通常毫秒级响应;3 秒连不上基本就是没启动。超时阈值不要太长,避免用户等太久才发现服务没起。

## env 文件缺失处理

`docs/bruno/environments/local.bru` 不存在 → **报错退出,不自动生成**。

报错信息:

```
环境配置缺失:docs/bruno/environments/local.bru 不存在。
本 skill(run-api-test)不负责生成环境配置,请先跑 /write-api 生成骨架并填好 secret。
```

**为什么不自动生成**:环境配置(尤其 secret 字段如 token、staffcode)属于 write-api 的职责范围;run-api-test 自动生成会越界,且 AI 无法知道用户实际的 token 值。

## 服务未就绪处理

检测失败 → skill 暂停,提示:

```
本地服务未就绪(TCP 连接失败)。
请启动本地服务后回车继续,或 Ctrl+C 取消。
```

**不**自动重试、**不**自动跳过、**不**把 connection refused 当失败记入报告。

**为什么这样设计**:
- 自动重试 → 服务起不来时 skill 卡死循环
- 自动跳过 → 跑出大量假失败,污染报告
- 当失败记入 → 报告失真,看不出是真接口问题还是服务没起

服务就绪后用户回车,继续 R3。

## 就绪后继续

任一策略 TCP 连通 → 视为就绪,继续 R3 跑测试。

## 环境切换

默认 `local` 环境(用 `environments/local.bru`)。

用户调用 `/run-api-test --env staging` 或 `--env production` 时:
- 透传给 `bru run --env staging` / `--env production`
- 服务就绪检测改读对应环境的 `baseUrl` 变量

切换环境不影响 .bru 清单(R1 已锁定),只影响 env 变量注入。
