---
name: dev-merge
description: 需求合入与副本清理:需求在副本里做完、/code-review 过了,在主目录的会话里输入 /dev-merge <需求>,从副本取回需求分支、先预演合并(不动工作区),没冲突就用合并提交「合入需求：<标题>」合进主目录当前所在的分支(开了版本是版本分支,没开是主干),有冲突列出撞上的已合入需求;在副本的会话里输入 /dev-merge,先把主目录当前所在的分支同步进需求分支、就地解决冲突;在主目录说「删副本 <需求>」时核对合入和没提交的改动,问过再删。不推送,不把副本加成远程。Use when 合入需求、需求合入、同步版本分支、副本合入、删副本、清理副本、dev-merge。
---

# 需求合入 (dev-merge)

## 定位

- 副本里做的需求回主目录只走这一条路:冲突在副本里解决,主目录的分支上只有干净的合入。
- 合进主目录当前所在的分支:开了版本是 dev/<版本号>,没开是 main。跨版本没做完的副本留着,下个版本开了照样 /dev-merge——同步取的、合入的都是主目录那时所在的分支。
- 主目录在 main 上、却按版本走过还没退出(本地 git 配置 `cgraphx.releaseFlow` 为 true:发完版还没跑 /release-start)→ 合入前先停下问,不直接合进 main。
- 三种用法:在副本里输入 /dev-merge(同步);在主目录输入 /dev-merge <需求>(合入);在主目录说「删副本 <需求>」(删)。
- 说法:**主干** = `main`,没有 main、有 master 时用 master;**版本分支** = 名字是 `dev/数字.数字.数字` 的分支(`^dev/[0-9]+\.[0-9]+\.[0-9]+$`);**开了版本** = 主目录当前分支是版本分支;**在副本里** = 项目根下 `.cgraphx/shared` 是符号链接;**版本起点** = 版本分支第一父链上最早一个不在主干里的提交的第一个父提交(没有这样的提交就是版本分支的最新提交),主干合进过版本分支也不变:

  ```bash
  L=$(git rev-list --first-parent HEAD --not main --) || exit 1; C=$(printf '%s\n' "$L" | tail -n 1); START=${C:+$C^1}; START=${START:-HEAD}
  ```

  用到 START 的命令,都把这一行写在同一条命令的开头:每次调用都是新的 shell,上一次算的 START 不在了,空着的 START 让 `"$START"..HEAD` 变成空范围,命令照样成功、结果却是空的。git 报错(如没有叫 main 的分支)时这一行以非零退出、后面的不跑:停下,把报错原样转告用户。
- 副本里同步主目录的分支只用 /dev-merge(它用 `--no-ff` 产生合并提交);用 `git pull`、默认的 `git merge` 快进同步过,同步进来的提交会被当成需求自己做的,`replica list` 的合入判断就不准了。
- 输出文件路径的 git 命令都带 `-c core.quotePath=false`,中文路径原样输出,不转成 `"\344\270…"`。

## 流程

1. **查 git 版本**:`git version` → `git version 2.50.1`;低于 2.38 → 停下,提示合并预演要 git 2.38 以上,先升级 git。
2. **看在哪、做什么**:`test -L .cgraphx/shared && echo 在副本里`
   - 在副本里 → 「在副本里:同步」;用户说的是删副本 → 停下,提示到主目录的会话里说
   - 在主目录、/dev-merge <需求> → 「在主目录:合入」
   - 在主目录、「删副本 <需求>」→ 「删副本」

### 在副本里:同步

以副本 /Users/smdnk/objects/ai/cgraphx@订单导出 为例。

1. **主目录和它当前的分支**:

   ```bash
   dirname "$(cd -P .cgraphx/shared && pwd)"                         # → /Users/smdnk/objects/ai/cgraphx
   git -C /Users/smdnk/objects/ai/cgraphx symbolic-ref --short HEAD    # → dev/2.0.11
   ```

   `cd -P` 失败(链接指向的目录不在了)→ 停下「副本关联的主项目不在 /Users/smdnk/objects/ai/cgraphx 了」(路径是链接目标的上级目录)。

2. **没提交的先提交**:`git -c core.quotePath=false status --porcelain` 有输出 → 列出来,问用户这些改动现在提交吗;同意就按项目的提交规范提交,不提交就停下。

3. **同步**:

   ```bash
   git fetch --no-tags /Users/smdnk/objects/ai/cgraphx dev/2.0.11
   git merge --no-ff -m "同步 dev/2.0.11" FETCH_HEAD
   ```

   有冲突 → 就地和用户一起解决:`git -c core.quotePath=false diff --name-only --diff-filter=U` 列出冲突文件,逐个说清两边各改了什么、合起来怎么写,用户确认后改好、`git add`;全部解决后 `git commit --no-edit`(说明沿用「同步 dev/2.0.11」)。提交门禁拦下时,按提示自查,说明不改,带 `CGRAPHX_PRECOMMIT_REVIEWED=1` 重试。

4. **知识文件**:`git -c core.quotePath=false diff --name-only "HEAD^1" HEAD -- docs/knowledge/` 有输出 → 问一句要不要在副本里跑 `cgraphx docs index`;没问过不跑。合并显示 `Already up to date.`(没有新东西)就跳过这步。

5. **提示**:「可以合入了：到主目录的会话里输入 /dev-merge 订单导出」——标题 = 本副本的 feature-id 去掉日期段(`cgraphx replica list --json` 里 `name` 等于当前目录名的那条)。

### 在主目录:合入

以 /dev-merge 订单导出、主目录在 dev/2.0.11 上为例。

1. **找到副本**:`cgraphx replica list --json`,按副本目录名(`name`)、feature-id(`featureId`)或标题(featureId 去掉日期段)找。找不到 → 停下,列出在用的副本,问合哪个;`state` 是 `missing` → 停下:副本已不在,取不到需求分支;`merged` 是 true → 停下「已经合入过了,副本里没有新的提交」(合入后只同步过也算,不造空的「第 2 次」);`merged` 是 false、`ahead` 是 0 → 停下「cgraphx@订单导出 还没有提交,没有可合入的」;`merged` 是 null(git 判断不了)→ 说一句判断不了合没合入,照常往下走。

2. **主干上开过版本**:当前分支是主干,且 `git config --local --get cgraphx.releaseFlow` 输出 `true` → 停下问:

   ```text
   刚发完版,还没开下个版本。要合进下个版本,先跑 /release-start;这次直接合进 main,说「合进 main」;以后都不按版本走,说「不再按版本走」
   ```

   - 「合进 main」→ 这次照常往下合进 main,下次在 main 上还会问
   - 「不再按版本走」→ `cgraphx release guard --remove --json`(卸掉提交拦截,清掉两个记号),回一句「已退出版本流程,以后在 main 上 /dev-merge 不再问」;`status` 是 `unsupported`(拦截那几行是提交在仓库里的,没删)→ 再把 `notice` 原样转告。然后照没开版本的用法往下合
   - 要先开版本 → 停下,提示跑完 /release-start 再 /dev-merge 订单导出

3. **主目录干净**:`git -c core.quotePath=false status --porcelain --untracked-files=no` 有输出 → 停下,列出文件,提示先提交或收好(没被跟踪的新文件不拦)。

4. **副本干净**:这条副本的 `dirty` 不为空 → 停下,列出文件,提示先在副本里提交。

5. **取回需求分支**,不加远程、不在主目录建分支:

   ```bash
   git fetch --no-tags /Users/smdnk/objects/ai/cgraphx@订单导出 feat/订单导出
   ```

6. **预演**,不动工作区:

   ```bash
   git -c core.quotePath=false merge-tree --write-tree --name-only HEAD FETCH_HEAD; echo "exit=$?"    # exit=1 即有冲突:第一行是合并结果的树,之后到空行为止是冲突文件
   ```

   有冲突 → 分支不动;每个冲突文件找出撞上的、已经合入的需求。改过它的合并里,第二个父提交已在主干里的是同步主干(把主干上的热修复合进了版本分支),其余是「合入需求：X」:

   ```bash
   # 开了版本:从版本起点找(START 的取法见「定位」,和下面的循环在同一条命令里)
   L=$(git rev-list --first-parent HEAD --not main --) || exit 1; C=$(printf '%s\n' "$L" | tail -n 1); START=${C:+$C^1}; START=${START:-HEAD}
   git log --first-parent --merges --format='%H %s' "$START"..HEAD -- src/order/routes.ts | while read -r h s; do
     git merge-base --is-ancestor "$h^2" main && echo "同步主干" || echo "$s"
   done    # → 合入需求：积分发放
   # 没开版本:从这条副本登记的 createdAt 之后找
   git log --first-parent --merges --since=2026-10-27T08:00:00.000Z --format=%s HEAD -- src/order/routes.ts
   ```

   冲突文件逐行列出,再给一句怎么办:

   ```text
   src/order/routes.ts:积分发放 也改过
   到副本会话里输入 /dev-merge,同步最新的 dev/2.0.11、就地解决冲突，再回主目录合入
   ```

   撞上的是同步主干 → 写「src/order/routes.ts:主干上的改动也改过」;没有合并改过它(撞上的是直接提交)→ 写「src/order/routes.ts:dev/2.0.11 上的直接提交也改过」。

7. **合并说明**:「合入需求：订单导出」;这个需求第 2 次起写「合入需求：订单导出(第 2 次)」。N = 已有的同标题合入数 + 1:

   ```bash
   # 开了版本:从版本起点数(和算 START 的那一行在同一条命令里)
   L=$(git rev-list --first-parent HEAD --not main --) || exit 1; C=$(printf '%s\n' "$L" | tail -n 1); START=${C:+$C^1}; START=${START:-HEAD}
   git log --first-parent --merges --format=%s "$START"..HEAD | grep -cE '^合入需求：订单导出(\(第 [0-9]+ 次\))?$'
   # 没开版本:从这条副本登记的 createdAt 之后数
   git log --first-parent --merges --since=2026-10-27T08:00:00.000Z --format=%s HEAD | grep -cE '^合入需求：订单导出(\(第 [0-9]+ 次\))?$'
   ```

   输出 0 → 不带次数;输出 1 → 第 2 次,以此类推。标题 = 需求目录名去掉日期段;冒号是全角「：」,括号是半角。

8. **合入**:`git merge --no-ff -m "合入需求：订单导出" FETCH_HEAD`

9. **回报**:

   ```bash
   git rev-list --count --no-merges "HEAD^1..HEAD^2"                        # → 3,提交数
   git -c core.quotePath=false diff --name-only "HEAD^1" HEAD | wc -l       # → 7,文件数
   ```

   开了版本:「已合入：3 个提交，改了 7 个文件;副本留到发版后清理」。没开版本:「已合入：3 个提交，改了 7 个文件」。

10. **知识文件**:`git -c core.quotePath=false diff --name-only "HEAD^1" HEAD -- docs/knowledge/` 有输出 → 问一句要不要在主目录跑 `cgraphx docs index`;没问过不跑。

11. **没开版本就问删不删**:「cgraphx@订单导出 已合入,可以删;删掉这个副本吗?」;用户说删 → `cgraphx replica remove cgraphx@订单导出 --json`,结果照「删副本」第 2 步处理。

### 删副本

在主目录说「删副本 订单导出」时:

1. `cgraphx replica list --json` 找到这条副本(找法同上),先说清状况再问:
   - `dirty` 不为空 → 不删,报「cgraphx@订单导出 有 2 个文件没提交」并列出文件
   - `merged` 是 false、`ahead` 大于 0 → 「cgraphx@订单导出 还差 2 个提交没合入」(`ahead`),副本删了这些提交就没了,问还删不删
   - `merged` 是 false、`ahead` 是 0 → 「cgraphx@订单导出 还没有提交」,问还删不删
   - `merged` 是 true → 「cgraphx@订单导出 已合入,可以删;删掉这个副本吗?」
   - `merged` 是 null → 「判断不了 cgraphx@订单导出 合没合入」,不删;请用户先在副本里看一眼 `git log`,确认提交都已合入再说删
   - `state` 是 `missing` → 「cgraphx@订单导出 已不在」,问要不要把登记标成已删
2. 用户说删 → `cgraphx replica remove cgraphx@订单导出 --json`:
   - `"state": "removed"` → 回「已删 cgraphx@订单导出,登记和数据都留着」
   - `"state": "missing"` → 回「cgraphx@订单导出 已不在,登记已标成已删」
   - `"code": "dirty"` → 不删,报「cgraphx@订单导出 有 2 个文件没提交」并列出 `files`
   - 其余 `code` → 把 `message` 原样告诉用户

## 范例

在主目录(dev/2.0.11 上)输入 /dev-merge 订单导出:

```text
$ cgraphx replica list --json
{
  "ok": true,
  "replicas": [
    {
      "name": "cgraphx@订单导出",
      "path": "/Users/smdnk/objects/ai/cgraphx@订单导出",
      "featureId": "2026-10-27-订单导出",
      "branch": "feat/订单导出",
      "baseBranch": "dev/2.0.11",
      "baseCommit": "98218c5ec46954b00ef01bd775aa237043169716",
      "createdAt": "2026-10-27T08:00:00.000Z",
      "removedAt": null,
      "state": "present",
      "merged": false,
      "ahead": 3,
      "dirty": []
    }
  ]
}
$ git -c core.quotePath=false status --porcelain --untracked-files=no
$ git fetch --no-tags /Users/smdnk/objects/ai/cgraphx@订单导出 feat/订单导出
$ git -c core.quotePath=false merge-tree --write-tree --name-only HEAD FETCH_HEAD; echo "exit=$?"
9b1c4d7e2f0a6b8c3d5e7f9a1b2c4d6e8f0a2b4c
exit=0
$ L=$(git rev-list --first-parent HEAD --not main --) || exit 1; C=$(printf '%s\n' "$L" | tail -n 1); START=${C:+$C^1}; START=${START:-HEAD}; git log --first-parent --merges --format=%s "$START"..HEAD | grep -cE '^合入需求：订单导出(\(第 [0-9]+ 次\))?$'
0
$ git merge --no-ff -m "合入需求：订单导出" FETCH_HEAD
$ git rev-list --count --no-merges "HEAD^1..HEAD^2"
3
$ git -c core.quotePath=false diff --name-only "HEAD^1" HEAD | wc -l
7
$ git -c core.quotePath=false diff --name-only "HEAD^1" HEAD -- docs/knowledge/
```

回给用户:

```text
已合入：3 个提交，改了 7 个文件;副本留到发版后清理
```

预演有冲突时,dev/2.0.11 不动:

```text
$ git -c core.quotePath=false merge-tree --write-tree --name-only HEAD FETCH_HEAD; echo "exit=$?"
5e2f8a1c3b4d6e7f9a0b1c2d3e4f5a6b7c8d9e0f
src/order/routes.ts

Auto-merging src/order/routes.ts
CONFLICT (content): Merge conflict in src/order/routes.ts
exit=1
$ L=$(git rev-list --first-parent HEAD --not main --) || exit 1; C=$(printf '%s\n' "$L" | tail -n 1); START=${C:+$C^1}; START=${START:-HEAD}; git log --first-parent --merges --format='%H %s' "$START"..HEAD -- src/order/routes.ts | while read -r h s; do git merge-base --is-ancestor "$h^2" main && echo "同步主干" || echo "$s"; done
合入需求：积分发放
```

回给用户:

```text
预演有冲突,dev/2.0.11 没动:
src/order/routes.ts:积分发放 也改过
到副本会话里输入 /dev-merge,同步最新的 dev/2.0.11、就地解决冲突，再回主目录合入
```

在副本 cgraphx@订单导出 的会话里输入 /dev-merge:

```text
$ dirname "$(cd -P .cgraphx/shared && pwd)"
/Users/smdnk/objects/ai/cgraphx
$ git -C /Users/smdnk/objects/ai/cgraphx symbolic-ref --short HEAD
dev/2.0.11
$ git -c core.quotePath=false status --porcelain
$ git fetch --no-tags /Users/smdnk/objects/ai/cgraphx dev/2.0.11
$ git merge --no-ff -m "同步 dev/2.0.11" FETCH_HEAD
Auto-merging src/order/routes.ts
CONFLICT (content): Merge conflict in src/order/routes.ts
Automatic merge failed; fix conflicts and then commit the result.
```

和用户一起改好 src/order/routes.ts,`git add src/order/routes.ts`、`git commit --no-edit` 之后:

```text
$ git -c core.quotePath=false diff --name-only "HEAD^1" HEAD -- docs/knowledge/
docs/knowledge/积分流水.md
```

回给用户:

```text
已同步 dev/2.0.11,src/order/routes.ts 的冲突已解决并提交。同步带进了 docs/knowledge/积分流水.md,要在副本里跑 cgraphx docs index 重建知识库索引吗?

可以合入了：到主目录的会话里输入 /dev-merge 订单导出
```

## 停下问用户

| 情况 | 怎么做 |
|---|---|
| git 低于 2.38 | 停下,提示升级 git |
| 副本里:主目录不在了 | 停下「副本关联的主项目不在 /Users/smdnk/objects/ai/cgraphx 了」 |
| 副本里:有没提交的改动 | 列出来,问要不要先提交;不提交不同步 |
| 副本里:同步有冲突 | 就地和用户一起解决,每个文件的改法等用户确认 |
| 副本里:说删副本 | 停下,提示到主目录的会话里说 |
| 主目录:没说合哪个需求,或找不到副本 | 列出在用的副本,问合哪个 |
| 主目录:副本已不在、已经合入没有新提交、还没有提交 | 停下,说明情况 |
| 主目录:在主干上,`cgraphx.releaseFlow` 为 true | 停下问:先 /release-start、这次合进 main、还是不再按版本走 |
| 主目录:有改了没提交的已跟踪文件 | 停下,提示先提交或收好 |
| 主目录:副本里有没提交的改动 | 停下,提示先在副本里提交 |
| 主目录:预演有冲突 | 分支不动,列出冲突文件和撞上的需求,提示到副本里同步 |
| 合入、同步带进 `docs/knowledge/` | 问要不要跑 `cgraphx docs index` |
| 没开版本,合完 | 问删不删这个副本 |
| 删副本:没合入、还没有提交,或有没提交的改动 | 没合入说差几个提交、还没有提交照实说,问过再删;有没提交的改动不删 |
| 删副本:判断不了合没合入(`merged` 为 null) | 不删,请用户先在副本里确认提交都已合入 |

## 红线

1. ❌ 不把副本加成远程,不在主目录建需求分支:只用 `git fetch --no-tags <副本路径> <需求分支>` 和 FETCH_HEAD。
2. ❌ 预演有冲突不合,不在主目录解决冲突。
3. ❌ 版本分支上只做合并,不改代码。
4. ❌ 删副本前必须问;有没提交的改动的不删。
5. ❌ 不推送。
6. ❌ 没问过不跑 `cgraphx docs index`。
