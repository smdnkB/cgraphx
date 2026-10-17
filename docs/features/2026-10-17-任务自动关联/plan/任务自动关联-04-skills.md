# skill 计划: 任务自动关联

> 上级:`任务自动关联-index.md`。spec:`../任务自动关联-spec.md` §7。改动入口一律 `assets/claude-template/`,不碰仓库根目录 `.claude/`。

---

### K-1: 新增 `/handoff-session` + write-spec 去掉选任务 + 流程登记

- 目标:探索会话能把工作交接给 1~N 个新会话且归属不漏;write-spec 不再让用户选任务。
- 对应 spec 条款:§7.1、§7.2;§4.2(交接文件的负责人头部)
- 强制引用:无(不动代码)
- 依赖:无
- 涉及范围:
  - 新增 `assets/claude-template/skills/handoff-session/SKILL.md`
  - 改 `assets/claude-template/skills/write-spec/SKILL.md`(工作流程第 0 步、「结构」节头部一行)
  - 改 `assets/claude-template/FLOW-MAP.md`(依赖总览图、设计流程「链」与「产物」两条)
  - 改 `assets/claude-template/skills/cgraphx-guide/SKILL.md`(「日常做需求 · 复杂按需」行与 skill 表各加一项)
- 必须严格执行:
  - **`handoff-session/SKILL.md`** 写法遵循本仓库 skill 风格(直接给最佳样例,少讲道理;禁止项只防模型做没提到的事):
    - frontmatter `name: handoff-session`;`description` 含触发词:会话交接、交接、开新会话继续、拆成几个会话、把这些需求分给新会话、handoff。
    - 流程四步:
      1. 列出交接目标(1~N 个),每个确认 feature-id:已有目录复用;没有则按 write-spec 命名规则(`YYYY-MM-DD-[业务ID-]<标题>`,业务 ID 与标题语言由用户确认,禁止中文转英文 slug)新建。
      2. 多个目标时让用户指定主任务,默认第一个;负责人默认 `git config user.name`,向用户展示确认。
      3. **先写主任务目录**的交接文件,再写其余目录。
      4. 输出启动语,每个目录一条,内容只有一句:`先读 docs/features/<feature-id>/<文件前缀>-交接提示词.md 再继续。`
    - 交接文件路径 `docs/features/<feature-id>/<文件前缀>-交接提示词.md`;给出一份完整的最佳样例,头部固定:
      ```
      # 交接: <标题>

      > feature-id: <feature-id>
      > 负责人: <git user.name>
      > 日期: <YYYY-MM-DD>
      > 主任务: <主任务 feature-id>(本文件即主任务时写「本任务」)
      ```
      正文固定小节:「本任务范围」「已锁定决策」「依赖」(对其它交接目标的依赖,写 feature-id)「共享背景」(主任务文件写全文;其余文件只写一行引用主任务交接文件路径)「下一步」(建议的下一个 skill,如 `/write-spec`)。
    - 禁止项(简短):不写 spec / plan / 代码;不自动开新会话;不把交接全文塞进启动语;不在非主任务文件里复制共享背景。
  - **write-spec 第 0 步**:删除「④ 任务——……不另跑 `task use`。」整段;在 ③ 之后改为一句:`④ 任务——不用选:会话归属由产出目录自动关联;只有要关联平台上已有任务时,才在头部写 \`> 任务: T-xx\`。` 同步把「用户已给 feature-id → 直接复用」扩为「用户已给 feature-id 或目录已由 `/handoff-session` 建立 → 直接复用」。
  - **write-spec「结构」节头部**一行:`任务(可选)` 改为 `任务(可选,仅关联平台已有任务时写编号)`。
  - **FLOW-MAP**:依赖总览图在 clarify 与 write-spec 之间加一条可选分支 `handoff-session(探索结束开新会话时;确认产出目录 + 交接文件)`;设计流程「链」末尾加「探索结束要开新会话 → `/handoff-session`」;「产物」条把「spec 头部声明 `> 负责人:`」补成「spec / 交接文件头部声明 `> 负责人:`(也是任务负责人判定依据),会话按读写的产出目录自动关联任务」。
  - **cgraphx-guide**:表格新增一行 `/handoff-session` | 探索或澄清结束、要开新会话继续时:确认产出目录、写交接文件、给出只含文件路径的启动语;可一次拆成多个任务。
- 允许局部适配:SKILL.md 的样例具体内容(用一个虚构需求举例,不得引用真实人名以外的敏感信息);FLOW-MAP 图中的排版。
- 完成条件:
  - `assets/claude-template/skills/handoff-session/SKILL.md` 存在,frontmatter 合法(`name` / `description` 两键)。
  - `grep -n "cgraphx task list" assets/claude-template/skills/write-spec/SKILL.md` 无结果。
  - `npm run build` 后 `dist/.claude-template/skills/handoff-session/SKILL.md` 存在(模板随构建整目录拷贝,确认无需改 `scripts/copy-assets.cjs`;若不存在则在该脚本登记)。
- 验证方式:上述命令;人工通读 SKILL.md 样例。
- 独立提交:是 —— `feat(skills): 新增 handoff-session 会话交接——write-spec 去掉选任务`
- 风险/注意事项:不改 `deprecated-assets.json`(本任务无改名或废弃)。
