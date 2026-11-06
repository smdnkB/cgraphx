# T-7: cgraphx-guide 与 FLOW-MAP 改写

> 产物: plan
> 依据: spec@e839c10

- 目标:整体导航与流程全图里,副本的说法从「写时复制整仓」改成「worktree、只带配置与清单文件、依赖不带」。
- 对应 spec 编号:F1、K4、K16;spec「文档」表的 cgraphx-guide 与 `FLOW-MAP.md`
- 强制引用:无(文档任务)
- 涉及范围:`assets/claude-template/skills/cgraphx-guide/SKILL.md`、`how-to-use.md`、`how-to-use.html`、`skills.html`、`assets/claude-template/FLOW-MAP.md`(五个文件,与其它任务不重叠)

## 必须严格执行

- 五份文件里不再出现「写时复制」「整份复制」;`/dev-start` 的描述统一为「开 worktree 副本」。
- 必须出现的三件事:副本是 git worktree;只带 agent 配置和 `.worktreeinclude` 里写的文件;依赖默认不带、第一次要在副本里安装/构建。
- 其余流程、命令、数据位置的说法不动。

## 允许局部适配

- 句子长短、HTML 里的 class/样式;英文/中文标点。

## 具体要求

### 1. `cgraphx-guide/SKILL.md`

「各 skill 导航」表里 `/dev-start` 那一行,改成:

```text
| `/dev-start` | 开始做一个需求时(开了版本时每个需求都要),在主目录旁边开出 worktree 副本 `<主目录名>@<文件前缀>`(只带 agent 配置和 `.worktreeinclude` 清单里写的文件,依赖默认不带,第一次要在副本里安装/构建)、拉好需求分支、建好需求目录,给出到副本开新会话的启动语;副本里的会话和提交和主目录记进同一个项目的数据 |
```

### 2. `how-to-use.md`

版本流程下 `/dev-start` 那一条,改成:

```text
- `/dev-start` 开副本:在主目录旁边开出 worktree 副本 `<主目录名>@<文件前缀>`(只带 agent 配置和 `.worktreeinclude` 清单里写的文件,依赖默认不带),拉好需求分支、建好需求目录,给出到副本开新会话的启动语——开始做一个需求时跑,开了版本时每个需求都要
```

### 3. `how-to-use.html`

`tab-release` 里 `/dev-start` 那条 `<li>` 的正文改成同一句话(保留 `<code>` 标签与现有排版):

```html
<li><code>/dev-start</code> 开副本:在主目录旁边开出 worktree 副本 <code>&lt;主目录名&gt;@&lt;文件前缀&gt;</code>(只带 agent 配置和 <code>.worktreeinclude</code> 清单里写的文件,依赖默认不带),拉好需求分支、建好需求目录,给出到副本开新会话的启动语 <em>—— 开始做一个需求时跑,开了版本时每个需求都要</em></li>
```

同节的 highlight 段落保留原有内容,只把「副本里的会话和提交和主目录记进同一个项目的数据……」前后不涉及副本机制的句子不动;如果段落里出现「整仓」「复制」,一并改成 worktree 的说法。

### 4. `skills.html`

`#dev-start` 那块:

- `summary` 的 oneline:`给需求开一个写时复制副本,在副本里单独做` → `给需求开一个 worktree 副本,在副本里单独做`
- `dt 要你拍板` 改成:

  ```text
  需求目录名(业务 ID、标题);带哪些本地文件写进 `.worktreeinclude`(gitignore 语法,依赖默认不带,第一次在副本里安装、构建)。
  ```

- `dt 产出` 里的副本说明补「是 worktree,依赖和构建产物没带过来」;其余(分支、需求目录、讨论稿移进去、启动语)保留。

### 5. `FLOW-MAP.md` 的「版本流程(可选)」

- 「链」那句把「开副本 `<主目录名>@<文件前缀>`」改成「开 worktree 副本 `<主目录名>@<文件前缀>`」。
- 在「副本单独用」和「前置」之间加一条:

  ```text
  - **带什么**:agent 配置(配置目录、指引文件、`.mcp.json`,只带没被 git 跟踪的部分)和 `.worktreeinclude` 里写的文件;依赖、构建产物默认不带,第一次在副本里安装、构建
  ```

- 「前置」「数据」两条保留;「前置」仍写 git 2.38 以上、副本只支持 macOS、Linux。

## 完成条件

```bash
grep -rn "写时复制\|整份复制" assets/claude-template/skills/cgraphx-guide/ assets/claude-template/FLOW-MAP.md || echo "OK: 旧说法已清"
grep -rn "worktree" assets/claude-template/skills/cgraphx-guide/SKILL.md assets/claude-template/skills/cgraphx-guide/how-to-use.md assets/claude-template/skills/cgraphx-guide/how-to-use.html assets/claude-template/skills/cgraphx-guide/skills.html assets/claude-template/FLOW-MAP.md
grep -rn ".worktreeinclude" assets/claude-template/skills/cgraphx-guide/ assets/claude-template/FLOW-MAP.md
```

第一条无输出;后两条在每份文件里至少命中一次(FLOW-MAP 至少命中 `.worktreeinclude` 与 worktree)。

## 提交点

1. `docs(skills): cgraphx-guide 与 FLOW-MAP 记 worktree 副本——带配置与清单、依赖不带`: 五个文件

## 风险/注意事项

- HTML 里 `<`/`>` 要转义成 `&lt;`/`&gt;`(沿用现有写法),别把 `<主目录名>` 原样写进 HTML。
- `how-to-use.*` 与 `skills.html` 是给人看的,不要求写错误码;但「依赖默认不带」和 `.worktreeinclude` 必须出现,否则用户不知道第一次要装依赖。
- 只改这五份;`cgraphx-guide/SKILL.md` 里其它流程(spec/plan/测试)不碰。
