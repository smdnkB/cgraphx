# 功能方案: DeepSeek 门禁与会话归属、看板流程命令、子会话标题(讨论稿 v1)

> 讨论稿,不是契约:人终确认的那一版由 `/dev-spec` 原样收录为 spec 第一节,之后以 spec 为准,本文件不再维护。

**一句话**:DeepSeek 的提交现在既不过门禁、也不记到它的会话上;看板把 `/dev-merge agent看板优化` 同时挂到「agent看板」和「agent看板优化」;DeepSeek 子会话起的标题盖掉了主会话自己的标题。这次让 DeepSeek 提交和另两家一样走门禁、记到会话上,流程命令只认命令后的第一个参数,子会话标题不再算到主会话上。

**功能清单**

| 编号 | 功能点 | 类别 | 从哪进 → 到哪去 | 一句话 |
|---|---|---|---|---|
| F1 | DeepSeek 提交走门禁、记到它的会话上 | 核心 | DeepSeek 会话里 `git commit` → 门禁放行 / 打回 → 提交记录进时间线 → 看板该任务下的会话 | 门禁片段和会话识别认 `DSH_SESSION_ID`;提交记到会话,看板按提交分支 / 需求目录挂任务;带 `--no-verify` 照旧标「跳过门禁」 |
| F2 | 看板流程命令只认第一个参数 | 核心 | 打开 / 刷新看板 → 左栏任务下挂哪些会话 | 命令后的第一个参数与需求名完整相等才算定挂,不再按「参数里任意位置出现需求名」算 |
| F3 | DeepSeek 子会话标题不归主会话 | 支撑 | 打开 / 刷新看板 → 右栏会话标题 | 子会话(如 knowledge-recall)的标题直接不记;已有错误标题在升级后第一次补录时重算回来 |
| — | 不动:DeepSeek 进安装器 / 副本、看板其他认任务依据、子会话的工具事实 | 边界外排除 | — | DeepSeek 仍不进安装器、不往项目里部署 `.dsh/`、不被带进副本;副本目录、提交分支 / 文件、写需求目录、消息里有需求路径、读过需求目录、消息提到需求名这几条依据不动;子会话的工具事实照旧归主会话 |

### F1 DeepSeek 提交走门禁、记到它的会话上(核心)

现在:DeepSeek 会话里让 agent 跑 `git commit` → 提交门禁的片段只认 Claude Code、CodeBuddy 两家的会话变量,一个都没有 → 不起来跑门禁 → 版本分支、产物检查、提交说明自查整段没跑,提交照常完成;提交后的后台记录同样认不出会话,这笔提交记成「未归属」——会话和来源都是空,看板挂不到这个会话,带 `--no-verify` 也标不出「跳过门禁」。本机 `cgraphx` 项目库里 57 条提交没有会话,其中就有 DeepSeek 会话里 `git commit` 的那几笔。

改后:DeepSeek 的会话变量也算数——有它就跑门禁,打回原文和另两家一样,打回才中止提交;没打回照旧写「过门禁」记号。提交后的后台记录把 `DSH_SESSION_ID` 的值当会话编号,这笔提交记到这个 DeepSeek 会话上;看板靠「提交在需求分支」「提交改了需求目录」两条(原来就有)把它挂到任务下。子会话里的提交归它发起的主会话(见 K4)。

**图 1 改后:一次 DeepSeek 提交**

```plantuml
@startuml
skinparam backgroundColor #FFFFFF
skinparam Activity {
  BackgroundColor #F1F1F1
  BorderColor #181818
  FontColor #000000
}
skinparam Swimlane {
  BorderColor #181818
  TitleBackgroundColor #FFFFFF
  TitleFontColor #000000
}
skinparam ArrowColor #181818

|DeepSeek 会话|
start
:在会话里执行 git commit;
|git 钩子(commit-msg)|
-[#2E7D32,bold]->
:看会话变量:\nCLAUDE_CODE_SESSION_ID /\nCODEBUDDY_SESSION_ID /\nDSH_SESSION_ID; <<#FFF3B0>>
if (有一个非空?) then (否)
  :① 不起 node\n按人手动提交放行;
  stop
else (是)
  -[#2E7D32,bold]->
  |cgraphx 门禁|
  :按顺序查:版本分支 →\n合并收尾 → 无暂存 →\n产物检查 → 提交说明自查;
  note right
    门禁跑不起来(命令找不到、
    超时、自身异常)→ 放行,
    与现在一样
  end note
  if (打回?) then (是)
    :② 退出码 3\n提交中止,回显打回原文;
    stop
  else (否)
    :写「过门禁」记号;
    -[#2E7D32,bold]->
    |git 钩子(post-commit)|
    :前台读走记号并删掉;
    -[#2E7D32,bold]->
    |时间线 / 看板|
    :后台记下这笔提交\n会话 = DSH_SESSION_ID; <<#FFF3B0>>
    :看板计算:按提交分支 /\n提交改到的需求目录挂到任务;
    stop
  endif
endif
@enduml
```

**图 1 的口径**

| 编号 | 哪一步 | 怎么判定 | 算 / 不算(例子) | 依据 |
|---|---|---|---|---|
| K1 | 片段 · 哪些算 agent 提交 | 三个会话变量任一非空就跑门禁:`CLAUDE_CODE_SESSION_ID`、`CODEBUDDY_SESSION_ID`、`DSH_SESSION_ID` | 算:DeepSeek 会话里 `git commit`(`DSH_SESSION_ID=session-7bbef4d0-9649-4c00-a857-b37aa60ef08a`);不算:终端里人自己提交(三个都空) | 会话来源登记(环境变量名);新定 |
| K2 | 片段 · 起不起 node | 一个非空就起;全空不起(人手动提交不多等约 90 毫秒) | 算:任一变量有值;不算:三个都空 | 沿用 D11 |
| K3 | 记录 · 提交记到哪个会话 | 取 `DSH_SESSION_ID` 的值,它等于会话文件头的会话编号,也等于会话目录名 | 算:`session-7bbef4d0-9649-4c00-a857-b37aa60ef08a`(主会话);不算:子会话文件里那种裸 uuid(见 K4) | 实测 2026-11-08:主会话值 = 目录名 = 文件头 `id`;新定 |
| K4 | 记录 · 子会话里的提交算谁的 | 归发起它的主会话(顺着会话文件头的 `parentSession` 往上找),不记子会话编号 | 算:在 knowledge-recall 这类子会话里提交 → 记到主会话 `session-8497e739-…`;不算:记到子会话编号 `8736e67c-…`(看板没有这个会话,等于记不到) | 会话文件头 `parentSession`;新定 |
| K5 | 看板 · 怎么挂任务 | 不改:提交的分支等于需求分支,或提交改到的文件里有 `docs/features/<需求目录>/` | 算:在 `fix/DeepSeek门禁与看板误挂` 上提交、改了 `docs/features/2026-11-08-DeepSeek门禁与看板误挂/…`;不算:改别的目录、别的分支 | `timeline_events.commit_files`、`metadata.branch`;沿用 K9②③ |
| K6 | 生效 · 什么时候开始拦 | 提交记到会话:升级后就生效;门禁拦住 DeepSeek 的提交:要在这个项目重跑一次 `cgraphx install`(片段里的变量名单是安装时写进去的) | 算:升级后在项目里跑一次 install;不算:只升级、不重装时,提交能记到会话,但门禁不拦 | D11「新登记 agent 要重装才进名单」;沿用 |
| K7 | 旁边 · 跳过门禁 | 现在能标出 DeepSeek 带 `--no-verify` 的提交(有会话变量、片段在、提交的 tree 与记号对不上) | 算:agent 带 `--no-verify` 提交;不算:人手动提交、`/dev-merge` 的合并提交 | 沿 K16 |

**边界**:① 人手动提交(三个变量都没有)→ 不起 node,照旧不拦;② 门禁打回 → 提交中止、回显原文,和另两家一样;③ 门禁跑不起来(命令找不到、超时、自身异常)→ 放行,照旧;④ 只升级 cgraphx、没在这个项目重跑 `install` → 提交能记到会话,但 DeepSeek 的提交不过门禁;⑤ 在 DeepSeek 子会话里提交 → 按 K4 归主会话。

### F2 看板流程命令只认第一个参数(核心)

现在:人发 `/dev-merge agent看板优化` → 看板取命令后的全部参数「agent看板优化」,按「参数里任意位置出现需求名」算 → 「agent看板」也算命中 → 这个会话同时定挂到「agent看板」和「agent看板优化」两个任务上。Skill 调用的参数走同一条判定,也是「任意位置含需求名」。

改后:只取命令后的第一个参数(按空白分隔)和需求名比,**完整相等**才算流程命令定挂。`/dev-merge agent看板优化` 只挂「agent看板优化」;`/dev-merge 安装默认勾选已配置的agent` 照旧挂「安装默认勾选已配置的agent」。Skill 调用的参数同样按「第一个词完整相等」判(见 K11)。

**图 2 改后:一条命令算不算这个任务的流程命令**

```plantuml
@startuml
skinparam backgroundColor #FFFFFF
skinparam Activity {
  BackgroundColor #F1F1F1
  BorderColor #181818
  FontColor #000000
}
skinparam Swimlane {
  BorderColor #181818
  TitleBackgroundColor #FFFFFF
  TitleFontColor #000000
}
skinparam ArrowColor #181818

|看板计算|
start
:补录后现算,取一条会话事件;
:人发消息以 /命令 开头,或\nSkill 调用带参数; <<#FFF3B0>>
:取第一个参数(按空白分隔); <<#FFF3B0>>
if (第一个参数 == 需求名?) then (是) <<#FFF3B0>>
  -[#2E7D32,bold]->
  :定挂,依据「流程命令」;
  stop
else (否)
  :这条不按流程命令挂\n其他依据照旧;
  stop
endif
@enduml
```

**图 2 的口径**

| 编号 | 哪一步 | 怎么判定 | 算 / 不算(例子) | 依据 |
|---|---|---|---|---|
| K8 | 流程命令 · 命令形状 | 消息以 `/命令` 开头,后面跟参数;取命令后按空白分隔的第一个参数 | 算:`/dev-merge 订单导出` 的第一个参数是「订单导出」;不算:`/dev-merge`(没有参数) | `prompt_text`;沿用 `^/[a-z][\w-]*\s+(.+)` |
| K9 | 流程命令 · 算定挂 | 第一个参数与任务的需求名**完整相等**:不按包含、不忽略标点、不忽略大小写 | 算:`/dev-merge 安装默认勾选已配置的agent` → 任务「安装默认勾选已配置的agent」;`/dev-merge agent看板优化` → 任务「agent看板优化」;不算:同一个 `/dev-merge agent看板优化` 挂到「agent看板」 | 任务标题(K10);新定 |
| K10 | 需求名取哪个 | 任务标题(需求目录名去掉日期段),不是 feature-id、不是文件前缀 | 算:`2026-11-06-agent看板` → 「agent看板」;不算:`2026-11-06-agent看板` 整串、`agent看板-spec.md` | `docs/features/<需求目录>` 的标题;沿用 |
| K11 | Skill 调用的参数 | 同样只看第一个词、与需求名完整相等 | 算:`Skill(dev-merge, 参数 "agent看板优化")` → 只挂「agent看板优化」;不算:`参数 "按 agent看板 的 spec 写计划"` 里的「agent看板」;`参数 "agent看板:收录…"` 的第一个词是「agent看板:」,也不相等 | `timeline_events.tool_args`;新定 |

**边界**:① 命令没有参数(`/dev-merge`)→ 不算;② 需求名只是第一个参数的一部分(`/dev-merge agent看板优化` vs「agent看板」)→ 不算;③ 需求名里带空格 → 第一个词对不上,不算(现有需求目录名里没有空格);④ 命令后第一个参数不是需求名、需求名出现在后面的(`/dev-spec docs/features/…`)→ 不算流程命令,仍可靠「消息里有需求路径」等其他依据挂上;⑤ Skill 调用的参数是 DeepSeek 那种 `{name:…}`、没有参数串 → 这条本来就不参与,不影响。

### F3 DeepSeek 子会话标题不归主会话(支撑)

现在:DeepSeek 子会话(如 knowledge-recall)也会起标题 → 标题按「子会话的事实都归主会话」落到主会话编号上 → 标题表「同级取新」,子会话标题比主会话自己的晚 → 主会话显示成子会话的标题。`session-8497e739-…` 现在显示「你是 knowledge-recall 子 agent。工」,它自己的标题是「开副本时自动创建需求目录」。本机 `cgraphx` 项目库 31 条标题里有 6 条是子会话的标题。

改后:子会话的标题直接不记,标题表只收主会话自己的标题;主会话的优先级不变(custom > ai > agent,同级取新)。升级后第一次补录时,把本机还有会话文件的会话标题按新规则重算一遍——现在错的 6 条会自己改回来;会话文件已经不在的会话保留原来的标题。

**图 3 改后:一条会话标题记不记**

```plantuml
@startuml
skinparam backgroundColor #FFFFFF
skinparam Activity {
  BackgroundColor #F1F1F1
  BorderColor #181818
  FontColor #000000
}
skinparam Swimlane {
  BorderColor #181818
  TitleBackgroundColor #FFFFFF
  TitleFontColor #000000
}
skinparam ArrowColor #181818

|DeepSeek 会话文件|
start
:补录读到标题行;
:看这个文件的会话头; <<#FFF3B0>>
if (origin = subagent?) then (是) <<#FFF3B0>>
  :子会话的标题丢掉; <<#FFF3B0>>
  stop
else (否)
  |标题表|
  :按 custom > ai > agent、\n同级取新写入;
  :看板显示主会话自己的标题;
  stop
endif
@enduml
```

**图 3 的口径**

| 编号 | 哪一步 | 怎么判定 | 算 / 不算(例子) | 依据 |
|---|---|---|---|---|
| K12 | 哪些标题算子会话 | 会话文件头 `origin = subagent` 的算子会话;续接主会话(`isSeeded=true`、`delegationDepth=0`)不算,各算一行 | 算:`8736e67c-…`(`parentSession = session-8497e739-…`);不算:`session-8497e739-…` 自己 | 会话文件头 `origin`、`parentSession`;沿用 |
| K13 | 子会话标题的去向 | 直接不产标题,不写标题表 | 算:knowledge-recall 子会话的「你是 knowledge-recall 子 agent。工」;不算:主会话的「开副本时自动创建需求目录」 | 新定 |
| K14 | 主会话标题的优先级 | 不变:custom > ai > agent,同级取新的 | 算:用户起的 custom 标题不被 agent 起的盖掉;主会话两条 agent 标题取新的「开副本时自动创建需求目录」 | 沿用 D8 |
| K15 | 已有的错误标题 | 升级后第一次补录:本机还有会话文件的会话,标题表里那一行先删、再按新规则重算;会话文件已不在的会话保留原标题 | 算:`session-8497e739-…` 的「你是 knowledge-recall 子 agent。工」换成「开副本时自动创建需求目录」;不算:文件已被删的会话,标题照旧 | `timeline_session_titles`、`timeline_meta` 新记号;新定 |

**边界**:① 主会话自己没有标题、只有子会话有 → 主会话没有标题,看板退回「第一条人发消息前 40 字」;② 会话文件已经不在 → 标题保留旧值,不重算;③ 同一个会话既有主文件标题又有子会话标题 → 只算主文件的;④ 重算是一次性的,之后新增的标题照常增量写。

---

以下供 spec 使用,可不细读。

**必须在 spec 前解决的问题**

无。

**后续阶段的决策**

- 重算标题时用的那句话(「会话标题按新规则重算」)要不要出现在命令输出里;默认不出,只在失败时提示。

**已锁定技术约束**

- 用户声明:① 提交门禁片段和会话识别要认 DeepSeek 的 `DSH_SESSION_ID`,先核对它和会话文件编号是否一致,让 DeepSeek 的提交过门禁、记到它的会话上;② 看板「流程命令」只在命令后第一个参数等于需求名时才算定挂,不再按任意位置出现需求名算;③ DeepSeek 子会话的标题不算到主会话上。
- 已核对(2026-11-08 本机实测):主会话 `DSH_SESSION_ID=session-7bbef4d0-9649-4c00-a857-b37aa60ef08a`,与会话目录名、会话文件头 `id` 完全一致;子会话的 `DSH_SESSION_ID` 是裸 uuid(`dd8be8e6-…`),文件头 `origin=subagent`、`parentSession` 指向主会话;commit-msg 与 post-commit 钩子子进程都继承这个变量。
- 用户确认(2026-11-08):K4 子会话里的提交归发起它的主会话;K11 Skill 调用参数与人发消息同一口径(第一个词完整相等,`agent看板:` 这种带冒号的写法不算流程命令)。
- 兼容性:DeepSeek 仍不进 `AGENT_PROFILES`、不进安装器与副本;`-t all` / `install` 的 agent 目标集不变。

**留给 spec 的细节决策**

- `DSH_SESSION_ID` 登记在哪:`SessionSource` 加 `sessionIdEnv` 字段(deepseek 填 `DSH_SESSION_ID`,claude/codebuddy 由 profile 派生),`resolveSessionIdFromEnv` 枚举来源并按登记顺序取第一个非空;`SessionFromEnv.agent` 类型放宽到 `SessionSourceId`。门禁片段改从「全部会话来源」取变量名单(现在是 `listAgentProfiles()` 的 `sessionIdEnv`)。
- `resolveSessionIdFromEnv` 会话提示侧的影响:`session-notices.ts` 的 `requireAgentProfile(session.agent)` 遇到 `deepseek` 会抛错(现在被 try/catch 吞掉但会打一行 stderr)。DeepSeek 会话里版本提示 / 自动记忆提示的候选集改成 `listAgentProfiles()`,自动记忆提示只对 claude-code 生效;提示 scope 随会话编号从 `day:<项目根>:<日期>` 变成 `session:<会话编号>`——DeepSeek 里从「每项目每天一次」变成「每会话一次」(与另两家一致)。
- 子会话提交归主会话(K4):在 agents 的 deepseek 来源上加一个「会话 id → 根主会话 id」的解析(读会话文件头、顺 `parentSession` 链),供 `timeline/git-commit.ts` 用;解析不出就按原值记(不增益、不报错)。只在 post-commit 后台进程调用,不进 commit-msg 的前台路径。
- 门禁片段刷新:片段里的变量名单是安装时写进钩子文件的,`repairHookSnippets` 只按登记的行补回、不会换新内容;要生效必须重跑 `cgraphx install`(与 D11 同一条已知限制),不做自动升级。
- 流程命令匹配:`src/core/board/match.ts:154` 的 `params.includes(task.title)` 改成「取 `params` 的第一个空白分隔词,与 `title` 全等」;`Skill` 分支(`match.ts:159-163`)按 K11 的结论同样处理。`FLOW_COMMAND_PATTERN` 不用改。
- 标题重算:新的一次性记号(如 `session_titles_at_v2`),在 `ensureTimelineUpToDate` 的标题回填之后跑一次——拿 `ingest.lock`,按来源从偏移 0 只读标题事实,先删「本机还有会话文件的会话」那一行再 upsert;读不出标题的文件保留旧行。重建(`commitRebuild`)清空标题表时同事务写这个新记号。
- 知识库同步改:`docs/knowledge/会话id来源约束.md`(会话变量名单 / 「只读来源不进…门禁」)、`agent适配.md`(只读来源边界)、`开发时间线工具事件契约.md`(子会话「含标题」);spec/plan 阶段一并改。

**影响半径与风险**

- MEDIUM:碰到提交门禁(所有 agent 的提交路径)、看板认任务、时间线标题三处;不改表结构、不升 schema 版本。
- 风险 1:DeepSeek 提交从此会真被拦(版本分支 / 产物检查 / 自查),第一次用可能遇到之前没跑过的检查——这是目的,但要提前说。
- 风险 2:K11 选了严格,`/dev-spec agent看板:…` 这类带冒号的写法不再算流程命令;这些会话通常还有「消息里有需求路径」「写需求目录」等依据兜底,但只靠流程命令的会话会从任务下消失。
- 风险 3:标题重算第一次要重读本机全部会话文件(本机 213 个 DeepSeek 文件),项目大会拖慢升级后第一次打开看板;一次性。

**现实约束清单**

- 会话变量:src/core/agents/profiles.ts:16/37(`sessionIdEnv`)、src/core/agents/index.ts:112-120(`resolveSessionIdFromEnv`,只枚举 `AGENT_PROFILES`)、src/core/agents/sources.ts:131-143(deepseek 来源,没有会话变量字段)。
- 门禁片段变量名单:src/core/commit-gate/gate.ts:262-265;片段写法 gate.ts:245-251;现有钩子里的片段确实是 `${CLAUDE_CODE_SESSION_ID:-}${CODEBUDDY_SESSION_ID:-}`(本机 `.git/hooks/commit-msg` 核对)。
- 提交归属与「跳过门禁」:src/core/timeline/git-commit.ts:109-115(`resolveSessionIdFromEnv`)、295-308(`isGateSkipped`)。
- 会话提示:src/core/session-notices.ts:44-51(scope)、53-70(`requireAgentProfile(session.agent)`)、98-108。
- 看板流程命令:src/core/board/match.ts:151-164;模式 src/core/board/constants.ts:36;现有测试 __tests__/core/board/match.test.ts:82-94(C5)、`:22` 等用例;spec 定义 docs/features/2026-11-06-agent看板/agent看板-spec.md:128(K9⑤)、:178(D14)。
- 子会话规则:src/core/timeline/ingest/deepseek-session.ts:199-211(子会话判定)、287-303(归根)、430-437(`handleSessionTitle` 现在归根);事实契约 deepseek-session.ts:40-44、src/core/timeline/ingest/types.ts:86。
- 标题表与回填:src/core/timeline/schema.sql:69;src/core/timeline/store.ts:395-403(优先级 upsert);src/core/timeline/ingest/ingest.ts:132-212(`SESSION_TITLES_AT_KEY`、回填);src/core/timeline/ingest/rebuild.ts:259-269(重建并标题表)。
- 现有守护测试要改:__tests__/cli/installer/deepseek-zero-change.test.ts:22-26(G1 断言 `DSH_SESSION_ID` 不认会话,这次要反过来)、__tests__/core/timeline/deepseek-session.test.ts:109-128(A3 断言子会话标题归主会话)。
- 本机数据核对:DeepSeek 主会话值 = 目录名 = 文件头 id;子会话值 = 裸 uuid;`cgraphx` 项目库 57/462 条提交无会话、31 条标题里 6 条是子会话标题;2026-11-08T05:42:23 那条 `docs(features): agent看板优化…` 提交来自 DeepSeek 会话 `session-f588d2fd-…`,记成了未归属。
