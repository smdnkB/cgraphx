# T-11 文档:skill 模板与流程图

> 产物: plan
> 依据: spec@4d4bf55

- 目标:模板 skill、流程图、使用指南里讲「数据放在哪」的文字,改成按项目放用户目录,并加上 `cgraphx project` 的说明。本仓库 `CLAUDE.md`、`CHANGELOG.md`、`docs/guides/` 归 T-12。
- 对应 spec 编号:全局约束末条(讲数据放在哪的文字随实现一起改);F1~F5 的概述;D17(命令名)
- 强制引用:无
- 涉及范围:
  - `assets/claude-template/skills/db-query/SKILL.md`、`db-query/agent-prompt.md`、`doc-report/SKILL.md`、`dev-start/SKILL.md`、`dev-merge/SKILL.md`、`release-review/SKILL.md`、`init-ddl/SKILL.md`、`cgraphx-guide/SKILL.md`、`cgraphx-guide/how-to-use.md`、`cgraphx-guide/how-to-use.html`、`cgraphx-guide/skills.html`
  - `assets/claude-template/FLOW-MAP.md`
- 必须严格执行:
  - 只改讲数据位置、install / uninstall 对数据做什么的那几句,以及加上 `cgraphx project` 的说明;其余文字一字不动
  - 命令、参数、路径、文案照 index C-13、C-14、C-15;不写契约里没有的选项
  - 版本流程判断「在副本里」的说法(`.cgraphx/shared` 是符号链接)不改:shared 链接照旧给版本流程用
  - 用户级配置 `~/.cgraphx/db-profiles.json` 的写法不改
  - 数据位置统一这样说:项目的数据在 `~/.cgraphx/projects/<目录名>/`,同一项目在本机的各个目录(clone、worktree、副本、复制出来的目录)记进同一份;知识库索引、「我的需求」留在各目录的 `.cgraphx/`;升级后还没在这个目录跑过 `cgraphx install` 的,照旧记在 `.cgraphx/cgraphx.db`
- 允许局部适配:措辞的局部顺序;HTML 里沿用原有标签与类名
- 具体要求(箭头左边是现在的原句,照它定位):
  1. `db-query/SKILL.md`
     - 「配置位置」节第一条 `项目级:\`.cgraphx/db-profiles.json\`(优先)` → `项目级:项目数据目录里的 \`db-profiles.json\`(优先;位置看 \`cgraphx project show\` 的「数据」那行:并过旧数据的目录在 \`~/.cgraphx/projects/<目录名>/\`,还没并过的在 \`.cgraphx/\`)`
     - 退出码表 2 那行的处理 `创建 \`.cgraphx/db-profiles.json\`` → `运行 \`cgraphx db init\` 生成项目级 \`db-profiles.json\`(在项目数据目录)`
  2. `db-query/agent-prompt.md`:`或 .cgraphx/db-profiles.json` → `或项目的 db-profiles.json(在项目数据目录,\`cgraphx project show\` 可看)`
  3. `doc-report/SKILL.md`:`数据存在项目本地 \`.cgraphx/cgraphx.db\`,per-project 隔离。` → `数据按项目存在 \`~/.cgraphx/projects/<目录名>/cgraphx.db\`:同一项目在本机各个目录(clone、worktree、副本)干活都记进这一份,在哪个目录查看到的都一样;还没并过旧数据的目录照旧在 \`.cgraphx/cgraphx.db\`。项目之间互相隔离。`
  4. `dev-start/SKILL.md`:frontmatter description 里 `副本里的会话、提交、任务归属都记进主目录` → `副本里的会话、提交、任务归属和主目录记进同一个项目的数据`;正文 `副本里的会话、提交、任务归属记进主目录,按登记归到这个需求` → `副本里的会话、提交、任务归属和主目录记进同一个项目的数据,按登记归到这个需求`;范例输出里 `副本里的会话和提交都记进主目录,归到` → `副本里的会话和提交和主目录记进同一个项目的数据,归到`
  5. `dev-merge/SKILL.md`、`release-review/SKILL.md`:所有 `登记和数据都留着` → `登记留着,副本里记下的会话和提交在项目的数据里`
  6. `init-ddl/SKILL.md`:`目标项目已配 \`.cgraphx/db-profiles.json\` 或 \`~/.cgraphx/db-profiles.json\`` → `目标项目已配项目级 \`db-profiles.json\`(\`cgraphx db init\` 生成,在项目数据目录)或用户级 \`~/.cgraphx/db-profiles.json\``(spec 列举之外,grep 出的同类文字一并改)
  7. `cgraphx-guide/SKILL.md`
     - 「整体使用流程」表「项目级」行:`\`cgraphx install\`(建 \`.cgraphx/\` 数据目录 + 部署` → `\`cgraphx install\`(建本地 \`.cgraphx/\` 与用户目录里这个项目的数据目录、并进原来的旧数据 + 部署`
     - 同表「卸载」行:`删 \`.cgraphx/\`,\`--keep-data\` 保留数据)` → `删这个目录的 \`.cgraphx/\`;项目的数据留在 \`~/.cgraphx/projects/\`,要删用 \`cgraphx project remove\`)`
     - `/dev-start` 那行的 `副本里的会话和提交记进主目录` → `副本里的会话和提交和主目录记进同一个项目的数据`
     - 「安装与接入」代码块注释 `# 建 .cgraphx/ + 部署` → `# 建 .cgraphx/ 与项目数据目录 + 部署`;下一段 `(项目级,写项目内 \`.claude/\` 与 \`.cgraphx/\`)` → `(项目级,写项目内 \`.claude/\`、\`.cgraphx/\`,项目的数据放 \`~/.cgraphx/projects/<目录名>/\`)`
     - 「背后自动」列表末尾加一条:`同一项目在本机的各个目录(clone、worktree、副本)记进同一份数据;\`cgraphx project show\` 看这个目录属于哪个项目、数据在哪,认错了用 \`cgraphx project name <名称>\` 改,\`cgraphx project list\` / \`cgraphx project remove <目录名>\` 列出、删除项目数据`
     - 「卸载」代码块注释 `+ 删 .cgraphx/` → `+ 删这个目录的 .cgraphx/`;下一段 `加 \`--keep-data\` 保留 \`.cgraphx/\` 数据。` → `加 \`--keep-data\` 保留这个目录的 \`.cgraphx/\`;项目的数据不随卸载删除,用 \`cgraphx project list\` 列出、\`cgraphx project remove <目录名>\` 删除。`
  8. `cgraphx-guide/how-to-use.md`:`建 \`.cgraphx/\` 数据目录(知识库 + timeline)` → `建本地 \`.cgraphx/\`(知识库索引)和用户目录里这个项目的数据目录(timeline、任务、上报;同一项目的各个目录共用),并把原来的旧数据并过去`;卸载两处照第 7 条的卸载改法;`副本里的会话、提交、任务归属记进主目录` → `副本里的会话、提交、任务归属和主目录记进同一个项目的数据`
  9. `cgraphx-guide/how-to-use.html`:`# 建 .cgraphx/ + 部署 skills 到 .claude/` → `# 建 .cgraphx/ 与项目数据目录 + 部署 skills 到 .claude/`;`# 清 .claude/ skills/配置 + 删 .cgraphx/` → `# 清 .claude/ skills/配置 + 删这个目录的 .cgraphx/(项目数据留着)`;`副本里的会话、提交、任务归属记进主目录` → 同第 8 条;`数据一直在 <code>.cgraphx/cgraphx.db</code>` → `数据按项目放在 <code>~/.cgraphx/projects/&lt;目录名&gt;/</code>,同一项目的各个目录记在一起`
  10. `cgraphx-guide/skills.html`:`/dev-start` 条目里 `副本里的会话和提交记进主目录。` → `副本里的会话和提交和主目录记进同一个项目的数据。`;`db-query` 条目里 `连库配置在 <code>.cgraphx/db-profiles.json</code>` → `连库配置在项目数据目录的 <code>db-profiles.json</code>(<code>cgraphx project show</code> 可看)`
  11. `FLOW-MAP.md`:「版本流程」节 `**数据**:副本里的会话、提交、任务归属记进主目录` → `**数据**:副本里的会话、提交、任务归属和主目录记进同一个项目的数据(\`~/.cgraphx/projects/<目录名>/\`)`,后半句不动
- 完成条件:
  - `grep -rn "记进主目录" assets/claude-template/` 无输出
  - `grep -rnE '(^|[^/~]|[^~]/)\.cgraphx/db-profiles\.json' assets/claude-template/` 无输出(只排除用户级的 `~/.cgraphx/db-profiles.json`)
  - `grep -n "cgraphx project" assets/claude-template/skills/cgraphx-guide/SKILL.md` 有命中
  - `grep -c "\.cgraphx/shared" assets/claude-template/skills/dev-start/SKILL.md` 仍是 3,`grep -c "\.cgraphx/shared" assets/claude-template/skills/dev-merge/SKILL.md` 仍是 4
- 提交点:
  1. `docs(skills): 讲数据放在哪的文字改成按项目放用户目录——db-query、doc-report、dev-start、dev-merge、release-review、init-ddl、cgraphx-guide、FLOW-MAP`:涉及范围里的全部文件
- 风险/注意事项:
  - 文档写的是程序交付后的样子:命令、路径以 index 的契约为准
  - 本仓库根目录 `.claude/` 是部署出来的,不手改
  - 本任务和 T-12 同时跑:`CLAUDE.md`、`CHANGELOG.md`、`docs/guides/` 归 T-12,不要碰
