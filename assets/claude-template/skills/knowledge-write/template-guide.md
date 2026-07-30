# 指南或教程类文档模板

适用的 `document_type` 值：

```text
guide
tutorial
installation
api
faq
note
```

## 完整模板

```markdown
# Redis Local Installation Guide

## Summary

说明本指南的目标。

## Context

说明本指南的适用场景。

## Prerequisites

列出所需的操作系统、工具、权限和前提假设。

## Steps

提供有序的操作步骤。

## Configuration

记录重要的文件、选项、环境变量或默认值。

## Examples

提供命令或使用示例。

## Validation

说明如何验证结果。

## Troubleshooting

记录常见故障和修复方法。

## References

链接源材料或相关的本地文档。
```

## 各章节填写要点

| 章节 | 用途 | 注意事项 |
|------|------|----------|
| Summary | 指南目标 | 一句话说清读完本文能达成什么 |
| Context | 适用场景 | 说明前置条件、目标读者、与其他指南的关系 |
| Prerequisites | 前提条件 | 列出 OS、工具版本、权限、网络要求等 |
| Steps | 操作步骤 | 有序编号，每步一个明确动作，附预期输出 |
| Configuration | 配置说明 | 记录需要修改的文件、环境变量、默认值及推荐值 |
| Examples | 使用示例 | 提供可直接复制运行的命令或代码片段 |
| Validation | 验证方法 | 说明如何确认操作成功，附验证命令或检查点 |
| Troubleshooting | 故障排除 | 按症状→原因→修复的格式记录常见问题 |
| References | 参考资料 | 链接官方文档、相关本地文档或相关代码文件 |
