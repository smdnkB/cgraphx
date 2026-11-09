# T-6: 文档同步

> 产物: plan
> 依据: spec@5852da8

- 目标: 知识库、CLAUDE.md、CHANGELOG 与新的行为一致,不留下「DeepSeek 不进…门禁」「子会话标题归主会话」的旧说法。
- 对应 spec 编号: F1、F2、F3(行为变更);D1–D12
- 强制引用: 无(文档任务)
- 涉及范围: `docs/knowledge/会话id来源约束.md`、`docs/knowledge/agent适配.md`、`docs/knowledge/开发时间线工具事件契约.md`;`CLAUDE.md`;`CHANGELOG.md`
- 必须严格执行:
  - C-9
- 允许局部适配:
  - 段落组织、例子、英文措辞;不改变事实与口径。
- 具体要求:
  1. `docs/knowledge/会话id来源约束.md`:
     - frontmatter aliases 加 `DSH_SESSION_ID`;updated 改 2026-11-08。
     - Summary:会话环境变量消费方包含 DeepSeek;主会话 `session-` / `od-`,子会话裸 uuid;提交记录记原始编号、不做根映射;门禁片段名单来自全部会话来源;跳过判定看片段里有没有本来源探针。
     - Findings:补 2026-11-08 实测与「只升级没重装:不拦、不标跳过」。
     - Evidence / Impact:指向 `agents/sources.ts` 的 `sessionIdEnv`、`listSessionIdEnvNames`、`git-commit.ts` 的按来源探针判定;新增来源只加 `sessionIdEnv`。
  2. `docs/knowledge/agent适配.md`:
     - Summary:只读来源仍不进安装器 / 副本 / `.dsh/`,但会话 id 现在进提交归属、门禁与会话提示。
     - Findings:`SessionSource` 有 `sessionIdEnv`;没有 `rootSessionId`;DeepSeek 子会话提交记原始编号。
  3. `docs/knowledge/开发时间线工具事件契约.md`:
     - DeepSeek 子会话「只产会话头与工具事实」(不产标题);标题表新增一次性 refresh 记号;标题优先级不变。
  4. `CLAUDE.md`:
     - 改 deepseek 的「不进安装器、副本与门禁」句;门禁片段变量名单来源;子会话标题;看板流程命令规则(第一个参数 / 标题 / feature-id / 副本目录名)。
  5. `CHANGELOG.md`:`## Unreleased` 下按现有英文格式加 `### Fixed` / `### Changed` 3–5 句,覆盖 DeepSeek 提交过门禁并记会话、旧片段不误标跳过、看板流程命令只认完整名字、子会话标题不再盖主会话。
- 完成条件:
  - 三个 knowledge 文件 `cgraphx docs validate` 通过;`cgraphx docs index` 退出码 0。
  - CLAUDE.md / CHANGELOG 与新行为一致;没有「DeepSeek 不进门禁」类旧说法。
- 提交点:
  1. `docs: 同步 DeepSeek 门禁与看板改动——知识库、CLAUDE、CHANGELOG`:上述 5 个文件。
- 风险/注意事项:
  - 不要写「DeepSeek 已进安装器」;它仍不是 AgentProfile。
  - 不要把子会话提交写成「归主会话」;K4 是记原始编号、看板挂不到。
