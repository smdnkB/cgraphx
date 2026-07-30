# 设计文档 Markdown 模板

适用于 feature 发布后按需沉淀的设计文档,面向研发、技术负责人和后续维护者。由 `write-design-doc` skill 在发布后(或自测通过后)按需生成,默认输出到 `docs/features/<feature-id>/<文件前缀>-设计文档.md`。

内容来源:`docs/knowledge/` 中与主题相关的 AI 知识文档 + 当前 feature 目录下的 spec/plan。

## 文档结构

```markdown
# {文档标题}

> 生成日期：YYYY-MM-DD | 主题范围：{范围描述} | feature-id: {feature-id}

## 目录

- [概述](#概述)
- [架构设计](#架构设计)
- [核心模块](#核心模块)
  - [模块 A](#模块-a)
  - [模块 B](#模块-b)
- [技术决策](#技术决策)
- [已知限制](#已知限制)
- [扩展方向](#扩展方向)

## 概述

系统概述和技术定位。来源:spec 的目标与范围 + knowledge Summary。

## 架构设计

系统架构和数据流描述。来源:spec 的系统行为/接口边界 + knowledge Summary + Read 文件原文。

```
组件 A ──→ 组件 B ──→ 组件 C
      │
      ↕
   外部服务
```

## 核心模块

### 模块 A

职责描述、关键接口和依赖关系。来源:plan 的任务拆分 + knowledge Summary。

### 模块 B

职责描述、关键接口和依赖关系。

## 技术决策

### 决策标题

- **选择**：xxx
- **原因**：xxx
- **替代方案**：xxx

来源:spec 的"不可留到实现期的决策" + knowledge 中的 Decisions 章节。

## 已知限制

| 限制 | 影响范围 | 应对措施 |
|------|----------|----------|
| 限制描述 | 影响范围 | 应对措施 |

来源:spec 的"待确认项" + knowledge 中的 Findings / Risks 章节。

## 扩展方向

1. **方向 A** — 描述和优先级
2. **方向 B** — 描述和优先级
```

## 可选章节（按需插入）

```markdown
## 数据模型

| 类型 | 属性 | 关系 |
|------|------|------|
| 节点类型 A | 属性列表 | 关系列表 |

来源:spec 的"数据、状态与口径" + plan 的 schema 任务 + knowledge 的 Data Model 章节。

## API 参考

### 端点名称

`POST /api/path`

**请求参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| param | string | 说明 |

**响应示例**：

```json
{
  "key": "value"
}
```

## 性能特征

| 瓶颈 | 影响 | 优化方向 |
|------|------|----------|
| 描述 | 影响范围 | 优化方案 |

## 运维指南

### 部署

部署步骤和注意事项。

### 监控

关键指标和告警规则。

### 故障排除

按"症状 → 原因 → 修复"格式记录。

## 术语表

| 术语 | 定义 |
|------|------|
| 术语 A | 技术定义 |
| 术语 B | 技术定义 |

## 相关资源

- spec: `docs/features/<feature-id>/<文件前缀>-spec.md`
- plan: `docs/features/<feature-id>/plan/<文件前缀>-index.md`
- 相关代码: 相对路径
- 外部文档: URL
```

## 设计文档 Markdown 章节内容指南

| 章节 | 主来源 | 辅来源 | 改写方向 |
|------|------------------------|----------|----------|
| 概述 | spec 目标与范围 | knowledge Summary | 保留技术精确度,补充架构上下文 |
| 架构设计 | spec 系统行为/接口边界 | knowledge Summary + Read 原文 | 补充系统级架构图(ASCII 文本框图)、数据流描述 |
| 核心模块 | plan 任务拆分 | knowledge Summary | 按模块分组,说明职责和交互关系 |
| 数据模型 | plan schema 任务 | spec 数据口径 + Read 原文 | 用表格展示节点类型、属性、关系 |
| 技术决策 | spec 不可留实现期决策 | knowledge Decisions + Read 原文 | 保留决策理由,补充替代方案对比,按"选择/原因/替代方案"格式 |
| API 参考 | spec 接口边界 | plan backend 任务 + Read 原文 | 按 endpoint 分组,包含请求参数表格和响应示例 |
| 性能特征 | knowledge Findings | Read 原文 | 用表格展示瓶颈和优化方向 |
| 已知限制 | spec 待确认项 | knowledge Findings/Risks + Read 原文 | 按严重程度排序,用表格说明影响范围和应对措施 |
| 扩展方向 | knowledge Outlook | Read 原文 | 按优先级排序,用编号列表说明实现复杂度 |
| 运维指南 | knowledge Operations | Read 原文 | 按"部署 / 监控 / 故障排除"分子章节 |

## 格式规则

- 架构图使用代码块中的 ASCII 文本框图,不标注语言类型
- 技术决策按"选择 / 原因 / 替代方案"列表格式
- 代码示例标注语言类型(`rust`、`bash`、`json` 等)
- 文件路径使用行内代码包裹:`src/main.rs`
- HTTP 方法使用行内代码包裹:`POST /api/search/hybrid`
- 模块描述使用 `###` 子标题
- 表格优先用于结构化信息(限制、API 参数、性能瓶颈)
- 不要在文档中引用 AI 知识文档的路径或文件名;如需引用代码用相对路径
