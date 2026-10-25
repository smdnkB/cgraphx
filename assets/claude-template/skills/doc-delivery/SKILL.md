---
name: doc-delivery
disable-model-invocation: true
description: 发布后按需生成需求文档、设计文档、接口文档。运行时先问要哪几种,可以多选;写实际交付的行为,不重新定义 spec。产物是 docs/features/<feature-id>/ 下的 <前缀>-需求文档.md、<前缀>-设计文档.md(流程全景加改动环节的图解)、<前缀>-接口文档.html。Use when 写需求文档/PRD/设计文档/接口文档/API 文档/发布后补文档/doc-delivery.
---

# 发布后补文档 (doc-delivery)

## 定位

功能发布后按需执行,不在开发主链上。写的是实际交付的行为,给领导、客户、业务方或后续维护者看。

spec 是唯一契约,本 skill 不重新定义 spec 已锁定的规则、接口和口径;spec 与代码不符时标【待确认】。

## 流程

1. 问要哪几种(多选):需求文档、设计文档、接口文档。
2. 定需求目录:用户给了 feature-id 就用;没给就从当前目录往上找最近的 `docs/features/<feature-id>/`;找不到就问。文件前缀 = feature-id 去掉日期段 `YYYY-MM-DD`。
3. 按选中的种类逐份生成:读对应参考文件,照它的章节和模板写(需求文档读 `references/需求文档.md`,设计文档读 `references/设计文档.md`,接口文档读 `references/接口文档.md`)。
4. 交付:告诉用户每份文件的位置,列出标了「待补充」或【待确认】的地方。

## 共用规则

| 文档 | 文件 | 产物类型 | 开头先给什么 |
|---|---|---|---|
| 需求文档 | `<前缀>-需求文档.md` | prd | 需求概览 |
| 设计文档 | `<前缀>-设计文档.md` | design_doc | 30 秒看懂 |
| 接口文档 | `<前缀>-接口文档.html` | api_doc | 接口清单 |

```markdown
# 需求文档: 积分发放规则

> 产物: prd
> 依据: spec@3f9a1c2

## 需求概览
```

```html
<!DOCTYPE html>
<!--
> 产物: api_doc
> 依据: spec@3f9a1c2
-->
```

## 红线

1. ❌ 不编造:代码和 spec 里都没有的接口、字段、规则不写,缺的标「待补充」或【待确认】。
2. ❌ 不重新定义 spec 已锁定的契约。
3. ❌ 不写 `docs/knowledge/`,不改 spec、plan、代码。
4. ❌ 写完不自动继续别的流程。
