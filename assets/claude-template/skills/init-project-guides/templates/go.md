# Go 项目规范模板

> 本目录包含 init-project-guides skill 的 Go 技术栈模板片段。

---

## coding-standards.md 模板

```markdown
# 编码规范

## 技术栈

{{tech_stack}}

## 目录结构

{{directory_structure}}

## 包命名

{{package_naming}}

## 命名约定

{{naming_conventions}}

## 错误处理

{{error_handling}}

## Context 传递

{{context_passing}}

## 通用规则

- 单文件超过 **600 行必须拆分**
- 合理使用策略模式处理复杂条件逻辑
- 合理拆分代码文件,保持单一职责
- 编写代码时必须检查有没有可以复用的常量 / 函数 / 工具
```

---

## interface-standards.md 模板

```markdown
# 接口设计规范

## HTTP 接口设计

{{http_api_design}}

## 参数校验

{{parameter_validation}}

## 返回值规范

{{response_conventions}}

## 中间件

{{middleware_conventions}}
```

---

## model-standards.md 模板

```markdown
# 模型规范

## Struct 定义

{{struct_rules}}

## 数据库映射

{{orm_mapping}}

## 通用字段

{{common_fields}}
```

---

## ddl.md 模板

```markdown
# DDL 编写规范

## 基本规则

{{ddl_basic_rules}}

## 表命名约定

{{table_naming}}

## 字段类型选择

{{field_type_mapping}}

## 迁移工具

{{migration_tools}}
```
