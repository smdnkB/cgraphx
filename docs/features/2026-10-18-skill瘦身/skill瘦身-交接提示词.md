# 交接: skill瘦身

> 产物: handoff
> feature-id: 2026-10-18-skill瘦身
> 负责人: liulongfei
> 日期: 2026-10-19
> 主任务: 2026-10-18-产物注册表与头部规范

## 本任务范围

- 范围以 spec 为准:`docs/features/2026-10-18-skill瘦身/skill瘦身-spec.md`(2026-10-19 写成)。
- 概括:skill 从 33 个减到 25 个并删短;做完产物注册表留给本任务的模板改动,把 `features check` 接进提交门禁;clarify 结束时自动输出可视化的澄清结果;写给人看的地方改用大白话。
- 不含业务地图:另开需求,web「系统地图」页的去留也在那边定。
- 澄清时的可视化结果(只作参考,以 spec 为准):https://claude.ai/artifact/RbHjD6mMXurZP87SU1WQU9
- spec 和本文件都还没提交。

## 已锁定决策

- 澄清阶段定下的决策已全部写进 spec 第 3 至 14 节,以 spec 为准,这里不重复。

## 未决问题

- 写 spec 时新定的 5 处(开头结论标题、澄清结果页文件名、大需求判据、门禁跑不起来时放行、照 spec 重新生成澄清结果页),2026-10-19 负责人确认按 spec 写法;同时在 spec §8.4 补了「门禁只检查本次暂存的、在 `docs/features/` 下的文件」。
- 写 plan 时的两处也已确认(2026-10-19):`features check` 新增 `--staged`,已写进 spec §8.4;iboc-check「补设计文档」只把指引改成 `/write-docs`,不新增可补的产物。目前没有未决问题。

## 依赖

- 主任务 `2026-10-18-产物注册表与头部规范`:已完成,已合入 main。头部格式、注册表、`features check` 都可以直接用;本任务只改注册表里的开头结论登记(spec §8.2)。

## 共享背景

见 `docs/features/2026-10-18-产物注册表与头部规范/产物注册表与头部规范-交接提示词.md`。

## 下一步

plan 已写好并经负责人确认(`plan/skill瘦身-index.md`)。在 `feat/skill瘦身` 分支上,按 index「执行方式」里的启动语分 8 批执行,全部完成后回 Claude 跑 `/code-review`。

注意:按现行规则跑 `features check`,这份 spec 会因为「第一个二级标题不是一图看懂」被判失败。这正是 spec §8.2 要撤掉的检查(plan T-1),不用改 spec。
