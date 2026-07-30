# Git 提交规范

## 提交消息规范

格式:`type(scope): 中文描述`(Conventional Commits + 中文,19/19 历史一致)

- type:feat / refactor / fix / docs;scope 常用:skills / installer,仓库级改动省 scope
- 补充说明用"——",并列用"+",数值对比用"→"(`159→60`)
- 正例:`feat(skills): init-project-guides 双模式——新项目立起步规范` / `refactor(skills): 体式提炼——implementation 159→60`
- 反例:`update skill`(无 type、英文、零信息)/ `feat: 修复bug并优化性能`(空话)
- **无票据关联**:需求追踪走 `docs/features/` 目录,不进标题
- body:非琐碎提交写 body——背景一行(问题/动机)+"-" 列要点;琐碎可只留 subject
- agent 署名:Claude 协作提交保留尾行 `Co-Authored-By: Claude <noreply@anthropic.com>`(历史多数 + 工具默认)

## 提交前检查点

门禁由 precommit-check skill 对照本节执行(`git diff --cached` 逐项判断,命中报告用户,不替用户改代码)。

- **与 TS 同放的运行时资产未登记 `scripts/copy-assets.cjs`** —— 不随包发布,用户机器运行时 ENOENT
- **src/core 出现对 src/cli / src/web 的 import** —— 分层硬约定破坏,无 lint 拦截,只靠人眼
- **schema.sql 丢失 `IF NOT EXISTS`** —— 已初始化项目重复应用 schema 直接报错
- **timeline hook 链路出现未 await 的 DB 写入 / 抛错不吞** —— 阻塞宿主 Claude Code 工具调用
- **`vitest.config.ts` 的 `TZ: 'UTC'` 钉死被改** —— 日期断言失去跨机器可复现性
- 被注释掉的命令注册 / hook 接入项(commander `.command(...)` / settings.json hooks)—— 功能静默失效
- 写死的魔法值:绝对路径、密钥、阈值、版本号写进源码
- 新增 TODO / FIXME:确认是否应转任务,不随提交入库
