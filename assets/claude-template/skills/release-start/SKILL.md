---
name: release-start
description: 开版本:要按版本开发下一个版本时,在主干上输入 /release-start,读出 package.json 的版本号,拉出下个版本分支 dev/<下个版本号> 并切过去,再装上版本分支的提交拦截(cgraphx release guard,同时记下「按版本走」)。分支只建在本地,不推送、不改版本号、不打 tag(tag 在 /release-review 说「发」时打)。整套版本流程可选,一个版本发完就退出;不跑就照默认流程在主干上开发。Use when 开版本、开始下个版本、按版本开发、拉版本分支、release start。
---

# 开版本 (release-start)

## 定位

- 版本流程(可选)的起点:/release-start → 每个需求 /dev-start 开副本 →(副本里澄清到 /code-review)→ /dev-merge 合入 → 发版那天改好版本号、/release-review 审核 → 说「发」合入主干、打 tag、退出版本流程。下个版本还要按版本走,再 /release-start。
- 只在本地建分支;推不推远程由用户定。
- 不跑就不按版本走:照默认流程在主干上开发,也不装提交拦截。版本做到一半想退出,把主目录切回主干,之后在主干上 /dev-merge 停下问时回答「不再按版本走」就算退出(卸掉提交拦截、清掉按版本走的记号);版本分支和副本都留着,不自动删。
- 说法:**主干** = `main`,没有 main、有 master 时用 master;**版本分支** = 名字是 `dev/数字.数字.数字` 的分支(`^dev/[0-9]+\.[0-9]+\.[0-9]+$`),`dev/zhangsan`、`develop` 不算,照旧不管。

## 流程

以上个版本是 2.0.10、主干是 main 为例,命令里的版本号换成实际值。

1. **在主干上,没有改了没提交的文件**:

   ```bash
   git branch --list main master --format='%(refname:short)'   # 有 main 用 main;只有 master 用 master
   git symbolic-ref --short HEAD                                # → main
   git -c core.quotePath=false status --porcelain --untracked-files=no  # → 无输出
   ```

   当前分支不是主干 → 停下,提示先切回 main;第三条有输出 → 停下,列出这些文件,提示先提交或收好(没被跟踪的新文件不拦)。两种都不建分支。

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

   读不到(没有 package.json、没有 version 字段,输出不是 `数字.数字.数字`)→ 问用户上个版本号。

4. **定下个版本号**:默认末位加一,2.0.10 → 2.0.11;用户说「下个版本是 2.1.0」就开 dev/2.1.0。

   ```bash
   git rev-parse -q --verify refs/heads/dev/2.0.11 >/dev/null && git merge-base --is-ancestor dev/2.0.11 main && echo 已发过
   ```

   打出「已发过」→ 停下「dev/2.0.11 已经发过了，版本号还是 2.0.10:发版前没改版本号?」,不建分支。

5. **拉版本分支**:`git checkout -b dev/2.0.11`(从主干当前提交拉,切过去)。

6. **装提交拦截**:每次开版本都跑,幂等;它同时记下「按版本走」的本地记号(拦截没装上也记)。版本做到一半切回主干时,/dev-merge 会据它先问;发版时 /release-review 合入主干后卸掉拦截、清掉记号。`cgraphx release guard --json`,按输出说:
   - `status` 是 `repaired` → 多说一句「提交拦截被钩子工具冲掉过,已补回」
   - `status` 是 `unsupported` → 把 `notice` 原样转告(没装上的原因;链接、被跟踪的还带要加的几行和加在哪,加不加由用户定),再补一句「agent 的提交照样由提交前钩子拦下;终端里手敲的提交拦不到,发版审核时照样列进疑似夹带」;其余步骤照常
   - 命令报错 → 把输出原样告诉用户;分支照常保留

7. **回报**:「开始 2.0.11」,并说明分支只建在本地,见范例。

## 范例

上个版本 2.0.10 已发(/release-review 发版时打了 v2.0.10),要按版本开发 2.0.11,在 main 上输入 /release-start:

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
$ git checkout -b dev/2.0.11
Switched to a new branch 'dev/2.0.11'
$ cgraphx release guard --json
{
  "ok": true,
  "hookPath": "/Users/smdnk/objects/ai/cgraphx/.git/hooks/commit-msg",
  "status": "installed"
}
```

回给用户:

```text
开始 2.0.11

分支 dev/2.0.11 只建在本地,推不推远程由你定。dev/2.0.11 上直接提交会被拦下,只收合并提交和 chore(release): 开头的整版改动;每个需求在主目录输入 /dev-start <需求> 开副本来做。
```

## 停下问用户

| 情况 | 怎么做 |
|---|---|
| 不在主干上,或有改了没提交的已跟踪文件 | 停下,不建分支;提示先切回 main,或列出文件、提示先提交或收好 |
| 有版本分支还没合进主干 | 停下「dev/2.0.10 还没发，先跑 /release-review」 |
| 读不到版本号 | 问用户上个版本号 |
| 下个版本分支已存在且已合进主干 | 停下「dev/2.0.11 已经发过了，版本号还是 2.0.10:发版前没改版本号?」 |
| 提交拦截没装上(`unsupported`) | 把 `notice` 原样转告,补一句 agent 的提交照样拦、手敲的疑似夹带照样列出,其余照常 |

## 红线

1. ❌ 不推送分支。
2. ❌ 不打 tag:tag 由 /release-review 在发版合入时打。
3. ❌ 不改版本号:版本号由用户在版本分支上、发版审核前以 `chore(release): 版本号 <旧>→<新>` 提交。
4. ❌ 不删版本分支和副本。
