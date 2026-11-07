# 功能方案: 安装默认勾选已配置的 agent(讨论稿 v1)

> 讨论稿,不是契约:人终确认的那一版由 `/dev-spec` 原样收录为 spec 第一节,之后以 spec 为准,本文件不再维护。

**一句话**:安装器选 agent 的多选框不再「机器上装了 CLI 就默认勾」,改为默认只勾这个项目里已有配置的 agent,项目没用过的不勾——避免回车就把没用过的 agent 也装进来。

**功能清单**

| 编号 | 功能点 | 类别 | 从哪进 → 到哪去 | 一句话 |
|---|---|---|---|---|
| F1 | 安装默认勾选项目已配置的 agent | 核心 | `cgraphx install` 交互多选 → 选完照旧逐 agent 装配置 | 默认勾选 = 项目里已有配置目录的 agent;机器上装了 CLI 不再默认勾;选项后标「项目已配置 / 未配置」 |
| — | 静默安装、显式指定的口径 | 边界外排除 | — | 不动:`-y`(静默)本就按「上次装过的」,`-t`(显式给名单)本就按给的名单,都不受这次改动影响 |

### F1 安装默认勾选项目已配置的 agent(核心)

现在:多选框默认勾「检测到」的 agent——**项目里存在它的配置目录、或它的 CLI 装在这台机器上**都算检测到。开发机上装着 claude 和 codebuddy 两个命令时,任何项目里跑 install 都默认全勾,回车就把这个项目从没用过的 agent 也装上(建它的配置目录、部署整套技能)。改后:默认只勾「项目里已有配置目录」的,CLI 装在机器上不再算;一个都没有的项目一个都不默认勾。静默安装 `-y` 在一个都没装过时仍兜底装 Claude Code(脚本场景要确定对象),与交互路径的「全不勾」刻意不同。

行为链:操作 → 表现 → 结果

- 操作:在项目目录跑 `cgraphx install`
- 表现:多选框「选择要安装 cgraphx 的 agent(回车确认;已装的没勾会卸掉它的 cgraphx 配置)」弹出,**默认勾选 = 项目里已有配置目录的 agent**;每个选项后面带标注:Claude Code(项目已配置 / 未配置)、CodeBuddy(项目已配置 / 未配置)
- 结果:回车确认 → 只给勾中的 agent 装配置;原来装过 cgraphx、这次没勾的,照旧卸掉它的 cgraphx 配置(既有行为,不动)

边界:① 项目里一个配置目录都没有(全新项目)→ 一个都不默认勾,回车 = 只初始化数据目录、不装任何 agent 配置,要装手动勾;② 项目里只有 `.codebuddy/` 没有 `.claude/` → 只勾 CodeBuddy、不勾 Claude Code,即使用户机器上装着 claude 命令;③ 项目里 `.claude/`、`.codebuddy/` 都在 → 两个都默认勾(项目确实两个都在用,人仍可手动取消一个)。

| 编号 | 哪一步 | 怎么判定 | 算 / 不算(例子) | 依据 |
|---|---|---|---|---|
| K1 | 默认勾选 · 哪些算「项目已配置」 | 项目根下存在该 agent 的配置目录 | 算:项目有 `.claude/`(勾 Claude Code)、有 `.codebuddy/`(勾 CodeBuddy)——目录是谁建的不论,装过 cgraphx、或人自己用这个 agent 开发过都算;不算:只在机器上装了 `claude` / `codebuddy` 命令、项目里没有对应目录 | 文件系统事实:项目根下 `.claude/` / `.codebuddy/` 目录存在;取现状「检测到」判定的前一半,去掉「CLI 在 PATH 上」,新定 |
| K2 | 默认勾选 · 上次装过的 | 上次在这个项目装过 cgraphx 的 agent 必然写过配置目录 → 天然默认勾上 | 上次装过 Claude Code 的项目重跑 install → Claude Code 默认勾着,直接回车不会误卸 | K1 的推论(装过必建目录);沿「2026-11-07-安装只留选中的agent」的已装口径 |
| K3 | 表现 · 选项标注 | 每个选项后标注该项目配置情况:有配置目录标「项目已配置」,没有标「未配置」 | `Claude Code  项目已配置`、`CodeBuddy  未配置` | 新定;多选框选项的 hint 位置(现成能力) |

🎭 体验决策:全新项目(项目里没有任何 agent 配置目录)一个都不默认勾——严格「未配置不选」,回车只初始化数据目录、不装任何 agent 配置,要装手动勾。

---

以下供 spec 使用,可不细读。

**必须在 spec 前解决的问题**:无。

**后续阶段的决策**:K3 标注的具体文案(hint 里写「项目已配置 / 未配置」还是带上目录名)。

**已锁定技术约束**:用户声明——默认选项目已配置的,未配置的默认不选,避免错误安装;全新项目(没有任何 agent 配置目录)一个都不默认勾;`-y`、`-t` 路径口径不变(`-y` 一个都没装过时仍兜底装 Claude Code)。

**留给 spec 的细节决策**:

- 实现位置:交互多选默认值在 `selectInstallTargets`(src/cli/installer/agent-steps.ts:93-97),现按 `detect().detected`(配置目录存在 ∨ CLI 在 PATH)取;改为只看配置目录存在(改 `isAgentDetected` 或新加判定——`isAgentDetected` 唯一消费方就是这里的 `detect()`,`detect().detected` 唯一消费方就是这处默认值,直接改判定即可,无别处波及)
- 边界①的兜底按体验决策落:`initialValues` 空时取 `[]`(去掉现状「都没检测到取 `[claude-code]`」的兜底)
- K3 hint:clack multiselect options 的 hint 字段(installer/index.ts:207-215 可选子系统多选已有用法)
- 测试:现有 `__tests__/cli/installer/` 未覆盖默认勾选逻辑,需补(含「CLI 在 PATH 但项目无目录不默认勾」「已装的重跑默认勾」「两个目录都在默认全勾」「全新项目全不勾」)

**影响半径与风险**:LOW——单处默认值口径变更,交互路径专属;静默(-y)、显式(-t)、卸载路径不动。

**现实约束清单**:

- 交互多选与默认值:src/cli/installer/agent-steps.ts:83-106(`selectInstallTargets`);`initialValues = detected`,空时兜底 `[claude-code]`;`required: false` 可一个不选
- 「检测到」判定:src/core/agents/index.ts:187-194(`isAgentDetected`)= 配置目录存在 ∨ `profile.cliCommands` 任一在 PATH(`claude`、`codebuddy`)
- 「已装 cgraphx」判定:src/core/agents/index.ts:162-173(`isAgentInstalled`)= settings 有 cgraphx hook / statusLine 标记,或指引文件含 cgraphx 块标记
- 调用链收敛:`isAgentDetected` 唯一消费方 targets/agent-target.ts:137 的 `detect()`;`detect().detected` 唯一消费方即交互默认值(agent-steps.ts:93)
- 静默路径已按「已装」口径:agent-steps.ts:47-49(`installedTargetsOrDefault`,一个没装过取 claude-code),不受影响
- 「没勾但已装要卸掉」:installer/index.ts:145-151 与 agent-steps.ts:63-70(`unselectedInstalledTargets`),spec:2026-11-07-安装只留选中的agent——默认勾选必须覆盖全部已装的(K2),否则回车即误卸
- agent 登记目前两个:src/core/agents/profiles.ts(claude-code、codebuddy),`configDirName` 分别为 `.claude`、`.codebuddy`
- 上个需求产物:docs/features/2026-11-07-安装只留选中的agent/
