# 交接: skill瘦身

> feature-id: 2026-10-18-skill瘦身
> 负责人: liulongfei
> 日期: 2026-10-18
> 主任务: 2026-10-18-产物注册表与头部规范

## 本任务范围

- 精简 `assets/claude-template/` 下的 skill、agent、command:目前 30 多个 skill,连同 agents、commands 约 6000 行。
- 保留模型自己无从知道的:产物契约(路径、命名、头部)、「spec 是唯一契约」与各阶段边界、人工确认点、cgraphx 命令用法、门禁与「写接口必查 DB」这类硬规则,外加一个最佳样例(本仓库的写法是直接展示最好案例,少讲道理)。
- 去掉或压缩:通用方法论教学、长篇 ❌ 清单与逐条自检、跨 skill 重复的规则、为防较弱模型跑偏而写的冗长解释;能交给程序校验的规则迁到主任务的 `cgraphx features check` 或门禁。
- 合并 / 废弃候选:knowledge-api 与 knowledge-recall 合并;code-map-recall 并入 write-plan;write-prd / write-design-doc / write-api-doc 合成一个事后文档 skill;knowledge-migrate、iboc-check 评估后废弃;knowledge-init(761 行)大幅瘦身。
- 用 eval 驱动删减:同一个需求分别用删减前后的 skill 跑一遍,对比产物质量,不凭感觉删。

## 已锁定决策

- 瘦身以 Claude 模型为基线(2026-10-17 定)。
- 改 skill 的入口是 `assets/claude-template/`;改名或废弃的旧路径登记进 `deprecated-assets.json`,由 `cgraphx install` / `uninstall` 清理。

## 未决问题

- 执行侧 skill 是否也按 Claude 基线删:本轮后来定了实现交给第三方模型执行(Claude Code CLI 接兼容接口,或 CodeBuddy),`implementation`、`subagent-implement` 的各个 prompt、`write-unit-test-code`、`run-api-test`、`run-ui-test` 这些执行侧 skill 的读者不再是 Claude。推荐按 skill 区分:设计侧(clarify / spec / plan 等)按 Claude 基线大胆删,执行侧保留防跑偏内容。
- 合并 / 废弃候选逐个确认。

## 依赖

- 主任务 `2026-10-18-产物注册表与头部规范`:各 skill 里的产物契约要按它定下的头部格式统一写,规则迁移依赖它的 `cgraphx features check`。不涉及产物头部的部分(合并、废弃、删通用教学)可以先做。

## 共享背景

见 `docs/features/2026-10-18-产物注册表与头部规范/产物注册表与头部规范-交接提示词.md`。

## 下一步

`/clarify-requirements`(先定「未决问题」,再 `/write-spec`)
