---
name: run-api-test
description: 在 write-api 生成 .bru 后,跑接口测试 + 核实写接口 DB 副作用 + 出报告。触发时由用户指定需求或接口:指定需求→跑该需求所有接口所有场景,报告归该需求目录;只指定接口→主动问测哪个需求(AI 扫 docs/bruno/ 下哪些需求测过该接口,让用户选);都没指定→主动问。服务未就绪暂停等待;写接口必须查 DB 验数据(HTTP 200 ≠ 通过);失败只报告不修代码不重跑,交用户决定。不调 write-api / write-api-doc,不改 .bru。Use when 用户要求跑接口测试 / 验证接口 / 测一下需求 X 的接口 / 跑下这个接口;write-api 跑完后用户要求执行测试;代码改完后用户想验证修复。
---

# Run API Test

## 定位

打靶 skill:在 `write-api` 生成 `.bru` 之后,跑接口测试 + 核实写接口 DB 副作用 + 出报告。不改 .bru、不修代码、不重跑,失败交用户决定。

`write-api` 负责"造弹药",`run-api-test` 负责"打靶"。两者独立,同一份 .bru 可被多次复用(调整代码或断言后重跑)。

## HARD-GATE

- **服务未就绪不盲跑** — 本地服务未起时暂停等待,不把 connection refused 当失败记入报告
- **写接口必须核实 DB 副作用** — HTTP 200 ≠ 测试通过,POST/PUT/DELETE/PATCH 必须由 AI 用 `db-query skill` 查 DB 验数据
- **env 文件不自动生成** — `docs/bruno/environments/local.bru` 缺失时报错退出,提示用户先跑 `/write-api`,不自己生成
- **报告永远归一个 feature 目录** — 即使测试涉及的接口关联多个 feature,报告归用户触发时指定的需求目录,不混

## Trigger

**使用此 skill 当**:
- 用户完成 `/write-api` 后,要求"跑接口测试""跑一下测试""验证接口"
- 用户说"run-api-test""测一下需求 X 的接口""跑下这个接口"
- 代码改完后,用户想重跑接口测试验证修复

**不要使用此 skill 当**:
- 生成测试接口 → 用 `/write-api`(本 skill 假设 .bru 已存在)
- 写 HTML 接口文档 → 用 `/write-api-doc`
- 修代码 / 改 .bru → 用户手动或走 `/implementation`(本 skill 只测不修)
- 探索陌生项目 → 用 `/code-impact-init`
- 查代码调用关系 → 用 grep / Read

## 与既有 skill 边界

| skill | 关系 | 说明 |
|---|---|---|
| `write-api` | 上游 | 产 .bru + 测试规格 + environments;本 skill 消费这些产物跑测试,不调它也不改 .bru |
| `write-api-doc` | 独立并列 | 不互相调用;本 skill 产测试报告 + JSONL,write-api-doc 产 HTML 接口文档 |
| `db-query` | 复用 | R4 核实写接口 DB 副作用;受 db-query 既有只读约束 |
| `implementation` / `subagent-implement` | 下游 | 测试失败后由用户决定是否调起修 bug |
| `write-design-doc` | 独立 | 发布后按需产设计文档 |

## 依赖

- `.bru` 文件已存在(由 `/write-api` 生成,在 `docs/bruno/<服务>/<需求前缀>/<接口名>/<场景>.bru` 或 `docs/bruno/common/<接口名>/<场景>.bru`)
- `docs/bruno/environments/local.bru` 存在(不存在时报错退出,提示先跑 `/write-api`)
- 本地服务可启动(若需手动启动,R2 暂停等待)
- 项目已配置 db-query profile(R4 核实写接口副作用用)—— 未配置则 R4 降级,见 `references/db-verification.md`

## feature-id 与文件前缀规则

复用既有规则(同 `/write-prd` / `/write-spec` / `/write-plan` / `/write-api-doc` / `/write-api` 的算法):

- feature-id 格式:`YYYY-MM-DD-[业务ID-]<标题>`
- 文件前缀:有业务ID = `<业务ID>-<标题>`,无业务ID = `<标题>`
- 文件名不得包含 `/`、`:`、`*`、`?`、`"`、`<`、`>`、`|`

产物文件名(归用户指定的 feature 目录):
- Markdown 报告:`docs/features/<feature-id>/<文件前缀>-测试报告.md`
- JSONL 验证记录:`docs/features/<feature-id>/<文件前缀>-测试验证.jsonl`

格式见 `references/report-format.md`。

## 触发逻辑(用户给的是什么?)

这是本 skill 的核心,直接写在 SKILL.md(不抽 reference),因为这是流程编排不是规范细节。

```
用户触发 /run-api-test
      ↓
用户给的是什么?
      ├─ 指定了需求(feature-id / spec / 需求名)
      │   → AI 查该需求的 <文件前缀>-api-spec.md,拿到接口清单 + 场景
      │   → 提示用户确认"本次测试需求 X,涉及 N 接口 M 场景,确认?"
      │   → 用户确认后进入 R1
      │
      ├─ 只指定了接口(接口名/路径)
      │   → skill 主动问"测哪个需求?"
      │   → AI 扫 docs/bruno/<服务>*/<需求前缀>/<接口名>/ 哪些存在,列出测过该接口的需求
      │   → 列出来让用户选(若 0 个需求,提示用户先跑 /write-api)
      │   → 选定后,AI 查该需求 api-spec.md 拿该接口的场景
      │   → 提示用户确认后进入 R1
      │
      └─ 都没指定
          → skill 主动问"请指定需求(feature-id/spec)或接口名"
          → 拿到回答后回到上面两条分支
```

**关键约束**:
- 不管走哪条分支,最终都要锁定一个 feature-id,**报告归该 feature 目录**
- AI 扫目录反查指定接口关联哪些需求时,读 `docs/bruno/<服务>*/<需求前缀>/<接口名>/` 哪些存在(无需读 .bru docs 段,目录层级已表达归属)
- 用户确认环节不能省 —— AI 理解的范围必须显示给用户,避免跑错需求或接口

## 工作流

按 R1-R5 顺序执行,每步规范细节在对应 reference 文件。

### R1. 确定测试范围

- **前置**:触发逻辑锁定一个 feature-id
- **行为**:按 `references/test-scope.md` 拿到本次测试的 .bru 清单
  - 查 `<文件前缀>-api-spec.md` 拿接口清单 + 场景 + .bru 路径
  - 交叉校验 .bru 文件实际存在
  - 显示测试范围给用户确认
- **校验失败**(api-spec 不存在 / .bru 缺失)→ 报错并退出
- **用户取消** → 退出
- **结果**:得到本次跑的 .bru 清单

### R2. 本地服务就绪处理

- **前置**:R1 测试范围已确认
- **行为**:按 `references/service-readiness.md` 做服务就绪检测(两种 TCP 策略,任一通过即就绪)
- **env 文件缺失** → 报错退出,提示先跑 `/write-api`(本 skill 不生成 env)
- **服务未就绪** → 暂停提示用户启动,等待回车;不盲跑、不重试
- **就绪** → 继续 R3

### R3. 跑测试

- **前置**:服务就绪 + env 就绪
- **行为**:按 `references/bru-run.md` 调用 `bru run` 跑 R1 清单涉及的接口目录
- **bru run 整体崩溃** → 报"测试执行器异常" + 输出 stderr,**不继续 R4**
- **结果**:得到每接口每场景的 HTTP 状态、响应体、断言通过情况

### R4. 数据库副作用核实

- **前置**:R3 完成
- **跳过条件**:R1 清单无写接口(全 GET)→ 跳过本步直接 R5
- **行为**:按 `references/db-verification.md`,AI 用 `db-query skill` 逐写接口核实副作用
- **db-query skill 失败** → 该接口记"无法核实" + 状态 `失败-DB副作用`,**不阻塞其他接口**
- **结果**:逐接口 DB 核实记录写入 JSONL

### R5. 产出测试报告

- **前置**:R3 + R4 完成
- **行为**:按 `references/report-format.md` 汇总产出
  - Markdown 报告 `<文件前缀>-测试报告.md`(汇总 + 逐接口结果 + 失败分类 + DB 核实小结 + 下一步建议)
    - **按接口聚合**:同接口的场景先展示摘要，再展示详情
    - **展示级别**:主场景/涉及业务规则的异常=详细展示；简单边界=简单展示；失败场景=必须详细展示
    - **约束**:一个接口最多 2 个详细展示的场景
  - JSONL `<文件前缀>-测试验证.jsonl`(R4 写接口记录 + R5 补齐查询接口记录)
  - JSON 中间结果丢弃
- **报告归属**:归用户指定的 feature 目录,即使接口关联多 feature 也不混
- **结果**:报告落盘;skill 结束

## 异常速查

| 场景 | 行为 |
|---|---|
| 用户指定需求但 api-spec 不存在 | 报"需求 X 无测试规格,请先跑 /write-api"并退出 |
| 用户指定接口但 .bru 不存在 | 报"接口 Y 无 .bru,请先跑 /write-api"并退出 |
| 用户指定接口但扫目录发现 0 个需求测过 | 提示"未在 docs/bruno/ 下找到测过接口 Y 的需求,请先跑 /write-api" |
| api-spec §5 列出的 .bru 实际不存在 | 报"需求 X 接口 Y 场景 Z 的 .bru 缺失,请先跑 /write-api"并退出 |
| 本地服务未启动 | 暂停 + 提示用户启动,等待回车继续 |
| env 文件缺失 | 报"环境缺失,请先跑 /write-api"并退出,不自动生成 |
| 服务起了但接口 404 | 记 `失败-HTTP`,标注可能路由未注册或路径不对 |
| 写接口 HTTP 通但 DB 没改 | 记 `失败-DB副作用`,AI 标注预期 vs 实际差异 |
| bru run 整体崩溃 | 报"测试执行器异常" + 输出 stderr,不继续 R4 |
| 同 feature 重复触发 | 覆盖该 feature 报告 + JSONL,不增量合并 |
| db-query 在 R4 失败 | 该接口记"无法核实" + 状态 `失败-DB副作用`,不阻塞其他接口 |
| 用户改代码后重跑 | 直接重跑 `/run-api-test` 覆盖报告;只有需重新生成 .bru 入参时才走 `/write-api` |

## 质量检查

跑完后自检:
- 报告归指定的 feature 目录(`<文件前缀>-测试报告.md` + `<文件前缀>-测试验证.jsonl`)
- 写接口 DB 核实到位,不存在"只看 HTTP 200 就算过"的写接口
- 服务未就绪时没盲跑,没产 connection refused 失败报告
- 失败接口有原因分类(数据问题 / 代码 bug / 服务问题 / 断言过严)
- 不改 .bru(跑前后 .bru 内容一致)
- 不自动修代码、不自动重跑
- env 文件缺失时报错退出,没自己生成
- JSON 中间结果已丢弃,不归档
- 用户确认环节有执行(测试范围显示给用户)

## 收尾

提示用户:
1. 测试报告位置(`<文件前缀>-测试报告.md`)
2. 通过 / 失败 / 跳过汇总
3. 失败接口清单 + 原因分类
4. 下一步建议:
   - 失败-DB副作用 → 走 `/implementation` 修,修完重跑 `/run-api-test`
   - 失败-断言 → 确认是代码 bug 还是断言写错
   - 失败-HTTP → 确认路由注册
   - 需重新生成 .bru 入参 → 走 `/write-api` 再跑 `/run-api-test`

不主动调用 `/implementation` 或其他下游 skill。不写 knowledge 文件。不修改 spec / plan / 代码 / .bru。
