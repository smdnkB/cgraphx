# 运维手册类文档模板

适用的 `document_type` 值：

```text
runbook
```

## 完整模板

```markdown
# Redis Restart Runbook

## Summary

描述运维目标。

## Symptoms

列出本手册适用的信号。

## Diagnosis

说明确认情况的检查方法。

## Procedure

提供主要操作步骤。

## Rollback

说明操作失败时如何撤销或恢复。

## Verification

说明如何确认服务已恢复。

## Escalation

列出何时以及如何升级。

## References

链接相关文档或仪表盘。
```

## 各章节填写要点

| 章节 | 用途 | 注意事项 |
|------|------|----------|
| Summary | 运维目标 | 一句话说清本手册解决什么问题 |
| Symptoms | 触发信号 | 列出告警、日志特征、监控指标异常等具体信号 |
| Diagnosis | 诊断方法 | 提供确认问题的检查命令和判断标准 |
| Procedure | 操作步骤 | 有序编号，每步一个明确动作，附预期输出 |
| Rollback | 回滚方案 | 说明操作失败或结果异常时如何恢复到操作前状态 |
| Verification | 验证恢复 | 提供确认服务已正常恢复的检查命令和标准 |
| Escalation | 升级路径 | 说明何时应停止自行处理并联系谁 |
| References | 参考资料 | 链接监控仪表盘、相关文档、责任人联系方式 |
