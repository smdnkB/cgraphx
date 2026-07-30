# TypeScript 项目规范模板

> 本目录包含 init-project-guides skill 的 TypeScript 技术栈模板片段。

> **填法(每个 `{{占位}}` 节都适用)**:只写**项目特异约定** —— 过 SKILL「判别」两条测试(必要性:删掉它工程师会不会做不一样;执行点:lint/工具是否已强制)。三类不写:技术栈事实、通用常识(单一职责/复用/合理拆分)、工具已强制项(缩进/引号/命名大小写)。挖不到项目特异内容 → 该节写一行"无特殊约定,遵循默认/lint"或整节省写,**不得用通用最佳实践凑数**。标题带 `(偏离项)` 的节只写偏离默认之处,默认如此的(如 TS 用 camelCase)不写。

---

## coding-standards.md 模板

```markdown
# 编码规范

> 技术栈(取向一行,非规范):{{tech_stack}}

## 目录结构(偏离项)

{{directory_structure}}

## 类型安全(偏离项)

{{type_safety}}

## 命名约定(偏离项)

{{naming_conventions}}

## 注释规范(偏离项)

{{comment_conventions}}

## 项目硬约束(仅项目特有)

{{coding_red_lines}}
```

> `项目硬约束` 只写项目明令的硬红线(如"单文件超 N 行必须拆分"若项目确实这么定、某类写法明令禁止)。单一职责 / 复用 / 合理拆分 / 策略模式 这类通用常识**不写**——那不是项目规范。

---

## interface-standards.md 模板

```markdown
# 接口设计规范

## API 设计(路径/版本/前缀)

{{api_design}}

## 参数校验(偏离项)

{{parameter_validation}}

## 返回值规范(偏离项)

{{response_conventions}}

## 错误处理(错误码形态)

{{error_handling}}
```

> 接口规范是项目约定密集区:路径前缀(如 `/fix`)、版本约定、统一返回包形态、错误码位数/分段 这类**推不出的**才写;RESTful、参数要校验 这类常识不写。

---

## data-standards.md 模板 · 模型层

```markdown
# 模型规范

## Interface/Type 定义(偏离项)

{{interface_type_rules}}

## 数据库映射

{{orm_mapping}}

## 通用字段

{{common_fields}}

## 关联关系

{{relationship_rules}}
```

> **关联关系标注(示范形态,按项目实际约定填)**:关系通常不靠 `FOREIGN KEY` 约束表达,而在字段注释里标"关联 <表>.<业务字段>"——**用有业务含义的字段关联,不用无意义的自增 id**。推不出、无工具兜底,是典型规范,必写;但"加不加 FK、用不用业务字段"本身是项目选型,挖到项目怎么定就怎么写,别照抄示例。
>
> ```sql
> -- ✅ 对:业务字段关联,注释标明关联表与业务字段
> COMMENT ON COLUMN work_order.assignee_staff IS '处理人工号,关联 users.staff_code';  -- PostgreSQL
> `assignee_staff` varchar(32) COMMENT '处理人工号,关联 users.staff_code'             -- MySQL
> -- ❌ 错:用无业务含义的 id 关联
> COMMENT ON COLUMN work_order.assignee_id IS '处理人ID,关联 users.id';
> ```

---

## data-standards.md 模板 · DDL 层

```markdown
# DDL 编写规范

## 基本规则(项目特有)

{{ddl_basic_rules}}

## 表命名约定

{{table_naming}}

## 字段类型选择

{{field_type_mapping}}

## 迁移工具

{{migration_tools}}
```

> DDL 是项目约定密集区:表名前缀、`decimal(12,2)` 这类类型锁定、"禁止 `ORDER BY`" 这类禁令、测试库/生产库名映射 才写;主键 bigint、utf8mb4 这类栈默认不写。

---

## testing-standards.md 模板

```markdown
# 测试规范

## 技术栈与框架

{{test_frameworks}}

## 目录与命名(偏离项)

{{test_directory_naming}}

## 单测 / 集成边界

{{unit_vs_integration}}

## Mock 政策

{{mock_policy}}

## Fixture 组织

{{fixture_organization}}

## 覆盖预期(项目门槛,无则不写)

{{coverage_expectations}}
```

> 单测/集成边界、Mock 政策是**选型锁定**(多个合理做法里项目选了哪个),属规范;覆盖率无项目硬性门槛就别凑"80%"这种通用数字。
