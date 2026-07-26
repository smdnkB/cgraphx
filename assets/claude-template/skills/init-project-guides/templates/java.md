# Java 项目规范模板

> 本目录包含 init-project-guides skill 的 Java 技术栈模板片段。
> 这些片段会被动态填充到生成的规范文件中。

---

## coding-standards.md 模板

```markdown
# 编码规范

## 技术栈

{{tech_stack}}

## 目录结构

{{directory_structure}}

## 命名约定

{{naming_conventions}}

## 注释规范

{{comment_conventions}}

## 常量管理

{{constant_management}}

## 错误处理

{{error_handling}}

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

## 接口路径规范

{{api_path_conventions}}

## 服务命名约定

{{service_naming}}

## 参数与返回值

{{parameter_return_conventions}}

## 兼容性规则

{{compatibility_rules}}

## 调用模式

{{call_patterns}}
```

---

## model-standards.md 模板

```markdown
# 模型规范

## 实体规则

{{entity_rules}}

## 通用字段

{{common_fields}}

## 主键约定

{{primary_key_conventions}}

## 字段注释

{{field_comment_rules}}

## 关联关系

{{relationship_rules}}
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

## 索引规范

{{index_conventions}}

## 迁移工具

{{migration_tools}}
```
