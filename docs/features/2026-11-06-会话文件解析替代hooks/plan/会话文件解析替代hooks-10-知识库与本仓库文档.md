# T-10: 知识库与本仓库文档

> 产物: plan
> 依据: spec@eac0b58

### 目标

本仓库知识库 7 篇按新机制改写(过 `cgraphx docs validate`);本仓库 `CLAUDE.md`、`CHANGELOG.md` 记全貌变化与全清影响。

### 对应 spec 编号

「文档与知识库」表的知识库行、本仓库 CLAUDE.md / CHANGELOG 行(对应:全部)

### 强制引用

无(文档任务)

### 涉及范围

- `docs/knowledge/`:改写 `开发时间线工具事件契约.md`、`会话id来源约束.md`、`Bash事件cwd是执行后的目录.md`、`agent适配.md`、`项目.md`、`并旧数据.md`、`git提交记录须在钩子当下固定hash.md`
- 本仓库 `CLAUDE.md`、`CHANGELOG.md`
- `docs/guides/interface-standards.md`:「Hook 子命令契约」节按新命令面更新(7 条 timeline hook 变兼容空命令、新增 `commit-gate-hook`、`timeline-git-commit-hook` 保留),并记 C-5 的退出码例外(3 是领域信号,不走 exitCodeForError)——spec 文档表没列它,但不改会规范与实现漂移

### 必须严格执行

- 知识库 7 篇的改写口径:
  - `开发时间线工具事件契约.md`:事件来源改「会话文件解析」;`pre_tool_use` / `session_end` 不再有新数据;`duration_source` 增加 `transcript`(两行时间差,含等人);轮次编号取提问 uuid。
  - `会话id来源约束.md`:会话 id 改从会话文件行内取(不再依赖 hook payload / 会话变量);会话变量只剩门禁(K12)与提示 scope(K17)在用。
  - `Bash事件cwd是执行后的目录.md`:按 D7 改写——解析侧 `cwd` 取调用行(执行前的目录),hook 时代「执行后的目录」的坑不再适用于新数据;旧数据的行为保留说明。
  - `agent适配.md`:接新 agent 的方式改「加描述字段 + 一个读取器」,不再需要支持 hook;`postToolUseFailure` / `writeTools` 已删。
  - `项目.md`:补 sessions.db(进度跟着会话文件,不跟项目数据;改名清 start_dirs、删除记 removed_projects)。
  - `并旧数据.md`:只并 git_commit 与 timeline_roots;重建(F6)只一次。
  - `git提交记录须在钩子当下固定hash.md`:补 D13/D14——门禁记号 `commit-gate-pass` 同样在钩子当下取走,经 `CGRAPHX_GATE_TREE` 传给后台进程。
  - 全部过 `node dist/cli/index.js docs validate`(写文件前必须过,非法文件会被索引跳过)。
- 本仓库 `CLAUDE.md`:
  - 「本仓库是什么」与「架构」:timeline 一节改(七个 hook 子命令 → 会话文件补录 + `timeline/ingest/`;`~/.cgraphx/sessions/` 废弃、`sessions.db` 新增;post-commit 提交记录照旧);新增 commit-gate 轻形态子系统一行(门面 + cli + errors + constants,无库表,只依赖基础层与 release、agents 门面);`cgraphx timeline install` 只装提交记录片段;install 装 commit-msg 门禁片段。
  - 「我们解决什么问题」:问题 5(规范送达——门禁从 agent hook 改 git 钩子,`--no-verify` 跳得过、跳过的发版审核列出)、问题 7(自动记录——改为查前补录、事件种类变化、升级后全量重建一次)。
  - 「易踩的坑」:如提及 7 条 hook / precommit-check 的表述同步。
- `CHANGELOG.md`(未发布版):记——agent hooks(7 条时间线 + precommit-check)移除,时间线改会话文件解析,提交门禁改 git commit-msg 钩子(`--no-verify` 从拦得住变跳得过、跳过的可查),升级后首次 install/查询会**清掉 hook 记的旧事件并按解析重建**(提交记录保留),不再记 `pre_tool_use` / `session_end`,`sessions.db` 新增。

### 允许局部适配

- 知识库各篇的具体行文(frontmatter 的 `updated` 类字段按现有文件风格)。

### 具体要求

1. 逐篇改写,每篇写完跑 `node dist/cli/index.js docs validate` 验一次。
2. CLAUDE.md / CHANGELOG 按上面清单逐项对照,改完通读一遍与 index 设计预览的说法一致。

### 完成条件

- 7 篇全部通过 `docs validate`;`node dist/cli/index.js docs concepts` 能查到改写后的条目。
- CLAUDE.md、CHANGELOG.md 改动完成,与本任务之前各任务的实际行为一致(以已合入的代码为准,不照 spec 原文抄未实现的细节)。

### 提交点

1. `docs(knowledge): 知识库 7 篇按会话文件解析改写——事件契约/会话来源/agent适配/并旧数据`:docs/knowledge/ 7 篇
2. `docs: CLAUDE.md 与 CHANGELOG 记 hooks→解析+git门禁的全貌变化`:CLAUDE.md、CHANGELOG.md

### 风险/注意事项

- CLAUDE.md 是本仓库的权威架构描述,改它时对照已合入代码(此时 T-1~T-8 已完成),不要提前写进未实现的机制。
- CHANGELOG 的「全清」影响要写显眼(用户升级后时间线历史会重建,30 天前的会话文件已被清理的机器找不回)——spec F6 明确要求的用户可见变化。
