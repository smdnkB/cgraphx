---
title: PlantUML 活动图渲染陷阱
document_type: lesson
domains:
  - skill 流程
concepts:
  - PlantUML 活动图
aliases:
  - activity-beta
  - 泳道图
  - 绿线断开
  - endif 丢色
  - 回程线重叠
tags:
  - PlantUML
  - dev-clarify
  - 功能点配图
  - 画图
status: active
source_type: review
owners:
  - liulongfei
related_code:
  - assets/claude-template/skills/dev-clarify/references/功能点配图.md
  - assets/claude-template/skills/dev-clarify/references/泳道图画法.md
  - assets/claude-template/skills/dev-clarify/references/功能方案-讨论稿范例.md
  - assets/claude-template/skills/doc-delivery/references/设计文档.md
related_documents:
  - docs/knowledge/功能方案讨论稿.md
  - docs/features/2026-10-31-流程中澄清环节的功能点展示模式探索/流程中澄清环节的功能点展示模式探索-spec.md
created: 2026-10-31
updated: 2026-10-31
---

# PlantUML 活动图渲染陷阱

## Summary

PlantUML 活动图(activity-beta;泳道图、接口内逻辑图、编排图都是)有两个坑。语法检查全过,只看源码也看不出来,渲染出来才露馅。2026-10-31「流程中澄清环节的功能点展示模式探索」做 code-review 时,渲染成 SVG 才查出来:

① **绿线断开(endif 丢色)**:一个 `if` 只剩一支往下走(另一支以 `stop` 或连接点加 `detach` 收尾)时,写在 `endif` 后面的 `-[#2E7D32,bold]->` 会被丢掉,画成默认的黑线。改法:绿箭头写在那一支的末尾、`endif` 之前。连到 `(B)` 这类连接点之前忘写箭头,也会是一段黑线。

② **回程线重叠**:同一个 `if` 的两支各自切回同一条泳道,两支末框又一样高时,两条回程横线落在同一高度、互相压住,看着像串线。改法:一支以 `(A)` 加 `detach` 收尾,图末在那条泳道接 `(A)` → 结果 → `stop`。

这两条规则目前只写进了 dev-clarify 的 `功能点配图.md`。`泳道图画法.md` 受 spec D1 🔒「只多一行」约束,没写进去,所以 doc-delivery 设计文档的环节图还管不到这两条。

## 背景

那次审查的对象是 dev-clarify 新加的功能点配图样例,以及讨论稿范例里的订单导出图。13 张图用 1.2026.9 `-failfast2` 渲染,退出码全是 0,可导出成 SVG 一查:
- 编排图「返回订单号 → 跳到支付页」、讨论稿范例 F1「点「导出」→ 提交导出」这两段,描边都是黑的。
- F1「有订单?」两支的回程线,在同一高度重叠了约 400px。

审核子 agent 的 prompt 明写颜色这类画法问题不报,所以这类错会一路带进 spec 第一节。skill 里的样例又会被 agent 照抄。

## 结论

- **endif 丢色的原因是只剩一支**:用最小图分离过,和切不切泳道无关。两支都走到 `endif` 时有合并菱形,样式能保留;只剩一支时没有合并节点,`endif` 后写的箭头样式没有边可挂。
- **连接点前没写箭头**:`:校验通过;` 后面直接写 `(B)`,这一段没有箭头语句,用的是默认色。
- **回程线重叠看框高**:两个末框行数相同(比如都是两行字),回程横线就落在同一个 y 上,PlantUML 不会避让。改了框里的字、行数变了,也可能触发。修全景图时就遇到过:把无数据那一格改成两行字后,又重叠了。

## 怎么查

- `-failfast2` 只查语法,这两个坑查不出来。
- 导出 SVG(`plantuml -tsvg`),看正常路径的描边:绿是 `#2E7D32`、宽 2,黑是 `#181818`、宽 1。也可以导出 PNG 直接用眼看。
- 改过框里的字,重新看一眼有没有线重叠或交叉。

## 改图前要想到的

- 写或改任何活动图样例时,渲染成 PNG 或 SVG 看一遍,不能只看退出码。样例会被 agent 照抄,一处错会复制到所有讨论稿和 spec。
- 设计文档的环节图要补这两条,得改 `泳道图画法.md`。那会碰到 spec D1 🔒(用户确认过「只多一行」),要先回 spec 改决策,再动文件。

## Open Questions

- 设计文档的环节图要不要也补这两条,还没有定。
- 只在 PlantUML 1.2026.9 上确认过;换版本后行为会不会变,没有验证。
