# 规格说明: 安装只留选中的agent

> 产物: spec
> feature-id: 2026-11-07-安装只留选中的agent
> 负责人: liulongfei
> 日期: 2026-11-07

## 功能方案

> 小需求,没走讨论稿;方案在对话里给用户看过,用户 11-07 确认「按这样改」。

**一句话**:原来安装时没选的已装 agent 原样留着,配置停在旧版,还一直提示版本落后;这次改成选了哪些就只留哪些,没选的已装 agent 卸掉它的 cgraphx 配置,版本提示也说清是哪一家。

**功能清单**

| 编号 | 功能点 | 类别 | 从哪进 → 到哪去 | 一句话 |
|---|---|---|---|---|
| F1 | 安装只留选中的 agent | 核心 | `cgraphx install` → 安装结果 | 交互没勾、`-t` 没列的已装 agent,卸掉它的 cgraphx 配置 |
| F2 | 版本提示带上 agent 名 | 支撑 | 任一 cgraphx 命令 → 终端提示 | 「CodeBuddy 的 cgraphx skill 还是 2.0.13」 |

### F1 安装只留选中的 agent(核心)

行为链:在项目里 `cgraphx install` → 交互时选择框标题写明「已装的没勾会卸掉它的 cgraphx 配置」→ 选完照常装选中的 → 没选的已装 agent 卸掉 cgraphx 配置,每家一行「CodeBuddy:没选,已卸掉 cgraphx 配置(你自己的文件留着)」→ 其余步骤照旧。

边界:① `-y` 不带 `-t`(升级走这条)照旧更新所有已装的,不卸任何一家;② `-t none` 不动任何 agent 配置;③ 没选的 agent 本来就没装,什么都不做、不提示。

| 编号 | 哪一步 | 怎么判定 | 算 / 不算(例子) | 依据 |
|---|---|---|---|---|
| K1 | 哪些算「没选的已装 agent」 | 安装前已装 cgraphx 的 agent,不在这次选中的里面 | 算:装过 Claude Code、CodeBuddy,这次只勾 Claude Code → CodeBuddy;`-t claude-code` 同样。不算:`-y` 不带 `-t`;`-t none`;CodeBuddy 从没装过 | 已装判定沿用 `isAgentInstalled`(settings 里有 cgraphx 条目,或指引文件里有 cgraphx 段) |
| K2 | 卸掉什么 | 和 `cgraphx uninstall -t <它>` 一样,只删 cgraphx 自带的文件 | 删:skill、子 agent、命令、指引文件里 cgraphx 那一段、settings 里 cgraphx 的条目、版本记录。不删:用户自己放进 `.codebuddy/` 的文件、本地 `.cgraphx/`、项目数据、git 钩子 | 沿用 uninstall 的 `uninstallTargets` |

🎭 体验决策:不再追问确认,选择框标题写明后果,卸完逐家说一行。

### F2 版本提示带上 agent 名(支撑)

行为链:跑任一 cgraphx 命令 → 有一家装过的 agent 落后 → 提示「这个项目里 CodeBuddy 的 cgraphx skill 还是 2.0.13,本机 cgraphx 已经是 2.0.14。…」

## 怎么实现

### 细节方案:F1 安装只留选中的 agent

| # | 决策 | 选择 | 没选的(为什么) | 理由(依据) | 影响面 |
|---|---|---|---|---|---|
| D1 | 已装名单什么时候算 | 选 agent 之前、装之前,按 `isAgentInstalled` 逐家算,不带「都没装取 claude-code」的兜底 | 装完再算——选中的刚装上,分不出原来装没装;用 `selectInstalledAgents`——都没装时会把 claude-code 当成已装 | `src/core/agents/index.ts` 的 `isAgentInstalled`、`selectInstalledAgents` | 无 |
| D2 | 没选的怎么算 | 纯函数 `unselectedInstalledTargets(installed, selected, targetFlag)`:`-t none` → 空;其余 = 已装且不在选中里。`-y` 不带 `-t` 时选中就是全部已装,自然为空 | 在三条路径里各写一遍——规则散开 | `src/cli/installer/agent-steps.ts` 的 `selectInstallTargets` | 新增导出函数 |
| D3 | 怎么卸 | 装完选中的之后,对没选的调 `uninstallTargets`(和 `uninstall -t` 同一个函数),每家一行汇总,不逐个列文件 | 逐个列删掉的文件——一家几十行,淹没安装输出 | `src/cli/installer/index.ts` 的 `uninstallTargets` | install 输出多一行/家 |
| D4 | 交互选择框标题 | 「选择要安装 cgraphx 的 agent(回车确认;已装的没勾会卸掉它的 cgraphx 配置)」 | 另起一步确认——用户定了不追问 | 体验决策 | 无 |

git 钩子片段与 agent 无关,不随卸掉某一家而动;一家都没选时照旧跳过提交记录片段。

### 细节方案:F2 版本提示带上 agent 名

沿用现有实现,只改两句提示原文,在「这个项目」后面加上 `profile.displayName`:「这个项目里 CodeBuddy 的 cgraphx skill 还是 2.0.13」「这个项目里 Claude Code 的 cgraphx skill 是 2.0.11 之前装的」(`src/core/skill-version/index.ts`)。

### 全局约束

- `-y` 不带 `-t`(`cgraphx upgrade` 走这条)的结果不变:更新所有已装的,不卸任何一家。
- `cgraphx uninstall` 的行为不变。

## 设计验收

| # | 对应 | 验收点 | 怎么验 |
|---|---|---|---|
| 1 | D2 | `-t none`、`-y` 不带 `-t`、没装过的 agent 都不在卸载名单里 | 单元测试 |
| 2 | D3 | 装过两家后 `install -y -t claude-code`:`.codebuddy/` 里 cgraphx 的文件删掉,用户自己的文件留着,`.claude/` 照常更新,提交照常 | 临时目录实装 |

## 待确认项

- 无
