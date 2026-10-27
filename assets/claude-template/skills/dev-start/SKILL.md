---
name: dev-start
description: 开需求副本:在主目录的会话里输入 /dev-start <需求>,先按 dev-spec 的命名规则定好需求目录名,再用写时复制在主目录旁边开出副本 <主目录名>@<文件前缀>(依赖包、.env 这类被忽略的本地文件一起带过去,没被跟踪的不带,这个需求目录下的移进副本),副本里从主目录当前所在的分支拉出 feat/<文件前缀>(bug 修复用 fix/)并登记到主目录——副本里的会话、提交、任务归属都记进主目录;接着建好副本自己的知识库索引和「我的需求」索引,给出到副本开新会话的启动语。只在主目录执行,不在副本里开副本。Use when 开副本、开需求副本、在副本里做、并行做需求、dev-start。
---

# 开需求副本 (dev-start)

## 定位

- 一个需求一个副本:几个会话并行时,改动各落在自己的副本和需求分支上;做完、/code-review 过了,在主目录 /dev-merge 合入。
- 副本从主目录当前所在的分支拉:开了版本是 dev/<版本号>,没开就是 main——副本单独也能用,不用先 /release-start。
- 副本里的会话、提交、任务归属记进主目录,按登记归到这个需求;知识库索引和「我的需求」索引副本自己建。
- 只在主目录执行。同一个需求换个会话继续,用 /dev-handoff,不开新副本。
- 说法:**在副本里** = 项目根下 `.cgraphx/shared` 是符号链接;只有经 `cgraphx replica create` 开出、登记过的目录才算副本,自己用 cp 复制的、git worktree 都不算。

## 流程

以在主目录 /Users/smdnk/objects/ai/cgraphx 开「订单导出」为例。

1. **在主目录**:`test -L .cgraphx/shared && echo 在副本里` 打出「在副本里」→ 停下,提示到主目录的会话里开;同一个需求换会话用 /dev-handoff,不开新副本。

2. **定名字**,一次问齐,用户确认后再开(见范例):
   - feature-id:`docs/features/` 下已有这个需求的目录就复用;没有就按 dev-spec 第 0 步和「产物位置与命名」新建,业务 ID、标题语言及规范里的其他段由用户确认,不把中文转成英文 slug
   - 文件前缀 = feature-id 去掉日期段 `YYYY-MM-DD`:`2026-10-27-订单导出` → `订单导出`
   - 分支 `feat/<文件前缀>`,bug 修复用 `fix/<文件前缀>`;副本目录 `<主目录名>@<文件前缀>`,放在主目录的上级目录

3. **开副本**:

   ```bash
   cgraphx replica create 2026-10-27-订单导出 --prefix 订单导出 --branch feat/订单导出 --json
   ```

   按返回处理:

   | 返回 | 怎么做 |
   |---|---|
   | `"ok": true`、`"created": true` | 接第 4 步 |
   | `"ok": true`、`"created": false` | 这个需求的副本已经有了,不重建,直接给启动语 |
   | `"code": "dirty_main"` | 列出 `files`,停下:主目录有改了没提交的文件,开出来副本会带走这些改动,先提交或收好;没被跟踪的新文件不拦,也不带进副本 |
   | `"code": "no_cow"` | 问「这块盘不能快速复制，要整份复制 4.1 GB,继续吗?」(大小 = `requiredBytes` ÷ 1024³,保留一位小数);用户同意 → 同一条命令加 `--full-copy` 重跑 |
   | 其余 `code` | 把 `message` 原样告诉用户,停下 |

4. **建副本自己的两份索引**:

   ```bash
   cgraphx docs index /Users/smdnk/objects/ai/cgraphx@订单导出
   cgraphx features sync /Users/smdnk/objects/ai/cgraphx@订单导出
   ```

5. **转告**:`warnings` 逐条转告用户(如副本里 Python 的 .venv 写死了主目录路径,要在副本里重建);`movedFiles` 不为空时,说一句这些文件已移进副本。

6. **给启动语**:

   ```text
   在 /Users/smdnk/objects/ai/cgraphx@订单导出 开新会话，输入 /dev-clarify
   ```

   已经澄清过、需求目录里有终确认的讨论稿 → `/dev-clarify` 换成 `/dev-spec`,新会话的 /dev-spec 直接复用这个需求目录。一次开了几个需求、需求之间有依赖时,说明各开一个副本、都从当前分支拉;被依赖的需求合入后,在依赖方的副本会话里输入 /dev-merge 同步一次再联调。

## 范例

主目录在 dev/2.0.11 上,刚在这个会话里澄清完「订单导出」,讨论稿 v2 已终确认。用户输入 /dev-start 订单导出:

```text
需求目录名 2026-10-27-订单导出(没有业务 ID,标题用中文);副本 /Users/smdnk/objects/ai/cgraphx@订单导出,从当前的 dev/2.0.11 拉出 feat/订单导出。这样开吗?
```

用户说开:

```text
$ test -L .cgraphx/shared && echo 在副本里
$ cgraphx replica create 2026-10-27-订单导出 --prefix 订单导出 --branch feat/订单导出 --json
{
  "ok": true,
  "name": "cgraphx@订单导出",
  "path": "/Users/smdnk/objects/ai/cgraphx@订单导出",
  "featureId": "2026-10-27-订单导出",
  "branch": "feat/订单导出",
  "baseBranch": "dev/2.0.11",
  "createdAt": "2026-10-27T08:00:00.000Z",
  "removedAt": null,
  "created": true,
  "movedFiles": [
    "docs/features/2026-10-27-订单导出/订单导出-功能方案-v1.md",
    "docs/features/2026-10-27-订单导出/订单导出-功能方案-v2.md"
  ],
  "warnings": []
}
$ cgraphx docs index /Users/smdnk/objects/ai/cgraphx@订单导出
$ cgraphx features sync /Users/smdnk/objects/ai/cgraphx@订单导出
```

回给用户:

```text
副本开好了:/Users/smdnk/objects/ai/cgraphx@订单导出,分支 feat/订单导出(从 dev/2.0.11 拉);讨论稿 v1、v2 已移进副本。副本里的会话和提交都记进主目录,归到 2026-10-27-订单导出;做完、/code-review 过了,在主目录输入 /dev-merge 订单导出 合入。

在 /Users/smdnk/objects/ai/cgraphx@订单导出 开新会话，输入 /dev-spec
```

这块盘不能写时复制:

```text
$ cgraphx replica create 2026-10-27-订单导出 --prefix 订单导出 --branch feat/订单导出 --json
{
  "ok": false,
  "code": "no_cow",
  "message": "…",
  "requiredBytes": 4402341478
}
```

问「这块盘不能快速复制，要整份复制 4.1 GB,继续吗?」;用户说继续 → 同一条命令加 `--full-copy` 重跑。

两个有依赖的需求一起开(/dev-start 积分发放 积分兑换),各走一遍第 2~5 步,最后:

```text
积分兑换 要用 积分发放 写的流水:两个副本都从 dev/2.0.11 拉;积分发放 合入后,在 积分兑换 的副本会话里输入 /dev-merge 同步一次再联调。

在 /Users/smdnk/objects/ai/cgraphx@积分发放 开新会话，输入 /dev-clarify
在 /Users/smdnk/objects/ai/cgraphx@积分兑换 开新会话，输入 /dev-clarify
```

## 停下问用户

| 情况 | 怎么做 |
|---|---|
| 在副本里 | 停下,提示到主目录的会话里开;同一个需求换会话用 /dev-handoff |
| 本会话刚澄清完,功能方案只在对话里、没有讨论稿 | 先不开,建议改用 /dev-handoff:它开副本,并把功能方案写进副本里的交接文件 |
| 需求目录名、业务 ID、标题语言还没确认 | 先问齐,不替用户定 |
| 主目录有改了没提交的文件(`dirty_main`) | 列出来,停下 |
| 这块盘不能写时复制(`no_cow`) | 问过才带 `--full-copy` 重跑 |
| 其余失败 | 把 `message` 原样告诉用户,停下 |

## 红线

1. ❌ 不用 cp 自己复制目录:只有经 `cgraphx replica create` 开出、登记过的才算副本。
2. ❌ 不在副本里开副本。
3. ❌ 主目录有改了没提交的已跟踪文件时不开。
4. ❌ 没问过不带 `--full-copy`。
5. ❌ 不替用户定需求目录名,不把中文标题转成英文 slug。
