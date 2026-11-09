# 规格说明: DeepSeek 门禁与会话归属、看板流程命令、子会话标题

> 产物: spec
> feature-id: 2026-11-08-DeepSeek门禁与看板误挂
> 负责人: liulongfei
> 日期: 2026-11-08

## 功能方案

> 原样收录 clarify 的功能方案(讨论稿 v3,评审 4 选简化);业务要变,回 clarify 改,再同步这一节。

**一句话**:DeepSeek 的提交现在既不过门禁、也不记到它的会话上;看板把 `/dev-merge agent看板优化` 同时挂到「agent看板」和「agent看板优化」;DeepSeek 子会话起的标题盖掉了主会话自己的标题。这次让 DeepSeek 提交和另两家一样走门禁、记到会话上,流程命令只认命令后的第一个参数,子会话标题不再算到主会话上。

**功能清单**

| 编号 | 功能点 | 类别 | 从哪进 → 到哪去 | 一句话 |
|---|---|---|---|---|
| F1 | DeepSeek 提交走门禁、记到它的会话上 | 核心 | DeepSeek 会话里 `git commit` → 门禁放行 / 打回 → 提交记录进时间线 → 看板该任务下的会话(子会话里的提交看不到) | 门禁片段和会话识别认 `DSH_SESSION_ID`;提交记到会话(子会话记原始编号),看板按提交分支 / 需求目录挂任务;带 `--no-verify` 照旧标「跳过门禁」 |
| F2 | 看板流程命令只认第一个参数 | 核心 | 打开 / 刷新看板 → 左栏任务下挂哪些会话 | 命令后的第一个参数等于需求名 / feature-id / 副本目录名才算定挂;Skill 参数的首词或需求目录路径也算 |
| F3 | DeepSeek 子会话标题不归主会话 | 支撑 | 打开 / 刷新看板 → 右栏会话标题 | 子会话(如 knowledge-recall)的标题直接不记;已有错误标题在升级后第一次补录时重算回来 |
| — | 不动:DeepSeek 进安装器 / 副本、看板其他认任务依据、子会话的工具事实 | 边界外排除 | — | DeepSeek 仍不进安装器、不往项目里部署 `.dsh/`、不被带进副本;副本目录、提交分支 / 文件、写需求目录、消息里有需求路径、读过需求目录、消息提到需求名这几条依据不动;子会话的工具事实照旧归主会话 |

### F1 DeepSeek 提交走门禁、记到它的会话上(核心)

现在:DeepSeek 会话里让 agent 跑 `git commit` → 提交门禁的片段只认 Claude Code、CodeBuddy 两家的会话变量,一个都没有 → 不起来跑门禁 → 版本分支、产物检查、提交说明自查整段没跑,提交照常完成;提交后的后台记录同样认不出会话,这笔提交记成「未归属」——会话和来源都是空,看板挂不到这个会话,带 `--no-verify` 也标不出「跳过门禁」。本机 `cgraphx` 项目库里 57 条提交没有会话,其中就有 DeepSeek 会话里 `git commit` 的那几笔。

改后:DeepSeek 的会话变量也算数——有它就跑门禁,打回原文和另两家一样,打回才中止提交;没打回照旧写「过门禁」记号。提交后的后台记录把 `DSH_SESSION_ID` 的值原样当会话编号,这笔提交记到这个 DeepSeek 会话上;看板靠「提交在需求分支」「提交改了需求目录」两条(原来就有)把它挂到任务下。子会话里的提交记子会话原始编号,看板挂不到(见 K4)。

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
| K2 | 片段 · 起不起 node | 一个非空就起;全空不起(人手动提交不多等约 90 毫秒) | 算:任一变量有值;不算:三个都空 | 沿用提交门禁 spec 的 D11 |
| K3 | 记录 · 提交记到哪个会话 | 取 `DSH_SESSION_ID` 的值原样记;主会话是 `session-`/`od-` 开头,子会话是裸 uuid | 算:`session-7bbef4d0-9649-4c00-a857-b37aa60ef08a`(主会话,看板挂得上);算:`8736e67c-…`(子会话,原样记、看板挂不到,见 K4) | 实测 2026-11-08:主会话值 = 目录名 = 文件头 `id`;新定 |
| K4 | 记录 · 子会话里的提交算谁的 | 不找主会话,直接记子会话的原始编号(裸 uuid);门禁照常跑(子会话也带 `DSH_SESSION_ID`) | 算:在 knowledge-recall 这类子会话里提交 → 记 `8736e67c-…`,看板上这笔提交挂不到会话;不算:丢掉这笔提交、或去读会话文件找主会话 | 会话文件头的 `id`;新定(评审 4 选简化:2.0.15 子会话没提交过,先不读文件) |
| K5 | 看板 · 怎么挂任务 | 不改:提交的分支等于需求分支,或提交改到的文件里有 `docs/features/<需求目录>/` | 算:在 `fix/DeepSeek门禁与看板误挂` 上提交、改了 `docs/features/2026-11-08-DeepSeek门禁与看板误挂/…`;不算:改别的目录、别的分支 | `timeline_events.commit_files`、`metadata.branch`;沿用 K9②③ |
| K6 | 生效 · 什么时候开始拦 | 提交记到会话:升级后就生效;门禁拦住 DeepSeek 的提交:要在这个项目重跑一次 `cgraphx install`(片段里的变量名单是安装时写进去的) | 算:升级后在项目里跑一次 install;不算:只升级、不重装时,提交能记到会话,但门禁不拦 | 提交门禁 spec 的 D11「新登记 agent 要重装才进名单」;沿用 |
| K7 | 旁边 · 跳过门禁 | 片段的探针里有这家的会话变量(commit-msg 里带 marker 的行含 `${<变量>:-}`),且提交的 tree 与记号对不上 | 算:重装后 DeepSeek 带 `--no-verify` 提交;不算:人手动提交、片段里没有这家变量的(只升级没重装)、`/dev-merge` 的合并提交 | 沿 K16 |

**边界**:① 人手动提交(三个变量都没有)→ 不起 node,照旧不拦;② 门禁打回 → 提交中止、回显原文,和另两家一样;③ 门禁跑不起来(命令找不到、超时、自身异常)→ 放行,照旧;④ 只升级 cgraphx、没在这个项目重跑 `install` → 提交能记到会话,但 DeepSeek 的提交不过门禁,也不标「跳过门禁」;重装后带 `--no-verify` 才标;⑤ 在 DeepSeek 子会话里提交 → 记子会话原始编号,看板挂不到;门禁照常跑。

### F2 看板流程命令只认第一个参数(核心)

现在:人发 `/dev-merge agent看板优化` → 看板取命令后的全部参数「agent看板优化」,按「参数里任意位置出现需求名」算 → 「agent看板」也算命中 → 这个会话同时定挂到「agent看板」和「agent看板优化」两个任务上。Skill 调用的参数走同一条判定,也是「任意位置含需求名」。

改后:只取命令后的第一个参数(按空白分隔),和这个需求的三种名字比——任务标题、feature-id、副本目录名(`cgraphx@agent看板优化`)——**完整相等**才算流程命令定挂。`/dev-merge agent看板优化`、`/dev-merge 2026-11-07-agent看板优化`、`/dev-merge cgraphx@agent看板优化` 都只挂「agent看板优化」,不再挂「agent看板」。Skill 调用的参数:第一个词是这三种名字之一,或参数里有 `docs/features/<feature-id>/` 路径,也算(见 K11)。

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
:比对三种名字:任务标题 /\nfeature-id / 副本目录名; <<#FFF3B0>>
if (完整相等?) then (是) <<#FFF3B0>>
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
| K9 | 流程命令 · 算定挂 | 第一个参数与这个需求的任一名字**完整相等**:任务标题、feature-id、副本目录名;不按包含、不忽略标点、不忽略大小写 | 算:`/dev-merge agent看板优化`(标题)、`/dev-merge 2026-11-07-agent看板优化`(feature-id)、`/dev-merge cgraphx@agent看板优化`(副本目录名)都挂「agent看板优化」;不算:同一个 `/dev-merge agent看板优化` 挂到「agent看板」 | 任务标题 + feature-id(K10);新定 |
| K10 | 流程命令 · 认哪些名字 | 三种完整名字:① 任务标题(需求目录名去掉日期段);② feature-id(整串,带日期);③ 该需求的副本目录名(`<主目录名>@<文件前缀>`;同一需求有几个副本就几个名) | 算:`agent看板优化`、`2026-11-07-agent看板优化`、`cgraphx@agent看板优化`;不算:`agent看板`(另一个需求的名字);文件前缀不单独算——默认命名下它等于标题,自动算;有业务 ID 时文件前缀 ≠ 标题,那个前缀不算 | `docs/features/<需求目录>` 的标题与目录名、副本登记 `name`;新定 |
| K11 | 流程命令 · Skill 调用的参数 | 第一个词是 K10 的三种名字之一,或参数里出现 `docs/features/<feature-id>/`(带结尾 `/`);满足一个就算 | 算:`参数 "agent看板优化 按 spec…"`(首词是标题);`参数 "需求目录 docs/features/2026-11-07-agent看板优化/,按…"`(含需求目录);不算:`参数 "按 agent看板 的 spec 写计划"`(首词是「按」,也没有需求目录) | `timeline_events.tool_args`;新定 |

**边界**:① 命令没有参数(`/dev-merge`)→ 不算;② 需求名只是第一个参数的一部分(`/dev-merge agent看板优化` vs「agent看板」)→ 不算;③ 需求名里带空格 → 第一个词对不上,不算(现有需求目录名里没有空格);④ 命令后第一个参数不是任何名字、名字只出现在后面的(如 `/dev-spec docs/features/…`)→ 不算流程命令;Skill 参数里有需求目录路径的除外(见 K11),人发消息仍可靠 K9⑥「消息里有需求路径」挂上;⑤ Skill 调用的参数是 DeepSeek 那种 `{name:…}`、没有参数串 → 这条本来就不参与,不影响;⑥ feature-id、副本目录名都是完整名字,不会像标题前缀那样误挂——`/dev-merge agent看板优化` 只挂「agent看板优化」。

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
| K14 | 主会话标题的优先级 | 不变:custom > ai > agent,同级取新的 | 算:用户起的 custom 标题不被 agent 起的盖掉;主会话两条 agent 标题取新的「开副本时自动创建需求目录」 | 沿用看板 spec 的 D8 |
| K15 | 已有的错误标题 | 升级后第一次补录:本机还有会话文件的会话,标题表里那一行先删、再按新规则重算;会话文件已不在的会话保留原标题 | 算:`session-8497e739-…` 的「你是 knowledge-recall 子 agent。工」换成「开副本时自动创建需求目录」;不算:文件已被删的会话,标题照旧 | `timeline_session_titles`、`timeline_meta` 新记号;新定 |

**边界**:① 主会话自己没有标题、只有子会话有 → 主会话没有标题,看板退回「第一条人发消息前 40 字」;② 会话文件已经不在 → 标题保留旧值,不重算;③ 同一个会话既有主文件标题又有子会话标题 → 只算主文件的;④ 重算是一次性的,之后新增的标题照常增量写。

## 怎么实现

### 细节方案:F1 DeepSeek 提交走门禁、记到它的会话上

| # | 决策 | 选择 | 没选的(为什么) | 理由(依据) | 影响面 |
|---|---|---|---|---|---|
| D1 | 会话变量从哪来 | `SessionSource` 加 `sessionIdEnv`:claude-code / codebuddy 由 `AgentProfile.sessionIdEnv` 派生,deepseek 填 `DSH_SESSION_ID`;`resolveSessionIdFromEnv` 改成枚举 `listSessionSources()`,顺序 claude → codebuddy → deepseek;`SessionFromEnv.agent` 放宽到 `SessionSourceId`,并带出命中的 `sessionIdEnv`(跳过判定用) | 把 deepseek 加进 `AGENT_PROFILES`——安装器、副本会开始部署 `.dsh/`,破坏只读来源边界(全局约束) | `agents/sources.ts` 是会话来源登记处;知识库「agent 适配」明确只读来源不进 `AGENT_PROFILES` | 类型放宽;两家已有 agent 的解析结果不变;新增一个来源的环境变量 |
| D2 | 门禁片段的变量名单 | `agents` 门面新增 `listSessionIdEnvNames()`(全部会话来源);`commitGateSnippetLines` 用它,片段探针变成 `${CLAUDE_CODE_SESSION_ID:-}${CODEBUDDY_SESSION_ID:-}${DSH_SESSION_ID:-}` | 在 gate 里写死 `DSH_SESSION_ID`——以后再加来源要改两处 | `commit-gate/gate.ts:262-265` 现在从 `listAgentProfiles()` 取 | 片段内容变长;已装项目要重跑 `cgraphx install` |
| D3 | 片段什么时候换新 | 只在 `cgraphx install` 重写片段;`repairHookSnippets` 仍按登记的行补回、不换内容 | 给片段登记加版本、每次提交自检重写——为一条名单引入迁移状态,收益小 | `git-hooks.ts:501-511`(按 `entry.lines` 重装);提交门禁 spec 的 D11「新登记 agent 要重装才进名单」 | 升级后要在项目里重跑 install,DeepSeek 才被拦 |
| D4 | 会话提示侧 | `session-notices.ts` 用 `getAgentProfile(session.agent)` 取自己的描述;取不到(deepseek)时候选集改为 `listAgentProfiles()`、自动记忆提示只对 claude-code 生效;scope 仍用 `session:<会话编号>` | 继续 `requireAgentProfile`——DeepSeek 每条命令都抛错,被 catch 掉还打一行 stderr | `session-notices.ts:53-70`、`:98-108` | DeepSeek 提示从「每项目每天一次」变「每会话一次」 |
| D5 | 跳过门禁 · 片段里有本来源的变量? | `isGateSkipped(info, session)` 看 commit-msg 里带 `COMMIT_GATE_MARKER` 的行(说明行和探针行都带)里有没有 `${<sessionIdEnv>:-}`;没有 → 不标(这家门禁根本没跑),有才继续看 tree / 记号。`SessionFromEnv` 带 `sessionIdEnv` | 只看 marker——旧片段没有 DSH,DeepSeek 每笔提交都会被误标「跳过门禁」(评审 1);只对 DeepSeek 特判——另两家将来也会踩 | 评审意见 1;K16 的「片段在」应理解为「片段的探针覆盖这家」;`git-commit.ts:295-319` | 改 `isGateSkipped` 签名与测试;另两家已装片段里有各自变量,行为不变 |

跳过门禁的判定改 D5(不能只认 marker)。看板按提交挂任务(K5)沿用现有 K9②③,不改——这次只是让 DeepSeek 的提交第一次有会话编号、能被会话分组取到。

**接口契约(门禁片段)**

- 探针:`[ -n "${CLAUDE_CODE_SESSION_ID:-}${CODEBUDDY_SESSION_ID:-}${DSH_SESSION_ID:-}" ]`;有一个非空才调 `cgraphx commit-gate-hook "$1"`。
- 片段仍是一行(不能有真换行),每行带 `# cgraphx-commit-gate` marker;重装按 marker 先删旧行。
- 退出码:0 放行、3 打回;打回才 `exit 1` 并回显原文;`command not found`、超时、异常都放行。
- 变量顺序即拼接顺序:claude-code → codebuddy → deepseek;两个变量同时存在(DeepSeek 里跑 Claude Code)时仍取 Claude 的。
- 片段里必须有本来源的变量探针(`${<sessionIdEnv>:-}`);旧片段没有 → 这家门禁不跑,也不标「跳过门禁」(D5)。

**会话变量契约**

- `DSH_SESSION_ID`:主会话是 `session-<uuid>`(本机还有 `od-<uuid>`),子会话是裸 `<uuid>`;值等于会话文件头的 `id`,也等于会话目录名。
- 子会话 id 按原值记(不转根、不读会话文件);会话提示 scope 等也用变量原值,与另两家一致。看板上子会话里的提交挂不到会话。
- 解析顺序不变:一个都取不到 → 未归属(人手动提交);git 钩子调起的进程能继承这些变量(本机实测)。

**迁移与兼容(F1)**

- 提交记录认会话:升级 cgraphx 即生效(`timeline-git-commit-hook` 是新代码),不需要重装钩子。
- 门禁拦截 DeepSeek:必须在这个项目重跑 `cgraphx install` 换片段(D3);旧片段里没有 `DSH_SESSION_ID`,DeepSeek 提交照旧不拦、也不标「跳过门禁」,归属不丢。
- 重装后才拦;这时带 `--no-verify` 的提交才会标「跳过门禁」。

### 细节方案:F2 看板流程命令只认第一个参数

| # | 决策 | 选择 | 没选的(为什么) | 理由(依据) | 影响面 |
|---|---|---|---|---|---|
| D6 | 匹配算法 | 新增 `firstWord(text)`(trim 后按空白切第一个词);`TaskContext` 加 `flowNames`(任务标题、feature-id、该需求各副本目录名,去空);人发消息取 `FLOW_COMMAND_PATTERN` 的第一个参数、Skill 取 `tool.args` 的第一个词,命中 `flowNames` 就算;Skill 另加 `tool.args.includes(task.prefix)`(=`docs/features/<feature-id>/`)也算 | 保留 `includes`——`/dev-merge agent看板优化` 会同时挂两个任务;只认标题——`/dev-merge 2026-11-07-…`、`/dev-merge cgraphx@…` 会丢掉流程命令依据(评审 2) | `board/match.ts:151-164`;K8–K11;副本登记 `ReplicaRef.name` | 纯函数,现算,不改库、不回填 |
| D7 | 标点、大小写、名字范围 | 不归一化:不去尾标点、不忽略大小写、不把全角空格当分隔;三种名字都是完整名字,不做前缀匹配 | 去尾标点 / 归一化——用户明确要「完整相等」;只认标题——见 D6;按前缀匹配——会把 `agent看板优化` 误挂到 `agent看板` | K9、K11;`agent看板-spec.md:178`(看板 spec 的 D14) | 带标点的旧写法会少挂,靠其他依据兜底 |
| D8 | 测试 | 改 C5:prompt 正例保留;Skill 正例改成参数以名字开头;新增 feature-id / 副本目录名各一条正例、`agent看板` 前缀负例、Skill 参数含需求目录路径正例、无参数、空名字 | 只改实现不改测试——旧测试锁死旧口径 | `__tests__/core/board/match.test.ts:82-94` | 测试 |

`FLOW_COMMAND_PATTERN`(`constants.ts:36`)形状不变,只改比较;看板仍是每次补录后现算、不写绑定。K10 从「只认任务标题」扩成「标题 / feature-id / 副本目录名」,见 D6。

### 细节方案:F3 DeepSeek 子会话标题不归主会话

| # | 决策 | 选择 | 没选的(为什么) | 理由(依据) | 影响面 |
|---|---|---|---|---|---|
| D9 | 子会话标题不产 | `deepseek-session.ts` 的 `handleSessionTitle` 开头 `if (s.isChild) return;`;子会话的会话头 / 工具事实照旧归根 | 在 `titleUpserts` 里过滤——那里没有「子会话」标记,得给 fact 加字段,改动面更大 | `deepseek-session.ts:430-437`、`:199-211`;K12 | 读取器少产一类标题事实 |
| D10 | 已有错误标题重算 | 新的一次性记号 `session_titles_refresh_at`:在 `ensureTimelineUpToDate` 的标题回填之后跑一次;只跑来源 id 为 `deepseek` 的文件(常量 `TITLE_REFRESH_SOURCE_ID`);对每个归属本项目的文件从偏移 0 读一遍,收 `session_head` 的会话编号(covered)和标题事实;一个事务里 `DELETE FROM timeline_session_titles WHERE session_id IN covered` 再 `upsertSessionTitle`;写记号 | (a) 全量重建——会把事件也重写,代价大;(b) 删全部标题——文件已不在的会话会丢标题;(c) 按会话映射能力选来源——两件不相干的事绑在一起(评审 5) | 现有 `backfillSessionTitles`(`ingest.ts:155-212`)、`commitRebuild`(`rebuild.ts:259-269`);评审 5 | 升级后第一次补录多读一遍 DeepSeek 文件(本机 213 个);一次 |
| D11 | 回填 / 重建与新记号 | `backfillSessionTitles` 和 `commitRebuild` 写完 `session_titles_at` 的同时写 `session_titles_refresh_at`(它们已按新规则读过全部文件);老项目只缺新记号时才重算 | 不写——新项目会白重算一遍 | `ingest.ts:188`、`rebuild.ts:271`、`:325` | 一次读盘 |
| D12 | 重算失败 | 与回填同:不写记号、返回一句提示,下一趟重试;读不出的文件跳过、旧行保留;来源不可用(旧 Node)不写记号 | 静默——错标题一直留着没人知道 | `backfillSessionTitles` 的 catch | — |

**数据格式**:`timeline_session_titles(session_id 主键, title, kind, ts)` 不变,不升 `TIMELINE_SCHEMA_VERSION`;新增的只是 `timeline_meta` 的键。标题一律经 `upsertSessionTitle` 写;优先级 custom > ai > agent、同级取新(K14)沿用看板 spec 的 D8,不改。

K15 的「本机还有会话文件的会话」这次只涉及 DeepSeek:子会话标题只有 DeepSeek 读取器会产;另两家的标题行不删、不重算(评审 5 的收窄)。

**迁移与兼容(F3)**

- 老项目(已有 `session_titles_at`、没有新记号):升级后第一次补录跑一次重算,把现在错的 6 条改回来;之后靠记号跳过。
- 新项目 / 刚重建过的项目:回填 / 重建顺手写新记号,不额外读盘。
- 降级到旧版 cgraphx:旧版不认新记号,也不会重算;旧版读取器会把子会话标题重新写回(行为回到旧版),属可接受的降级。

### 全局约束

- `AGENT_PROFILES` / `AgentId` / `parseAgentList('all')` 不变;DeepSeek 仍不进安装器、副本、`.dsh/` 部署。
- Claude Code / CodeBuddy 的会话 id 解析、门禁判定顺序、退出码不变;`isGateSkipped` 只多一道「片段里有没有本来源的变量」,两家已装片段里都有各自的变量,行为不变。
- 旧版片段(没有 `DSH_SESSION_ID` 探针)下,DeepSeek 提交既不拦、也不标「跳过门禁」;重装后两者才都有。
- `FLOW_COMMAND_PATTERN` 形状不变,只改比较;看板仍然是纯函数现算、不写绑定。
- `timeline_session_titles` 表结构不变,不升 `TIMELINE_SCHEMA_VERSION`;标题只经 `upsertSessionTitle` 写。
- `CGRAPHX_NO_TIMELINE` 仍然停补录、重建和标题重算;补录失败只出提示、不影响查询退出码和 stdout。
- 提交记录「钩子当下固定 hash / 分支」的约定不变(`git-commit.ts` 头注释)。

## 设计验收

| # | 对应 | 验收点 | 怎么验 |
|---|---|---|---|
| 1 | D1 | `resolveSessionIdFromEnv({DSH_SESSION_ID})` → `{ agent: 'deepseek', sessionIdEnv: 'DSH_SESSION_ID' }`;与 Claude 变量同时存在时仍取 Claude | 单元测试(改 `deepseek-zero-change.test.ts` G1) |
| 2 | D2 | `installCommitGate` 写出的片段含三个变量、`sh -n` 通过、人手动提交(三个变量都清掉)不起 node | 临时仓库集成测试(改 `snippet-reinstall.test.ts` 的 `SESSION_VARS`,加 `DSH_SESSION_ID`) |
| 3 | D1 | DeepSeek 主会话提交 → `session_id` 等于 `DSH_SESSION_ID` | 单元测试(临时仓库 + `DSH_SESSION_ID`) |
| 4 | D2 | DeepSeek 提交带会话变量、假 cgraphx 退出 3 → 提交中止;退出 0 → 写记号 | 临时仓库集成测试 |
| 5 | D4 | DeepSeek 会话里跑 `cgraphx` 不出现 `skill version notice failed`;scope 是 `session:<编号>` | 单元测试 |
| 6 | D6/D7 | `/dev-merge agent看板优化` 只挂 `agent看板优化`、不挂 `agent看板`;feature-id / 副本目录名同样挂得上;Skill 参数以名字开头或含需求目录路径才算;`/dev-merge` 不算 | 单元测试(改 C5、加负例) |
| 7 | D9 | DeepSeek 子会话文件不再产 `session_title`;工具 / 会话头仍归主会话 | 单元测试(改 A3) |
| 8 | D10/D11 | 先写一条子会话标题行,再跑 `ensureTimelineUpToDate` → 行改成主会话自己的标题;文件已删除的会话标题保留;记号写了不再重算 | 单元测试(照 `session-titles.test.ts` B4) |
| 9 | 全局 | `listAgentProfiles()` / `parseAgentList('all')` / 安装器与副本目标集不变 | 现有 `deepseek-zero-change.test.ts` 改 G1、保留 G2 |
| 10 | 全局 | `CGRAPHX_NO_TIMELINE=1` 时不读也不写标题重算 | 单元测试 |
| 11 | D5 | 旧片段(只有 `CLAUDE_CODE_SESSION_ID`/`CODEBUDDY_SESSION_ID`)+ DeepSeek 提交 → 不标 `gate=skipped`;把片段换成含 `DSH_SESSION_ID` 的 + 这笔提交 tree 对不上记号 → 标 | 临时仓库集成测试(改 `git-commit-hook-env.test.ts` 的假片段与调用参数) |

## 待确认项

无。

