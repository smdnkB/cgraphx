# R5 接口测试报告规范

## 产物(两类)

| 产物 | 路径 | 用途 |
|---|---|---|
| Markdown 报告 | `docs/features/<feature-id>/<文件前缀>-接口测试报告.md` | 给人看:汇总 + 逐场景详细结果 + 失败汇总 + DB 核实小结 + 下一步建议 |
| JSONL 验证记录 | `docs/features/<feature-id>/<文件前缀>-接口测试验证.jsonl` | AI 逐接口 DB 验证记录,供下游 skill 程序化处理 |

**JSON 中间结果**(R3 `bru run --output` 产的)临时,**不归档**——跑完即丢。

## 报告归属规则

**报告永远归用户触发时指定的需求目录**,即使测试涉及的接口关联多个 feature,也不混到其他 feature。

例:接口 `qryCrm2ProductDetail` 关联需求 A + B;用户指定测需求 B → 报告归 `docs/features/B/`;即使该接口的 .bru 数据可能是 A 时生成的。

## Markdown 报告章节

完整骨架见 `assets/template-接口测试报告.md`。AI 生成时按以下章节填:

### §1. 汇总

| 指标 | 值 |
|---|---|
| 总场景数 | N |
| 通过 | N |
| 失败 | N |
| 跳过 | N |
| 总耗时 | ms |
| 通过率 | % |

### §2. 逐接口结果 ⭐ 核心

按接口聚合展示，每个接口包含:

1. **接口头**: 方法 + 路径 + 状态 + 场景数 + 总耗时
2. **场景摘要**: 所有场景一行一个（状态 + 耗时 + 展示级别）
3. **场景详情**: 仅详细展示的场景（见下方"展示级别判定规则"）

#### 展示级别判定规则

| 场景类型 | 展示级别 | 说明 |
|---|---|---|
| **主场景（正常流程）** | **详细** | 核心业务路径，必须详细记录 |
| **涉及业务规则的异常/边界** | **详细** | 如：库存不足、余额不足、状态机流转等 |
| **简单边界（空值/格式错误/越权）** | **简单** | 如：必填字段缺失、格式非法、无权限等 |
| **失败场景** | **详细** | 无论类型，失败场景必须详细展示 |

**约束**: 一个接口最多 2 个详细展示的场景。

#### 场景摘要格式（简单展示）

```markdown
#### 场景摘要

| 场景 | 状态 | 耗时 | 展示级别 |
|---|---|---|---|
| 正常查询 | ✅ 通过 | 120 ms | **详细** |
| id 不存在 | ✅ 通过 | 110 ms | 简单 |
| id 格式非法 | ✅ 通过 | 115 ms | 简单 |
```

#### 场景详情格式（详细展示）

包含：场景头 + 入参 + 请求 + 响应 + 断言判定 + DB 核实 + 失败分析（仅失败）

### §3. 失败汇总

| 状态 | 数量 | 接口 |
|---|---|---|
| 失败-DB副作用 | N | 接口名 |
| 失败-断言 | N | 接口名 |
| 失败-HTTP | N | 接口名 |
| **合计** | **N** | |

### §4. 写接口 DB 核实小结

| 接口 | 场景 | 结论 | 查询表 | 预期 | 实际 | 差异 |
|---|---|---|---|---|---|---|

仅在本次有写接口时填。

### §5. 下一步建议

按失败类型给建议，不自动调下游 skill:

- 失败-DB副作用 → 疑似代码 bug，走 `/implementation`
- 失败-断言 → 确认是代码 bug 还是断言写错
- 失败-HTTP → 确认路由注册

### §6. 产物清单

固定四项:接口测试规格、.bru collection、Markdown 报告(本文件)、JSONL 验证记录。

## JSONL 字段

每行一个 JSON，逐接口(每场景)一条。字段:

| 字段 | 类型 | 说明 |
|---|---|---|
| `interface` | string | 方法 + 路径(如 `GET /api/v1/users/:id`) |
| `scenario` | string | 场景名(如 `正常查询` / `缺prodInstId`) |
| `http_status` | number | HTTP 状态码 |
| `request` | object | {method, url, headers, body} |
| `response` | object | {status, headers, body} |
| `assertions` | array | 断言结果:[{name, passed, expected, actual}] |
| `db_verification` | object | {required: bool, conclusion: "通过"/"失败"/"无法核实"/"not_required", queries: [], expected, actual, error} |
| `final_status` | string | 状态枚举(见下方) |
| `duration_ms` | number | 耗时 |

查询接口 `db_verification.required = false, conclusion = "not_required"`。

完整示例见 `assets/template-接口测试验证.jsonl`。

## 状态枚举

报告 §2 / §3 / JSONL `final_status` 必须用以下枚举值:

| 状态 | 含义 |
|---|---|
| `通过` | HTTP 通 + 断言通 + (写接口)DB 核实通 |
| `失败-断言` | HTTP 通但断言失败 |
| `失败-DB副作用` | HTTP 通 + 断言通，但 DB 数据不符合预期 |
| `失败-HTTP` | 4xx / 5xx |
| `失败-连接` | 超时 / connection refused(仅在服务就绪后仍失败时记) |
| `跳过` | skill 主动跳过(如 .bru 缺失、环境降级) |

**服务未就绪导致的暂停不记入报告，不算失败**(服务未起时 skill 在 R2 暂停，根本没进 R3)。

## JSON 中间结果处理

R3 的 `bru run --output <path>` 产的 JSON:

- 跑完 R3 后，R4 / R5 读它做核实和汇总
- R5 完成后**立即丢弃**(skill 删除临时文件，或放系统临时目录自动清理)
- 不归档到 `docs/features/<feature-id>/`

理由:JSON 是 bruno 的原始执行记录，字段多且对用户不友好；最终给用户看的是 Markdown 报告 + JSONL 验证记录。保留 JSON 会造成"两份真相"混淆。
