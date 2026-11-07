# T-6: 文档与知识沉淀

> 产物: plan
> 依据: spec@90c1887

- 目标: 按 spec 文档节收尾——CHANGELOG、仓库 CLAUDE.md、cgraphx-guide 与 doc-report 两个 skill 模板、知识库「开发时间线」相关条目,写清 board 子系统、DeepSeek 只读来源与标题表这三件事;与代码实际行为保持一致。
- 对应 spec 编号: 文档节(表:CLAUDE.md/CHANGELOG、cgraphx-guide、doc-report、知识库条目)、D8、D12、D13。
- 强制引用: 无(文档任务)。
- 涉及范围: `CHANGELOG.md`、根 `CLAUDE.md`、`assets/claude-template/skills/cgraphx-guide/SKILL.md`、`assets/claude-template/skills/cgraphx-guide/how-to-use.md`、`assets/claude-template/skills/cgraphx-guide/how-to-use.html`、`assets/claude-template/skills/doc-report/SKILL.md`、`docs/knowledge/开发时间线工具事件契约.md`、`docs/knowledge/agent适配.md`。
- 必须严格执行:
  - 写的内容与已实现的行为一致(引用 T-1~T-5 的最终形态:命令、来源、表名、提示文案);文档写「实际交付的行为」,不写计划语气。
  - skill 模板的修改入口是 `assets/claude-template/`(源,随包分发),不碰仓库根 `.claude/`(部署产物)。
  - 知识库文件保持可被 `cgraphx docs` 索引:改完跑 `node dist/cli/index.js docs validate` 确认合法。
  - CHANGELOG 记入 `Unreleased` 段,风格对照该文件现有条目(英文为主、一段式,如 replicas-are-worktrees 条目)。
- 允许局部适配:
  - 各文件的具体措辞、详略;`how-to-use.md` 与 `how-to-use.html` 两份同步改(html 是 md 的渲染版,内容一致即可)。
- 具体要求:
  1. `CHANGELOG.md` Unreleased 加一段:新增 `cgraphx board`(本机只读看板:任务列表/会话/复制编号标题)、timeline 新增 DeepSeek 只读会话来源(第三家读取器,zstd 帧式 jsonl;不进安装器/副本/门禁)、项目库新增 `timeline_session_titles` 标题表(老会话一次性回填)。
  2. 根 `CLAUDE.md`:「本仓库是什么」的子系统清单加 board(轻门面形态 + `page.html` 资产);timeline 描述补「DeepSeek 只读来源、会话标题表」;架构节补 board 一句(只经五个门面取数、只读、`cgraphx board`)。
  3. `cgraphx-guide/SKILL.md` 与 `how-to-use.md`/`how-to-use.html`:工具清单加 `cgraphx board`——任意目录打开本机看板、会话自动挂任务、复制标题/编号到对应软件找回、只读。
  4. `doc-report/SKILL.md`:事件来源说明补 DeepSeek(报告里会出现第三家 agent 的事件)。
  5. `docs/knowledge/开发时间线工具事件契约.md`:补标题表(timeline_session_titles、custom > ai > agent、回填记号)与 DeepSeek 事实来源;`docs/knowledge/agent适配.md`:补「只读来源」这一档(listSessionSources、不动 AGENT_PROFILES、zstd 门槛)。
  6. 沉淀口径:只写跨需求有用的事实与约束,不复述本需求的过程。
- 完成条件:
  - `node dist/cli/index.js docs validate` 通过;`npm test` 全量通过(文档不影响,跑一遍兜底)。
  - 通读一遍:六处文档与实际行为无出入(命令名、表名、来源名、文案)。
- 提交点:
  1. `docs: agent看板收尾——CHANGELOG、CLAUDE.md、cgraphx-guide、知识库沉淀`:本任务全部 8 个文件。
- 风险/注意事项:
  - 根 `.claude/` 里的同名 skill 是部署产物,不改;`deprecated-assets.json` 不动(没有废弃路径)。
  - `FLOW-MAP.md` 不动(board 是程序能力,不在 skill 流程图上)。
