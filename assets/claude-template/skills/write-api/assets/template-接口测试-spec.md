# 接口测试规格模板

适用于 feature 编码完成后,由 `write-api` skill 在 S2 生成。默认输出到 `docs/features/<feature-id>/<文件前缀>-接口测试-spec.md`。

本模板由 AI 在 S2 填充:§1 接口清单的"服务"和"通用"列由 AI 判断(见 SKILL.md 的 S2 prompt 指引),用户可在 S3 前手动校正。

## 完整结构

```markdown
# 接口测试规格:<feature 标题>

> feature-id: <feature-id>
> 生成时间: <YYYY-MM-DD HH:MM>
> 关联接口集合: docs/bruno/<服务>/<文件前缀>/

## 1. 接口清单

| 方法 | 路径 | handler | 服务 | 通用 | 是否写接口 |
|---|---|---|---|---|---|
| GET | /api/v1/users/:id | UserController.getUser | user-service | no | 否 |
| POST | /api/v1/users | UserController.create | user-service | no | 是 |
| POST | /api/v1/auth/login | AuthController.login | - | yes | 是 |

- "服务"列由 AI 在 S2 判断(参考 docs/bruno/ 既有目录),无服务划分时填 "-"
- "通用"列由 AI 在 S2 判断(yes 表示放 docs/bruno/common/)
- "是否写接口"决定 S6 是否核实 DB 副作用

## 2. 测试场景

### GET /api/v1/users/:id
- 正常场景:存在 id,返回 200 + 用户详情
- 边界场景:id 不存在,返回 404
- 异常场景:id 格式非法,返回 400

### POST /api/v1/users
- 正常场景:合法参数,返回 201 + 新用户
- 边界场景:必填字段缺失,返回 400
- 异常场景:唯一约束冲突,返回 409

### POST /api/v1/auth/login
- 正常场景:正确账号密码,返回 200 + token
- 异常场景:错误密码,返回 401

## 3. 测试数据

### GET /api/v1/users/:id
| 场景 | 参数 | 值 | 获取方式 |
|---|---|---|---|
| 正常 | id | 12345 | DB 查询(users 表取已有 id) |
| 不存在 | id | 999999 | AI 推断(取不存在的 id) |
| 非法 | id | "abc" | AI 推断 |

### POST /api/v1/users
| 场景 | 参数 | 值 | 获取方式 |
|---|---|---|---|
| 正常 | name | "测试用户" | AI 推断 |
| 正常 | email | "test@example.com" | AI 推断 |
| 正常 | phone | 13800000000 | AI 推断 |
| 缺必填 | name | (不传) | - |

- 获取方式:代码提取 / DB 查询 / AI 推断 / 用户手填
- 标"用户手填"的参数:在 .bru 里留 {{var}} 占位,跑前需用户在 .bru 或 env 里填实

## 4. 数据获取方式

本 feature 测试数据来源汇总:

- **代码提取**:从 handler 源码拿默认值、必填项、参数类型
- **DB 查询**:通过 db-query 查 users 表取真实 id;查 inst_attr 表取真实 attr_id
- **AI 推断**:组装符合校验规则的测试值(手机号、邮箱格式等)
- **用户手填**:以下参数需用户在跑前确认或补充:
  - {{token}}:登录 token,需先跑通用接口 POST /api/v1/auth/login 拿到
  - {{admin_user_id}}:管理员用户 id,若 DB 无现成数据需用户指定

降级说明(若项目未配置 db-query,在此标注):
- 未配置 db-query:S3 留 {{var}} 占位,S6 DB 核实标"无法核实"

## 5. 接口映射

| 场景 | 接口 | .bru 文件路径 |
|---|---|---|
| GET /api/v1/users/:id 正常 | GET /api/v1/users/:id | docs/bruno/user-service/<文件前缀>/getUser/正常.bru |
| POST /api/v1/users 正常 | POST /api/v1/users | docs/bruno/user-service/<文件前缀>/createUser/正常.bru |
| POST /api/v1/users 缺必填 | POST /api/v1/users | docs/bruno/user-service/<文件前缀>/createUser/缺name.bru |
| POST /api/v1/auth/login 正常 | POST /api/v1/auth/login | docs/bruno/common/login/正常.bru |

- .bru 按服务 + 需求 + 接口组织(按需求隔离,跨需求不覆盖)
- 通用接口落 docs/bruno/common/<接口名>/(不绑需求)

## 6. 验收口径

什么算通过:

- 查询接口:HTTP 200 + 断言通(响应体关键字段符合预期)
- 写接口:HTTP 2xx + 断言通 + **DB 核实通**(数据真的写了/改了/删了,字段值正确)
- 通用接口:同查询/写接口规则

什么不算通过:

- HTTP 200 但断言失败 → 失败-断言
- HTTP 200 + 断言通但 DB 数据错 → 失败-DB副作用
- 4xx / 5xx → 失败-HTTP
- 超时 / connection refused(服务就绪后)→ 失败-连接
```

## 填写说明

- AI 在 S2 生成时,§1 的"服务"和"通用"列必须填(由 AI 判断),用户可在 S3 前校正
- §2-§6 由 AI 根据 spec 接口章节 + 代码 + DB 数据填充
- §4 的"用户手填"项要与 S3 生成的 .bru 里的 `{{var}}` 占位一一对应
- 降级说明仅在项目未配置 db-query 时填,正常情况留空或删
