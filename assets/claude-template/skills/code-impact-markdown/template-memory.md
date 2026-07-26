# 记忆或分析类文档模板

适用的 `document_type` 值：

```text
conversation
exploration
finding
analysis
decision
lesson
warning
rule
architecture
```

## 完整模板

```markdown
# DefaultOrderService Exploration Findings

## Summary

陈述持久性结论。

## Context

解释为何进行此探索以及检查了什么范围。

## Findings

记录具体观察结果，而非推测。

## Evidence

引用文件、符号、命令、API 结果或相关代码片段。

## Impact For Future Changes

说明未来 AI/代码变更在编辑前应考虑什么。

## Reuse Guidance

说明另一个 AI 应在何时使用此文档。

## Follow-ups

列出后续工作。

## Open Questions

将未解决的问题与已确认的发现分开跟踪。
```

## 简短对话摘要模板

用于简短的 conversation 记录：

```markdown
# Conversation Memory

## Summary

## Decisions

## Follow-ups

## Reuse Guidance
```

## 各章节填写要点

| 章节 | 用途 | 注意事项 |
|------|------|----------|
| Summary | 持久性结论 | 写结论而非过程；未来 AI 读到此处即可判断相关性 |
| Context | 探索原因和范围 | 说明为什么需要探索、检查了哪些文件或模块 |
| Findings | 具体观察 | 只记录确认的事实，推测放入 Open Questions |
| Evidence | 证据引用 | 附上文件路径、符号名、命令输出等可验证的信息 |
| Impact For Future Changes | 未来影响 | 说明修改相关代码前需要考虑什么 |
| Reuse Guidance | 复用指引 | 说明另一个 AI 在什么场景下应参考此文档 |
| Follow-ups | 后续工作 | 列出待完成的任务或待验证的假设 |
| Open Questions | 未解决问题 | 与已确认的 Findings 分开，避免混淆 |
