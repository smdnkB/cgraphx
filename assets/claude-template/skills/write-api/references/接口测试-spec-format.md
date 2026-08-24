# S2 接口测试规格文档格式规范

## 六节结构(必须完整)

接口测试规格文档 `<文件前缀>-接口测试-spec.md` 必须含以下六节,顺序固定:

### §1. 接口清单

```markdown
## 1. 接口清单

| 方法 | 路径 | handler | 服务 | 通用 | 是否写接口 |
|---|---|---|---|---|---|
| GET | /api/v1/users/:id | UserController.getUser | user-service | no | 否 |
| POST | /api/v1/users | UserController.create | user-service | no | 是 |
| POST | /api/v1/auth/login | AuthController.login | - | yes | 是 |
```

- **服务**列:由 AI 在 S2 判断(见 `ai-prompts.md` §S2 微服务识别),无服务划分时填 `-` 或 `(无)`
- **通用**列:由 AI 在 S2 判断(见 `ai-prompts.md` §S2 通用接口判断),值为 `yes` / `no`
- 用户可在 S3 前手动校正这两列,skill 以校正后为准

### §2. 测试场景

每个接口列正常 / 边界 / 异常场景:

```markdown
### GET /api/v1/users/:id
- 正常场景:存在 id,返回 200 + 用户详情
- 边界场景:id 不存在,返回 404
- 异常场景:id 格式非法,返回 400
```

### §3. 测试数据

按场景列参数,标注获取方式(代码提取 / DB 查询 / AI 推断 / 用户手填):

```markdown
### GET /api/v1/users/:id
| 场景 | 参数 | 值 | 获取方式 |
|---|---|---|---|
| 正常 | id | 12345 | DB 查询(users 表取已有 id) |
| 不存在 | id | 999999 | AI 推断 |
```

- 标"用户手填"的参数:在 .bru 里留 `{{var}}` 占位,跑前需用户填
- 获取方式决定 S3 生成 .bru 时参数从哪取

### §4. 数据获取方式

汇总本 feature 测试数据来源 + 指明哪些需用户确认 / 补充 + 降级说明:

```markdown
本 feature 测试数据来源:
- 代码提取:从 handler 源码拿默认值、必填项、参数类型
- DB 查询:通过 db-query skill 查 users 表取真实 id;查 inst_attr 表取真实 attr_id
- AI 推断:组装符合校验规则的测试值(手机号、邮箱格式等)
- 用户手填:以下参数需用户在跑前确认或补充:
  - {{token}}:登录 token
  - {{admin_user_id}}:管理员用户 id

降级说明(仅在降级时填,正常情况删):
- 未配置 db-query:S3 留 {{var}} 占位,S6 DB 核实标"无法核实"
```

### §5. 接口映射

场景 → 接口 → .bru 文件路径,路径指向 `docs/bruno/` 下的实际位置:

```markdown
| 场景 | 接口 | .bru 文件路径 |
|---|---|---|
| GET /api/v1/users/:id 正常 | GET /api/v1/users/:id | docs/bruno/user-service/<文件前缀>/getUser/正常.bru |
| POST /api/v1/users 缺必填 | POST /api/v1/users | docs/bruno/user-service/<文件前缀>/createUser/缺name.bru |
| POST /api/v1/auth/login 正常 | POST /api/v1/auth/login | docs/bruno/common/login/正常.bru |
```

- 路径规则见 `collection-layout.md`
- 此映射是下游 `/run-api-test` R1 拿 .bru 清单的来源,必须写全

### §6. 验收口径

明确什么算通过、什么不算:

```markdown
通过:
- 查询接口:HTTP 200 + 断言通(响应体关键字段符合预期)
- 写接口:HTTP 2xx + 断言通 + DB 核实通(数据真的写了/改了/删了,字段值正确)
- 通用接口:同查询/写接口规则

不算通过:
- HTTP 200 但断言失败 → 失败-断言
- HTTP 200 + 断言通但 DB 数据错 → 失败-DB副作用
- 4xx / 5xx → 失败-HTTP
- 超时 / connection refused(服务就绪后)→ 失败-连接
```

## 模板

完整填充示例见 `assets/template-接口测试-spec.md`,AI 生成时以它为骨架填充。

## 与下游 skill 的契约

- §1 的"服务"和"通用"列 → 驱动 S3 .bru 落盘路径(见 `collection-layout.md`)
- §3 的获取方式 → 驱动 S3 参数填充策略(见 `bru-format.md` 入参规则)
- §5 的映射 → 下游 `/run-api-test` R1 拿 .bru 清单的来源,必须与实际 .bru 文件一一对应(否则 `/run-api-test` 会报"对应 .bru 缺失")
- §4 的降级说明 → 让用户和下游 skill 知道哪些核实会降级
