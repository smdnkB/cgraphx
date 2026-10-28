---
name: release-start
description: 开版本:发完一个版本,在主干上输入 /release-start,读出 package.json 的版本号,打上带说明的 tag v<版本号>,拉出下个版本分支 dev/<下个版本号> 并切过去,再装上版本分支的提交拦截(cgraphx release guard,每次开版本都跑,被钩子工具冲掉了会补回)。tag 和分支只建在本地,不推送、不改版本号。整套版本流程可选,不跑就照旧在当前分支上开发。Use when 开版本、开始下个版本、发完版开新版本、打 tag 拉版本分支、release start。
---

# 开版本 (release-start)

## 定位

- 版本流程(可选)的起点:/release-start → 每个需求 /dev-start 开副本 →(副本里澄清到 /code-review)→ /dev-merge 合入 → 发版那天改好版本号、/release-review 审核 → 说「发」合入主干 → 发布后再 /release-start。
- 只在本地打 tag、建分支;推不推远程由用户定。
- 不跑就不按版本走:照旧在当前分支上开发,也不装提交拦截。版本做到一半想退出,把主目录切回主干就算退出;版本分支和副本都留着,不自动删。
- 说法:**主干** = `main`,没有 main、有 master 时用 master;**版本分支** = 名字是 `dev/数字.数字.数字` 的分支(`^dev/[0-9]+\.[0-9]+\.[0-9]+$`),`dev/zhangsan`、`develop` 不算,照旧不管。

## 流程

以刚发完 2.0.10、主干是 main 为例,命令里的版本号换成实际值。

1. **在主干上,没有改了没提交的文件**:

   ```bash
   git branch --list main master --format='%(refname:short)'   # 有 main 用 main;只有 master 用 master
   git symbolic-ref --short HEAD                                # → main
   git -c core.quotePath=false status --porcelain --untracked-files=no  # → 无输出
   ```

   当前分支不是主干 → 停下,提示先切回 main;第三条有输出 → 停下,列出这些文件,提示先提交或收好(没被跟踪的新文件不拦)。两种都不打 tag、不建分支。

2. **上个版本发了没**:本地每个版本分支都要已合进主干。

   ```bash
   git branch --list 'dev/*' --format='%(refname:short)' | grep -E '^dev/[0-9]+\.[0-9]+\.[0-9]+$'
   git merge-base --is-ancestor dev/2.0.10 main; echo $?        # 0 = 已合进 main;上一条列出的每个分支都跑
   ```

   有不是 0 的 → 停下「dev/2.0.10 还没发，先跑 /release-review」(换成那个分支名)。

3. **读版本号**:

   ```bash
   node -p "require('./package.json').version"                  # → 2.0.10
   ```

   读不到(没有 package.json、没有 version 字段,输出不是 `数字.数字.数字`)→ 问用户刚发的版本号。

4. **定下个版本号**:默认末位加一,2.0.10 → 2.0.11;用户说「下个版本是 2.1.0」就开 dev/2.1.0。

   ```bash
   git rev-parse -q --verify refs/heads/dev/2.0.11 >/dev/null && git merge-base --is-ancestor dev/2.0.11 main && echo 已发过
   ```

   打出「已发过」→ 停下「dev/2.0.11 已经发过了，版本号还是 2.0.10:发版前没改版本号?」,不打 tag、不建分支。

5. **打 tag**,按顺序判断:
   - `git rev-parse -q --verify refs/tags/v2.0.10` 有输出 → 已存在,直接用,不重打。
   - `git tag -l | head -n 1` 没有输出(仓库一个 tag 都没有)→ 候选取最近一次改版本号的提交,告诉用户它之后主干上还有几个提交,问打在哪;用户确认候选就打在它上面,指定了别的提交就打在那个提交上:

     ```bash
     git log -1 --format='%H %s' -G'"version"' -- package.json  # → 3f7f4f6… chore: 版本号 2.0.9→2.0.10
     git rev-list --count 3f7f4f6..main                         # → 9
     git tag -a v2.0.10 -m "发布 2.0.10" 3f7f4f6                # 用户确认后
     ```

   - 其余 → 打在主干当前提交:`git tag -a v2.0.10 -m "发布 2.0.10"`。

6. **拉版本分支**:`git checkout -b dev/2.0.11`(从主干当前提交拉,切过去)。

7. **装提交拦截**:每次开版本都跑,幂等;它同时记下「按版本走」的本地记号(拦截没装上也记),发完版在 main 上 /dev-merge 会据它先问。`cgraphx release guard --json`,按输出说:
   - `status` 是 `repaired` → 多说一句「提交拦截被钩子工具冲掉过,已补回」
   - `localFilter` 是 true → 说一句「<hookPath> 跟着仓库提交,拦截这几行只在本机,不会进提交」
   - `status` 是 `unsupported` → 按 `reason` 说没装上的原因,其余步骤照常:
     - `outside_repo` →「core.hooksPath 指向仓库外的共用目录 <hookPath 所在目录>,没装提交拦截:装进去会影响这台机器上的所有仓库」
     - `symlink` →「钩子文件 <hookPath> 是链接,没装提交拦截」,把 `lines` 给用户,说要装的话加到它指向的文件第一行之后
     - `not_shell` →「钩子文件 <hookPath> 不是 shell 脚本,没装提交拦截」
     - 都补一句:没有拦截时,版本分支上的直接提交发版审核时照样列进疑似夹带
   - 命令报错 → 把输出原样告诉用户;tag 和分支照常保留

8. **回报**:「已打 v2.0.10,开始 2.0.11」,并说明 tag 和分支只建在本地,见范例。

## 范例

用户刚发完 2.0.10,在 main 上输入 /release-start:

```text
$ git symbolic-ref --short HEAD
main
$ git -c core.quotePath=false status --porcelain --untracked-files=no
$ git branch --list 'dev/*' --format='%(refname:short)' | grep -E '^dev/[0-9]+\.[0-9]+\.[0-9]+$'
dev/2.0.10
$ git merge-base --is-ancestor dev/2.0.10 main; echo $?
0
$ node -p "require('./package.json').version"
2.0.10
$ git rev-parse -q --verify refs/heads/dev/2.0.11 >/dev/null && git merge-base --is-ancestor dev/2.0.11 main && echo 已发过
$ git rev-parse -q --verify refs/tags/v2.0.10
$ git tag -l | head -n 1
v2.0.9
$ git tag -a v2.0.10 -m "发布 2.0.10"
$ git checkout -b dev/2.0.11
Switched to a new branch 'dev/2.0.11'
$ cgraphx release guard --json
{
  "ok": true,
  "hookPath": "/Users/smdnk/objects/ai/cgraphx/.git/hooks/commit-msg",
  "status": "installed",
  "localFilter": false
}
```

回给用户:

```text
已打 v2.0.10,开始 2.0.11

tag v2.0.10 和分支 dev/2.0.11 只建在本地,推不推远程由你定。dev/2.0.11 上直接提交会被拦下,只收合并提交和 chore(release): 开头的整版改动;每个需求在主目录输入 /dev-start <需求> 开副本来做。
```

仓库里一个 tag 都没有时,先问再打:

```text
仓库里还没有 tag。最近一次改版本号的是 3f7f4f6「chore: 版本号 2.0.9→2.0.10」,之后 main 上还有 9 个提交。v2.0.10 打在 3f7f4f6 上吗?
```

## 停下问用户

| 情况 | 怎么做 |
|---|---|
| 不在主干上,或有改了没提交的已跟踪文件 | 停下,不打 tag、不建分支;提示先切回 main,或列出文件、提示先提交或收好 |
| 有版本分支还没合进主干 | 停下「dev/2.0.10 还没发，先跑 /release-review」 |
| 读不到版本号 | 问用户刚发的版本号 |
| 下个版本分支已存在且已合进主干 | 停下「dev/2.0.11 已经发过了，版本号还是 2.0.10:发版前没改版本号?」 |
| 仓库一个 tag 都没有 | 给出候选提交和它之后的提交数,问打在哪,确认后再打 |
| 提交拦截没装上(`unsupported`) | 按 `reason` 说原因(仓库外的共用目录 / 链接 / 不是 shell 脚本),其余照常 |

## 红线

1. ❌ 不推送 tag 和分支。
2. ❌ 不重打已有的 tag。
3. ❌ 不改版本号:版本号由用户在版本分支上、发版审核前以 `chore(release): 版本号 <旧>→<新>` 提交。
4. ❌ 不删版本分支和副本。
