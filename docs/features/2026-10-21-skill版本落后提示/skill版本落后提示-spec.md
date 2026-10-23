# 规格说明: skill 版本落后提示

> 产物: spec
> feature-id: 2026-10-21-skill版本落后提示
> 负责人: liulongfei
> 日期: 2026-10-21

## 功能方案

> 原样收录 clarify 终确认的功能方案;业务要变,回 clarify 改,再同步这一节。

**一句话**:原来升级 cgraphx 后,只有你当时所在的那个项目会刷新,其他项目还用着旧版 skill,也没有任何提示。这次让装了会话 hook 的项目(`install -y`、`upgrade` 默认都会装)在新开会话时发现自己的 skill 落后,由 agent 在第一句回复里提示更新命令;安装时把版本记进项目。

用户会这样用:

    升级本机 cgraphx(npm i -g 或 cgraphx upgrade)
          │
          ▼
    打开任一已接入的项目,新开会话
          │
          ├── 项目记录和本机版本一致 ──→ 什么都不说
          │
          └── 项目记录落后 / 没有记录 ──→ agent 第一句回复提示更新命令
                                              │
                                              ▼
                                    跑 cgraphx install -y ──→ 记录对齐 ──→ 下个会话不再提示

| 编号 | 功能点 | 类别 | 行为链(已锁定) | 边界 | 落地依据 |
|---|---|---|---|---|---|
| F1 | 会话开始时提示项目 skill 落后 | 核心 | 新开会话 → agent 第一句回复说「这个项目的 cgraphx skill 还是 2.0.9,本机 cgraphx 已经是 2.0.11。运行 cgraphx install -y 更新(只覆盖 cgraphx 自带的文件),新开会话后生效。」→ 跑完命令,下个会话不再提示 | ① 版本一致不提示 ② 一个会话只在开头提示一次,不更新就每个新会话都提示 ③ 改过 cgraphx 自带的 skill,更新时会被覆盖 ④ 检查本身出错不提示,也不影响会话 ⑤ 没装会话 hook 的项目、设了 `CGRAPHX_NO_TIMELINE` 的会话,收不到提示 | 会话开始 hook 调用的是全局 cgraphx,老项目不用重装就会跑新代码;提示文案明确要求 agent 在第一句回复里告诉用户;提示和会话 id 合成同一段输出,不依赖没实测过的多段叠加 |
| F2 | 安装时记下项目 skill 的版本 | 支撑 | 跑 install 或 upgrade → 每个 agent 多输出一行「Claude Code: 项目 skill 已对齐到 2.0.11」→ 版本记录写进该 agent 的目录,跟着 skill 一起进 git | ① 老项目没有记录 → 提示措辞换成「这个项目的 cgraphx skill 是 2.0.11 之前装的」 ② 某个 agent 安装失败,不写它的记录 ③ 只重装一个 agent,只更新它的记录 ④ 记录比本机版本新,不提示 ⑤ 只比版本号,不比文件内容 | install 本来就往 `.claude/` 写 skill 和标记块;版本号是运行时从 package.json 读的;upgrade 会用新装的 CLI 跑 `install -y` |
| — | 跑 cgraphx 命令时也提示 | 建议新增 ✂️ | 不做:命令输出里反复提醒,违反「会话中途不插话」的约定。代价:不跑会话 hook 的 agent(如 DeepSeek Harness)、没装会话 hook 的项目、设了 `CGRAPHX_NO_TIMELINE` 的会话,都收不到提示 | — | — |
| — | 本机 cgraphx 比项目 skill 旧时反向提示 | 建议新增 ✂️ | 不做:按默认砍掉。代价:队友升级并提交 `.claude/` 后,你本机的旧版 cgraphx 不会被提醒 | — | — |
| — | 一条命令更新本机所有项目 | 边界外 | 不做:本机没有「接入过哪些项目」的登记,各项目打开时各自提示 | — | — |
| — | 会话开始时联网查 npm 新版本 | 边界外 | 不做:会话 hook 不发网络请求;想手动查用 `cgraphx upgrade --check` | — | — |
| — | 在 skill 里自检版本 | 边界外 | 不做:旧版 skill 里没有这段逻辑,改了也到不了老项目 | — | — |

**体验决策**:

- 提示之后由你决定什么时候更新,不会自动改 `.claude/`。
- 提示由 agent 在第一句回复里转述,文案会明确要求它这么做;不用界面直接显示。
- 版本记录放在 `.claude/` 里跟着 skill 走。`.claude/` 进 git 时,队友拉到新 skill 的同时也拉到新记录,不会被误提示;代价是每次升级 diff 多一行。

## 怎么实现

### 细节方案:F2 安装时记下项目 skill 的版本

| # | 决策 | 选择 | 没选的(为什么) | 理由(依据) | 影响面 |
|---|---|---|---|---|---|
| D1 🔒 | 版本记录的位置与格式 | 每个 agent 配置目录下的独立文件 `cgraphx-version.json`,只有一个字段:`{"version": "2.0.11"}` | 写进指引文件的 `CGRAPHX_START` 标记块——「已装」判断和卸载按标记原文匹配,改标记会让队友的旧版 cgraphx 认不出、重复插块,标记块还会进每次会话上下文;写进 settings.json——cgraphx 在 settings 里只写 hook 和 statusLine;多记安装时间——每次重装都产生 diff | `isAgentInstalled`(`src/core/agents/index.ts`);`removeMarkedSection`(`src/cli/installer/targets/agent-target.ts`) | 每个已接入项目多一个文件 |
| D2 | 写入时机 | agent 安装第 5 步部署模板资产成功后写,只在本地安装位置写;结果只加一条 note,不进文件变更列表 | 整个 install 结束后统一写——某个 agent 失败也会写上 | `install()` 第 5 步在 `loc === 'local'` 时部署资产;安装时每个资产文件都单独打印一行 | 安装输出只多 `<agent>: 项目 skill 已对齐到 <本机版本>` 一行 |
| D3 | 卸载 | `uninstall()` 第 4 步按清单删除自带资产时,一并删除版本记录 | 保留记录——资产已删,记录描述的东西不存在了 | `uninstall()` 第 4 步 `removeClaudeAssets` | 卸载输出多一行「已移除」 |
| D4 | 记录损坏 | 不存在、不是合法 JSON、缺字段、版本号不合法,一律按没有记录处理(F2①) | 损坏单独出一种文案——用户的处理方式相同(重跑 install) | — | 无 |

### 细节方案:F1 会话开始时提示项目 skill 落后

| # | 决策 | 选择 | 没选的(为什么) | 理由(依据) | 影响面 |
|---|---|---|---|---|---|
| D5 | 检查挂在哪 | `task-session-start-hook`:提示接在会话 id 那行后面,用换行连接,同一段 additionalContext 输出 | 新增 hook 命令——老项目的 settings 里没有,收不到;单独输出一段——CodeBuddy 下多段叠加没实测 | `taskSessionStartHook`(`src/core/task/hooks.ts`);知识库「平台上报」Open Questions | 有提示时会话开始上下文多一行 |
| D6 | 只接了 timeline hook 的早期项目 | `timeline-session-start-hook` 在该 agent 的 settings 里找不到 `cgraphx task-session-start-hook` 时,单独输出提示这一段;settings 读不出时不输出 | 只靠 task hook——只接了 timeline hook 的项目收不到;timeline hook 无条件输出——两个 hook 都在时出现两段 | task hook 在 2.0.0 之后加入(CHANGELOG 2.0.9 节);timeline `sessionStartHook` 原本 stdout 为空 | timeline 会话开始 hook 多读一次 settings |
| D7 | 哪些会话开始提示 | `source` 为 `startup` / `resume` / `clear` 或缺失时提示,`compact` 不提示(F1②) | 每次 SessionStart 都提示——压缩上下文时会在会话中途再说一次 | timeline 已按 `payload.source` 区分四种来源 | 无 |
| D8 | 转述要求 | 提示行以「cgraphx 提示(请在你的第一句回复里告诉用户):」开头 | 只陈述不要求转述——会话开始注入的会话 id 行,agent 收到后不会主动告诉用户(2026-10-21 在 Claude Code 会话中观察到) | 平台上报暂停提示只陈述(`src/core/sync/hooks.ts`) | 见下方文案 |
| D9 🔒 | 模块边界与依赖方向 | 新增 core 模块 `src/core/skill-version/`(门面 `index.ts`):读本机版本、比较版本、读写删版本记录、生成提示;只依赖 agents 门面,项目根由调用方传入。task、timeline 的 hook 与 cli 安装器经门面调用;`parseSemver` / `compareVersions` 从 `src/cli/upgrade/index.ts` 挪进本模块,upgrade 从 core 引入并原样转出 | 放进 task 子系统——timeline 和安装器也要用,会出现 timeline → task 的反向依赖;调用 sync 的 `getClientVersion`——task、timeline 依赖 sync 方向不对;另写一份版本比较——两份规则会漂移 | 分层约定:core 不依赖 cli,task → timeline / features 单向(CLAUDE.md);本机版本照 `src/core/sync/version.ts` 的读法 | 新增一个 core 模块 |

文案的技术包装(D8),逐字落地,改文案回 spec:

| 提示 | 文案 |
|---|---|
| A(F1) | `cgraphx 提示(请在你的第一句回复里告诉用户):这个项目的 cgraphx skill 还是 {版本记录},本机 cgraphx 已经是 {本机版本}。运行 cgraphx install -y 更新(只覆盖 cgraphx 自带的文件),新开会话后生效。` |
| B(F2①) | `cgraphx 提示(请在你的第一句回复里告诉用户):这个项目的 cgraphx skill 是 2.0.11 之前装的,本机 cgraphx 已经是 {本机版本}。运行 cgraphx install -y 更新(只覆盖 cgraphx 自带的文件),新开会话后生效。` |

### 全局约束

- 不新增 hook 命令,不改现有命令名:老项目的 settings 只认现有命令。
- 会话 id 那行原样保留,提示只接在它后面;sync 会话开始提示的输出不受影响。
- Claude 侧零变化:除「版本记录文件」「安装输出多一行」「有提示时会话开始上下文多一行」三处外,install / uninstall 的输出与写入文件、各 hook 的输出与改造前逐字节一致。
- 沿用两个 hook 的现有骨架:关闭开关直接返回;异常吞掉写 stderr,退出码为 0;本机版本读不到或不是合法版本号时不提示;不发网络请求、不拉起进程。
- 版本比较沿用 `compareVersions` 现有规则:主.次.修订逐段比较,带预发布后缀的低于同号正式版。
- 新模块不依赖 `src/cli`、`src/web`;只有 TS 源码,不涉及 `scripts/copy-assets.cjs`。

## 设计验收

| # | 对应 | 验收点 | 怎么验 |
|---|---|---|---|
| 1 | 全局约束 | Claude 侧零变化 | 按知识库「agent 适配」的方法:新旧 dist 在空 git 仓库里分别跑 `install -y`、`uninstall -y`,对比 `.claude/`、git 钩子和输出 |
| 2 | D6 | 只接了 timeline hook 的项目由 timeline 输出提示;两个 hook 都在时只出现一段 | 单元测试(构造 settings) |
| 3 | D7 | `compact` 不提示 | 单元测试;实测一次 |
| 4 | D4 | 记录损坏按没有记录处理 | 单元测试 |
| 5 | 全局约束 | 会话开始 hook 耗时在 50ms 预算内 | hook 自带的耗时告警不出现 |
| 6 | D8 | agent 在第一句回复里转述提示 | Claude Code、CodeBuddy 各开一次会话实测;不转述 → 回 clarify 重选「提示出现在哪」 |

## 待确认项

- 【待确认】首个写版本记录的发布版本号:默认 2.0.11(F2① 与提示 B 里的「2.0.11 之前装的」);发布号不同时文案随之改,不影响 plan 拆分。
