# project-background.md 模板

> 本文件是 init-project-guides skill 的通用项目背景模板。
> 内容通过用户提示 + agent 主动探索生成。

```markdown
# 项目背景

## 是什么

{{project_description}}

## 给谁用

{{target_users}}

## 核心{{business_or_features}}

{{core_items}}

## 架构分层

{{architecture_layers}}

## 模块清单

{{module_list}}

## 技术栈

{{tech_stack_table}}

## 数据库

{{database_info}}
```

## 占位符说明

| 占位符 | 来源 | 示例 |
|--------|------|------|
| `{{project_description}}` | 用户提示 + README 探索 | "江苏电信 CRM 3.0 营业厅业务受理系统" |
| `{{target_users}}` | 用户提示 | "营业厅一线员工、热线客服、政企客户经理" |
| `{{business_or_features}}` | 根据项目类型自动选择 | "业务" 或 "功能" |
| `{{core_items}}` | 用户提示 + 代码探索 | 表格形式的业务/功能列表 |
| `{{architecture_layers}}` | 目录结构探索 | 架构分层描述 |
| `{{module_list}}` | 目录结构探索 | 模块清单表格 |
| `{{tech_stack_table}}` | package.json/pom.xml/go.mod | 技术栈表格 |
| `{{database_info}}` | 依赖探索 | 数据库类型和说明 |

## 生成策略

1. **项目名称/描述:** 从用户提示获取,如用户未提供,从 README.md 第一行提取
2. **目标用户:** 从用户提示获取
3. **核心业务:** 从用户提示获取,如用户未提供,从目录结构推断
4. **架构分层:** 从目录结构推断
5. **模块清单:** 从目录结构扫描
6. **技术栈:** 从依赖文件提取关键依赖
7. **数据库:** 从依赖推断
