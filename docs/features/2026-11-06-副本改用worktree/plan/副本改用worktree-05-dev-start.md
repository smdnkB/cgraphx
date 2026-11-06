# T-5: dev-start 改写

> 产物: plan
> 依据: spec@e839c10

- 目标:`/dev-start` 的说法、返回值处理、范例、停下问用户表和红线全部改成 worktree 副本;写清「只带 agent 配置和清单文件、依赖不带」与三条固定提示。
- 对应 spec 编号:F1、K4、K6、K7、K15、K16;spec「文档」表 `skills/dev-start/SKILL.md`
- 强制引用:无(文档任务)
- 涉及范围:`assets/claude-template/skills/dev-start/SKILL.md`(只改这一个文件)

## 必须严格执行

- 说法:副本 = 经 `cgraphx replica create` 开出、在主目录登记过的 **git worktree**;自己 `git worktree add` 的、`cp` 复制的不算。
- 不再出现「写时复制」「整份复制」「`--full-copy`」「`no_cow`」「`dirty_main`」「venv 写死主目录」。
- 返回值表只认 C-5 的字段与 C-4 的错误码;`reattached` 来自 C-5。
- 三条固定提示的原文(见下面第 5 条),不合并、不省略。

## 允许局部适配

- 段落顺序、例句的措辞(提示语与返回表除外)、范例里的路径与标题(保持 `2026-10-27-订单导出` 这套)。
- 可以加一句「`.worktreeinclude` cgraphx 不创建、项目自己决定要不要提交」,但不得写成 `/dev-start` 会创建它。

## 具体要求

### 1. frontmatter description

改成(可微调标点,语义不动):

```text
description: 开需求副本:在主目录的会话里输入 /dev-start <需求>,先按 dev-spec 的命名规则定好需求目录名,再用 git worktree 在主目录旁边开出副本 <主目录名>@<文件前缀>(只带 agent 配置和 .worktreeinclude 清单里写的文件,依赖默认不带),副本里从主目录当前所在的分支拉出 feat/<文件前缀>(bug 修复用 fix/)并登记到主目录——副本里的会话和提交和主目录记进同一个项目的数据;接着建好副本自己的知识库索引和「我的需求」索引,给出到副本开新会话的启动语。只在主目录执行,不在副本里开副本。Use when 开副本、开需求副本、在副本里做、并行做需求、dev-start。
```

### 2. 「定位」节

保留现有 5 条,改/加这三处:

- 第 1 条保持「一个需求只开一个副本」。
- 第 2 条保持「副本从主目录当前所在的分支拉」。
- 第 3 条保持「副本里的会话和提交和主目录记进同一个项目的数据;知识库索引和『我的需求』索引副本自己建」,后面补一句:「副本是 git worktree,只带 agent 配置和清单里写的文件;依赖和构建产物不带,第一次要在副本里安装、构建一次;几个副本共用一份 stash,副本里别用 `git stash`」。
- 第 4 条保持「只在主目录执行……不开新副本」。
- 第 5 条「说法」改成:「**在副本里** = 项目根下 `.cgraphx/shared` 是符号链接;只有经 `cgraphx replica create` 开出、登记过的 git worktree 才算副本,自己 `git worktree add` 开的、`cp` 复制的都不算」。

### 3. 流程第 3 步的返回表

`cgraphx replica create ... --json` 命令不变,表改成:

| 返回 | 怎么做 |
|---|---|
| `"ok": true`、`"reattached": false` | 接第 4 步 |
| `"ok": true`、`"reattached": true` | 接第 4 步;启动语之后加一句「接上了分支 `feat/<文件前缀>`,先 `/dev-merge` 同步一次」 |
| `"code": "worktree_failed"` | 把 `message`(git 的原话)告诉用户,停下 |
| `"code": "name_taken"` | 保持现有做法 |
| `"code": "feature_has_replica"` | 保持现有做法 |
| 其余 `code` | 把 `message` 原样告诉用户,停下 |

删掉 `dirty_main`、`no_cow` 两行和 `--full-copy` 重跑的说法。

### 4. 流程第 5 步

改成:`warnings` 逐条转告用户(可能是「主目录有 3 个文件没提交,没带进副本」「清单里的 X 主目录没有,没带」「主目录里的 X 没删掉……手动删掉主目录这份」「钩子片段没补上……」);`movedFiles` 不为空时说一句这些文件已移进副本。删掉「副本里 Python 的 .venv 写死了主目录路径」这句。

### 5. 流程第 6 步:启动语与提示

启动语不变;启动语之后依次补四句(原文):

```text
依赖和构建产物没带过来,第一次要在副本里安装、构建一次
启动要用的本地配置写进主目录的 .worktreeinclude(gitignore 语法,一行一个路径,可以用通配),下次开副本自动带
副本里不要用 git stash,几个副本共用一份
副本里同步主目录的分支只用 /dev-merge,不要 git pull、git merge——快进同步过,合没合入就判断不准了
```

### 6. 范例

- 把 `create` 的 JSON 换成 C-5 的字段:`name`、`path`、`featureId`、`branch`、`baseBranch`、`baseCommit`、`movedFiles`、`createdAt`、`removedAt`、`warnings`、`reattached`;示例值取 `reattached: false`、`warnings: []`。
- 删掉「这块盘不能写时复制 / `no_cow` / `--full-copy`」整段,换成 `worktree_failed` 的例子:

  ```text
  $ cgraphx replica create 2026-10-27-订单导出 --prefix 订单导出 --branch feat/订单导出 --json
  {
    "ok": false,
    "code": "worktree_failed",
    "message": "开 worktree 失败:fatal: …;没有留下任何东西,主目录没动"
  }
  ```

- 加一个「主目录有改动」的例子:同一命令带 `warnings: ["主目录有 3 个文件没提交,没带进副本"]`,说明照常开、不用先提交。
- 加一个「接上留下的分支」的例子:同一命令返回 `"reattached": true`(`baseCommit` 沿用第一次那条,差几个提交照旧算);启动语后那句「接上了分支 feat/订单导出,先 /dev-merge 同步一次」。
- 两个有依赖的需求一起开的例子保留,只把「写时复制」相关的词去掉。

### 7. 「停下问用户」表

- 删 `dirty_main`、`no_cow` 两行。
- 加一行:`分支已存在、不是这个需求留下的(invalid_args)` → 把 `message` 告诉用户,请用户换分支名,或先确认那个分支是谁的。
- 加一行:`开 worktree 失败(worktree_failed)` → `message` 原样转告,停下。
- 其余行保留。

### 8. 「红线」

改成 3 条:

```text
1. ❌ 不用 cp 复制、不自己 git worktree add:只有经 cgraphx replica create 开出、登记过的才算副本。
2. ❌ 不在副本里开副本。
3. ❌ 不替用户定需求目录名,不把中文标题转成英文 slug。
```

## 完成条件

```bash
grep -n "写时复制\|整份复制\|full-copy\|no_cow\|dirty_main\|venv" assets/claude-template/skills/dev-start/SKILL.md || echo "OK: 旧说法已清"
grep -n "worktree_failed\|reattached\|.worktreeinclude\|git stash" assets/claude-template/skills/dev-start/SKILL.md
```

两处 `grep` 的第一条无输出;第二条能命中;通读一遍返回表,字段名与 C-5 完全一致(不要出现 `created` 这种不存在的字段)。

## 提交点

1. `docs(skills): dev-start 副本改用 worktree——带配置与清单、依赖不带`: `assets/claude-template/skills/dev-start/SKILL.md`

## 风险/注意事项

- `--full-copy` 和 `no_cow` 的段落是整段删,不是改写;旧 JSON 例子里没有的字段不要臆造。
- `reattached` 是布尔,不是 `created`;返回表不要再出现 `created`。
- 三条固定提示必须原文出现,它们是 F1 的体验决策落点。
