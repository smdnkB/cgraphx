# git-standards.md 生成模板

git-standards.md 是**提交门禁文件**(precommit-check hook 指向它),含两部分。门禁触发时 agent 自己跑 `git diff --cached` 对照逐项判断,命中报告用户,不替用户改代码。

## 第一部分 · 提交消息规范

- 从最近 50-100 条历史 message 挖风格:标题格式(如 `CRM-req74181<描述>-client@req74181`、`bug54911<描述>@bug54911` 这类项目独有格式——**挖不出来就问用户,不得编造**)+ 正例/反例
- 票据关联规则:需求号/bug 号如何进标题;**编号未知必须问用户,不得编造或省略**
- 语言与措辞、长度约定;正文写哪些关键细节;breaking change / scope 等特殊标注
- agent 署名行(Claude Code 的 co-author 署名)与项目规范如何共存

**新项目(无历史)**:给常见模式选项让用户选(Conventional Commits `type(scope): subject` / 票据前缀式),或用户直接给团队规范。

## 第二部分 · 提交前检查点(项目自定义)

按技术栈给默认检查点 + 用户确认增删;每项写"查什么 + 为什么危险"。通用种子:

- 被注释掉的开关/注册项(写该项目实际语法:Spring `@Component`/`@Scheduled`/`@JmsListener` 等注解、前端组件注册、配置开关)——被注释 = 功能静默失效,高危
- 被注释掉的业务调用(监听注册、定时任务、关键链路入口)
- 未闭合逻辑(括号失衡、if/try/for 未配对)
- 写死的魔法字符串/数字(密码、URL、ID、阈值)
- 新增 TODO/FIXME/临时标记

项目特有项由用户补充(历史事故点、团队红线)。
