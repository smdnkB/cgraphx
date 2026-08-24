---
title: features 需求阶段派生
document_type: decision
domains:
  - features 索引
concepts:
  - features 需求阶段派生
aliases:
  - 需求阶段派生
  - 阶段派生
  - features 阶段
  - 派生阶段
  - 需求阶段
tags:
  - features
  - cgraphx
  - 派生视图
status: active
source_type: work_context
owners:
  - liulongfei
related_code:
  - src/core/features/scanner.ts
  - src/core/features/types.ts
  - src/core/features/cli.ts
  - src/core/features/sync.ts
  - assets/claude-template/skills/write-spec/SKILL.md
  - assets/claude-template/skills/write-plan/SKILL.md
related_documents:
  - docs/features/2026-07-31-features阶段派生取代状态字段/features阶段派生取代状态字段-spec.md
created: 2026-08-01
updated: 2026-08-23
---

# features 需求阶段派生

## Summary

cgraphx features 子系统(`cgraphx features list`)展示的「需求阶段」不靠手填,而是查询时从 `docs/features/<feature-id>/` 的产物存在性**实时派生**:有测试报告 → 已验证、有 plan → 已规划、有 spec → 已规格、都没有 → 未规格。这是「派生优于手维护」信条的落地——取代了原先无人维护、必然腐烂的头部 `> 状态:` 字段,并一并删除了只写不读的 `source` 字段。本条记录该决策的取舍与派生口径。

## 决策与背景

- 原 spec/plan 头部有手填 `> 状态:`(草稿/已确认/已审阅,自由文本),但**没有任何环节维护它**:skill 只在创建时写一次,之后永久腐烂(spec 确认了、实现了、发布了,头部还是「草稿」);features 程序还拿它做精确过滤(`--status`),词表不受控导致过滤一查就空——一个「可按状态检索」的假象。
- 本库的核心信条是**派生优于手维护**:features 本就是 `docs/features/` 目录树的纯派生视图(无 DB、查询时实时扫描),knowledge 反查也是派生,明文写着「手动维护必陈旧,反查永远最新」。状态字段恰好违反这条——所以解法是把它也变成派生量。
- 决策(2026-08-01,用户拍板):阶段由产物存在性派生;**删除** `status` 与 `source`(source 是只写不读的元数据来源标记,无程序消费,「无头部」已由 `owner=null` 自证);`--status` 移除、由 `--stage` 取代,**不留过渡别名**。

## 备选方案(为何不选)

- **生命周期 + skill 维护**(定枚举,各环节回写状态):语义最丰富,但靠人/agent 自觉,本质仍会漏改——治标不治本,否决。
- **降级为可选备注**(保留字段但声明不维护、程序不过滤):等于承认字段半废弃,不如直接派生,否决。
- **保留「草稿 vs 已确认」区分**:纯派生无法区分「写了没确认」与「已确认」。拍板**不保留**——确认与否本就在 clarify→spec 流程里由人把关,不必落成可检索字段;有 spec 即算「已规格」。

## 派生口径(契约)

- 单一当前阶段 = 已达到的**最高**里程碑,优先级 **已验证 > 已规划 > 已规格**;三个里程碑**各自独立**探测,允许跨阶(spec + 测试报告但无 plan → 直接已验证)。
- **已验证 = 测试「报告」存在**(接口测试报告 / 单元测试报告),测试「规格」不算;**且不含「通过」语义**——有报告即已验证,无论结果(通过/失败是报告正文,不进阶段)。
- **不设「已实现/已交付」阶段**:代码完成不落在 `docs/features/`,纯产物派生不可见;本次不引 git/timeline 信号。
- 无任何可识别产物 → 未规格(`list` 显示 `-`)。
- 阶段查询时实时计算,**不落盘、不缓存**——文件系统变了下次查询即反映,天然无陈旧。

## 隐式约束与陷阱

- 「测试报告」识别需**三个后缀都匹配**:单元测试报告(`*-单元测试报告.md`)、接口测试报告(`*-接口测试报告.md`,2026-08 由 `-测试报告.md` 改名)、旧名(`*-测试报告.md`,存量产物兼容不回退)——新名里「接口」两字隔断旧后缀的连字符(`X-接口测试报告.md` 不以 `-测试报告.md` 结尾),少匹配一个就漏派生「已验证」。
- 存量文档的旧 `> 状态:` 行**忽略、不主动改写**(无害死文本);新文档(write-spec/write-plan)头部不再产出状态。
- `负责人`/`日期`/`--mine` 行为**不变**——派生只取代状态,不动归属。

## 代码入口

- `src/core/features/scanner.ts` — `deriveStage`(产物探测派生阶段)、`findMetaFile`(找头部元数据文件,读 负责人/日期)、`readHeaderMeta`(不再读状态)。
- `src/core/features/types.ts` — `FEATURE_STAGES` / `FeatureStage`、`FeatureEntry.stage`(无 status/source)、`FeatureFilter.stage`。
- `src/core/features/cli.ts` — `list` 阶段列与 `--stage` 过滤;`src/core/features/sync.ts` — my-features.md 阶段列。
- `assets/claude-template/skills/write-spec/SKILL.md`、`write-plan/SKILL.md` — 头部约定去 `> 状态:`。

## Open Questions

- 若日后要表达「已实现/已交付」,需引入 docs/features/ 之外的信号(git 提交 / timeline / 标记文件)——届时阶段模型需扩展,当前刻意不做(YAGNI)。
