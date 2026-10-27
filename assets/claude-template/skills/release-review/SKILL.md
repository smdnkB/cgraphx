---
name: release-review
description: 发版审核与合入主干:发版那天在版本分支 dev/<版本号> 上改好版本号,输入 /release-review,以上个版本的 tag 为起点出审核报告——按需求列提交、文件、增删行和测试,查疑似夹带、已声明的版本级提交、两个需求都改了的文件、敏感改动、和主干的合并预演、缺陷、版本号、不在本版本的需求,给出结论(可以发 / 有风险 / 不能直接合),存成 docs/releases/v<版本号>-发版审核.md 并提交到版本分支;用户说「发」再用合并提交合入主干,列出可以清理的副本问删不删。不打 tag、不发布、不推送。Use when 发版审核、出审核报告、准备发版、发版前检查、发吧、合入主干、release review。
---

# 发版审核与合入主干 (release-review)

## 定位

- 版本流程(可选)的发版一步:/release-start 开版本 → 各需求 /dev-start、/dev-merge → 发版那天先以 `chore(release): 版本号 2.0.10→2.0.11` 改好版本号,再 /release-review → 用户说「发」合入主干 → 发布照项目现有流程,发完 /release-start。
- 两段:先审核(出报告、提交到版本分支、对话里给结论);用户说「发」才合入主干,说「先不发」什么都不动。
- 报告摆事实、给结论,不拦发版:有风险发不发由用户定;和主干的预演有冲突时结论是「不能直接合」,这时不合。
- 在主目录、版本分支上执行。不打 tag、不发布、不推送。
- 说法:**主干** = `main`,没有 main、有 master 时用 master;**版本分支** = 名字是 `dev/数字.数字.数字` 的分支(`^dev/[0-9]+\.[0-9]+\.[0-9]+$`)。

## 流程

以版本分支 dev/2.0.11、主干 main、上个版本 v2.0.10 为例,命令里的版本号、分支名换成实际值。

### 审核

1. **查 git 版本**:`git version` → `git version 2.50.1`;低于 2.38 → 停下,提示合并预演要 git 2.38 以上,先升级 git。
2. **在版本分支上**:`git symbolic-ref --short HEAD` → `dev/2.0.11`;不是版本分支(在主干上、在副本的需求分支上)→ 停下,提示到主目录切到版本分支再跑。
3. **定起点,看有没有合入**:

   ```bash
   git merge-base main dev/2.0.11                                    # → <起点>
   git log --first-parent --merges --format=%h <起点>..dev/2.0.11    # 第一父链上有两个父提交的合并
   ```

   第二条没有输出 → 只回一句「dev/2.0.11 还没有合入任何需求」,停下。手动合并也算合入。

4. **按需求归组**:第一父链上说明是「合入需求：X」「合入需求：X(第 N 次)」的合并归到需求 X,X 的需求目录是 `cgraphx features list --json` 里 `title` 等于 X 的那条。找不到目录,或说明不是这个格式(手动合并,如 `Merge branch 'fix/登录超时' into dev/2.0.11`)→ 照常列出,需求一栏写分支名(取不到就写说明),标「未关联需求目录」。

5. **取事实**:逐项照下表取,都在主目录执行。

   | 报告项 | 取法 |
   |---|---|
   | 起点 tag | `git describe --tags --abbrev=0 --match 'v[0-9]*' <起点>` |
   | 版本分支上的提交 | `git log --first-parent --format='%H%x09%P%x09%s' <起点>..dev/2.0.11`:有两个父提交的是合入,其余是直接提交 |
   | 每次合入的提交数、文件、增删行 | 合入 M:`git rev-list --count --no-merges M^1..M^2`(副本里同步产生的合并提交不算);`git diff --numstat M^1 M` |
   | 疑似夹带 | ① 直接提交里不以 `chore(release):` 开头的;② 合入改了别的需求目录 `docs/features/<别的需求>/`;③ 越界改代码(第 6 步)。不判:本需求目录,`docs/knowledge/`、`docs/schema-knowledge/`、`docs/code-map/`、`docs/design-map/`,本需求的 `docs/bruno/<服务>/<本需求前缀>/` 和 bruno 的公共文件(`bruno.json`、`environments/`) |
   | 已声明的版本级提交 | 直接提交里以 `chore(release):` 开头的 |
   | 两个需求都改了的文件 | 各需求合入文件的交集 |
   | 敏感改动 | 合入改到的:`*.sql`;依赖清单 `package.json`、`package-lock.json`、`pnpm-lock.yaml`、`yarn.lock`、`pom.xml`、`build.gradle(.kts)`、`go.mod`、`go.sum`、`requirements*.txt`、`pyproject.toml`、`Cargo.toml`、`Cargo.lock`;配置 `.env*` |
   | 和主干合并的预演 | `git merge-tree --write-tree --name-only main dev/2.0.11` |
   | 测试情况与缺陷 | `cgraphx features show <需求>` 的测试环节(「缺(必需)」即缺测试),以及它列出的接口、单元、UI 测试报告里没通过的用例;第 2 次起的合入带进的提交里,说明以 `fix` 开头的 |
   | 版本号 | `git show dev/2.0.11:package.json` 的 version 对比起点 tag |
   | 开版本前已进主干 | `git log --format='%h %s' <起点 tag>..<起点>` |
   | 不在本版本的需求 | `cgraphx replica list --json` 里在用、没合入的 |
   | 疑似夹带是哪个会话提交的 | `cgraphx timeline query --type git_commit --since <起点日期> --limit 10000` 按 hash 对 session_id;对不上不写 |

   - 每次合入的数字一次取齐:

     ```bash
     B=$(git merge-base main dev/2.0.11)
     git log --first-parent --merges --format='%h %s' $B..dev/2.0.11 | while read -r M S; do
       echo "== $M $S · 提交 $(git rev-list --count --no-merges $M^1..$M^2)"
       git diff --numstat $M^1 $M
     done
     ```

   - 一个需求合入几次,提交、增删行相加,文件去重后计数;二进制文件 numstat 显示 `-`,计文件不计行数。
   - 合入里的疑似夹带落到提交:`git log --no-merges --format='%h %s' M^1..M^2 -- <文件>`;`<起点日期>` = `git log -1 --format=%cs <起点>`。
   - 「测试」一栏:测试环节是「✗ 缺(必需)」写「缺(必需)」;否则逐份写它列出的测试报告的结果(读报告的「结论」节),如「接口 12 个全过」「接口 8 个,2 个没过」;未关联需求目录的写「未关联需求目录」。
   - 「不在本版本的需求」取 `state` 是 `present`、`merged` 是 false 的,写副本路径和差几个提交(`ahead`)。
   - 预演有冲突时,每个冲突文件查涉及的需求:`git log --first-parent --merges --format=%s <起点>..dev/2.0.11 -- <文件>`(版本分支这边哪些合入改过),`git log --format='%h %s' <起点>..main -- <文件>`(主干那边哪些提交改过)。

6. **越界改代码**(疑似夹带第 ③ 类):读该需求 `docs/features/<需求目录>/plan/*-index.md`「任务清单」的「涉及范围」;没有 plan 读 spec 写到的模块;合入改到的代码文件(「不判」的除外)不在里面 → 疑似夹带。plan 和 spec 都没写范围 → 报告标「未声明范围」,不判。

7. **写报告**:`docs/releases/v2.0.11-发版审核.md`(`mkdir -p docs/releases`;重跑时覆盖同一个文件)。照「报告范例」的头部、节标题和顺序写,没有内容的节写「无」;不写 `> 产物:`。头部一行逐字:

   ```text
   > 版本分支: dev/<版本号> · 起点: v<上个版本号> · 审核时最新提交: <7 位 hash> · 日期: <YYYY-MM-DD>
   ```

   「审核时最新提交」取写报告之前的 `git rev-parse --short=7 dev/2.0.11`,日期取当天。结论:
   - 和主干的预演有冲突 →「不能直接合」,写出冲突文件和涉及的需求
   - 否则「风险」一节不空 →「有风险」,后面接风险各条
   - 否则 →「可以发」
   - 进「风险」的只有:版本号没改(提示以「chore(release): 版本号 2.0.10→2.0.11」提交)、需求缺测试、测试报告里有没通过的用例、疑似夹带。敏感改动、两个需求都改了的文件、未关联需求目录、未声明范围只列出,不进风险

8. **提交报告**,只提交这一个文件:

   ```bash
   git add docs/releases/v2.0.11-发版审核.md
   git commit -m "chore(release): 2.0.11 发版审核报告" -- docs/releases/v2.0.11-发版审核.md
   ```

   提交门禁拦下时,按提示自查暂存的这个文件,说明不改,带 `CGRAPHX_PRECOMMIT_REVIEWED=1` 重试。

9. **对话里给结论和摘要**(见范例),等用户说「发」或「先不发」;说「先不发」→ 什么都不动。

### 合入主干(用户说「发」)

1. **查结论**:读 `docs/releases/v2.0.11-发版审核.md` 的「结论」。是「不能直接合」→ 不合,说明冲突文件和涉及的需求,怎么解决由用户定。还没有这份报告 → 先走「审核」。
2. **报告过期没有**:

   ```bash
   git log --first-parent --merges --format=%h 3f9c2e1..dev/2.0.11    # 3f9c2e1 = 报告头部的「审核时最新提交」
   ```

   有任何输出(审核之后第一父链上又出现了合并,不论说明是什么格式)→ 报告过期,提示重跑 /release-review,这次不合。只多了 `chore(release):` 提交(审核报告本身、补改版本号)不算过期。
3. **工作区**:`git status --porcelain --untracked-files=no` 有输出 → 停下,列出文件,提示先提交或收好(没被跟踪的新文件不拦)。
4. **预演**:`git merge-tree --write-tree --name-only main dev/2.0.11; echo "exit=$?"`,`exit=1` 即有冲突(第一行是合并结果的树,之后到空行为止是冲突文件)→ 停下,列出冲突文件。
5. **合入**:先看主干上有没有不在版本分支里的提交,再切过去合:

   ```bash
   git log --format='%h %s' dev/2.0.11..main     # 有输出 → 逐行写进说明正文
   git checkout main
   git merge --no-ff dev/2.0.11 -m "发布 2.0.11:合入 订单导出、积分发放、退款、fix/登录超时" -m "7e8f9a0 fix: 线上登录页白屏"
   ```

   标题按报告「本版本的需求」的顺序,用顿号隔开;主干上没有多出的提交就不带第二个 `-m`。
6. **不打 tag、不发布、不推送**(版本号已在版本分支上改好)。
7. **清理副本**:`cgraphx replica list --json`,没有副本就跳过。按 `merged` 分:true 的可以删;false 的留着,跟到下个版本(`ahead` 是差几个提交);`state` 是 `missing` 的标「已不在」。照这句问:

   「cgraphx@订单导出、cgraphx@积分发放 已合入,可以删;cgraphx@导出优化 还差 2 个提交没合入，留着，跟到下个版本;删掉这 2 个已合入的副本吗?」

   用户说删 → 逐个 `cgraphx replica remove <副本目录名> --json`(已不在的也跑,只补登记,不报错);返回 `"code": "dirty"` → 不删,报「cgraphx@订单导出 有 2 个文件没提交」并列出 `files`。
8. **提示**:「发布照你们现在的流程走;发完跑 /release-start」

## 范例

### 报告

`docs/releases/v2.0.11-发版审核.md`:

```markdown
# 发版审核: 2.0.11

> 版本分支: dev/2.0.11 · 起点: v2.0.10 · 审核时最新提交: 3f9c2e1 · 日期: 2026-11-03

## 结论

有风险:积分发放缺测试;退款有 2 个接口测试用例没通过;疑似夹带 2 处(9a8b7c6 直接提交在 dev/2.0.11 上;订单导出的合入改了 src/points/award.ts,它的 plan 只写了 src/order/)。

## 本版本的需求

| 需求 | 合入 | 提交 | 文件 | 增删行 | 测试 |
|---|---|---|---|---|---|
| 订单导出 | 2 次 | 4 | 9 | +312 −40 | 接口 12 个全过 |
| 积分发放 | 1 次 | 3 | 6 | +205 −12 | 缺(必需) |
| 退款 | 1 次 | 2 | 5 | +148 −9 | 接口 8 个,2 个没过 |
| fix/登录超时 | 1 次 | 1 | 1 | +3 −1 | 未关联需求目录 |

## 疑似夹带

- 9a8b7c6 feat(points): 积分过期提醒——直接提交在 dev/2.0.11 上,不是 chore(release): 开头(绕过了拦截)
- 订单导出的合入 a1c3e5f 改了 src/points/award.ts——它的 plan 涉及范围只有 src/order/;是 7b3c2d1 feat(order): 导出带上积分列 改的,会话 4f2a9c1e-7b1d-4c3e-9a2f-1d2c3b4a5e6f

## 已声明的版本级提交

- 6d5e4f3 chore(release): 知识库补退款口径
- 3f9c2e1 chore(release): 版本号 2.0.10→2.0.11

## 两个需求都改了的文件

- src/order/routes.ts:订单导出、退款
- src/points/award.ts:订单导出、积分发放

## 敏感改动

- 退款:sql/2026-10-29-refund_record.sql
- 积分发放:package.json、package-lock.json
- 订单导出:.env.example

## 和主干合并的预演

没有冲突。

## 缺陷

- 退款:接口测试报告里 2 个用例没通过——退款金额超过实付、同一订单重复退款(docs/features/2026-10-29-退款/退款-接口测试报告.md)
- 订单导出:第 2 次合入带进的修复——9c8d7e6 fix(order): 导出文件名缺租户编号

## 版本号

已改:dev/2.0.11 上是 2.0.11,起点 v2.0.10 是 2.0.10(3f9c2e1)。

## 开版本前已进主干、本版本首次发布

- 5d6e7f8 docs: 部署说明补上回滚步骤

## 不在本版本的需求

- 导出优化:副本 /Users/smdnk/objects/ai/cgraphx@导出优化,差 2 个提交

## 风险

- 积分发放缺测试
- 退款有 2 个接口测试用例没通过
- 疑似夹带 2 处:9a8b7c6 直接提交在 dev/2.0.11 上;订单导出的合入改了 src/points/award.ts,它的 plan 只写了 src/order/
```

### 审核完的回复

```text
dev/2.0.11 审核完了,报告已提交:docs/releases/v2.0.11-发版审核.md(chore(release): 2.0.11 发版审核报告)。

结论:有风险
- 积分发放缺测试
- 退款有 2 个接口测试用例没通过
- 疑似夹带 2 处:9a8b7c6 直接提交在 dev/2.0.11 上;订单导出的合入改了 src/points/award.ts,它的 plan 只写了 src/order/

摘要:合入 订单导出(2 次)、积分发放、退款,另有未关联需求目录的 fix/登录超时;和 main 合并预演没有冲突;版本号已改成 2.0.11;导出优化 还在副本里,差 2 个提交,不在本版本。

说「发」就合入 main;说「先不发」什么都不动。
```

### 合入主干

用户说「发」:

```text
$ git log --first-parent --merges --format=%h 3f9c2e1..dev/2.0.11
$ git status --porcelain --untracked-files=no
$ git merge-tree --write-tree --name-only main dev/2.0.11; echo "exit=$?"
4b7e2a9c0d1f3e5a7b9c1d3e5f7a9b1c3d5e7f9a
exit=0
$ git log --format='%h %s' dev/2.0.11..main
7e8f9a0 fix: 线上登录页白屏
$ git checkout main
$ git merge --no-ff dev/2.0.11 -m "发布 2.0.11:合入 订单导出、积分发放、退款、fix/登录超时" -m "7e8f9a0 fix: 线上登录页白屏"
$ cgraphx replica list --json
(cgraphx@订单导出、cgraphx@积分发放、cgraphx@退款 "merged": true;cgraphx@导出优化 "merged": false、"ahead": 2)
```

回给用户:

```text
已合入 main,合并说明「发布 2.0.11:合入 订单导出、积分发放、退款、fix/登录超时」,正文列了 main 上多出的 1 笔(7e8f9a0 fix: 线上登录页白屏)。没打 tag、没发布、没推送。

cgraphx@订单导出、cgraphx@积分发放、cgraphx@退款 已合入,可以删;cgraphx@导出优化 还差 2 个提交没合入，留着，跟到下个版本;删掉这 3 个已合入的副本吗?
```

用户说删,cgraphx@积分发放 返回 `dirty`:

```text
已删 cgraphx@订单导出、cgraphx@退款,登记和数据都留着。cgraphx@积分发放 有 2 个文件没提交,没删:src/points/expire.ts、src/points/expire.test.ts。

发布照你们现在的流程走;发完跑 /release-start
```

## 停下问用户

| 情况 | 怎么做 |
|---|---|
| git 低于 2.38 | 停下,提示升级 git |
| 当前分支不是版本分支 | 停下,提示到主目录切到版本分支再跑 |
| 版本分支上还没有合入 | 只回「dev/2.0.11 还没有合入任何需求」 |
| 审核完 | 给结论和摘要,等用户说「发」或「先不发」 |
| 说「发」时还没有这个版本的报告 | 先走「审核」,给出结论后再等用户说「发」 |
| 说「发」时结论是「不能直接合」 | 不合,说明冲突文件和涉及的需求 |
| 说「发」时报告过期 | 提示重跑 /release-review,这次不合 |
| 说「发」时有改了没提交的已跟踪文件,或预演有冲突 | 停下,列出文件 |
| 合入主干后有可以删的副本 | 问过再删;有没提交的改动的不删,报「cgraphx@订单导出 有 2 个文件没提交」 |

## 红线

1. ❌ 不打 tag、不发布、不推送。
2. ❌ 用户没说「发」不合入主干;报告过期、预演有冲突、结论是「不能直接合」时不合。
3. ❌ 不替用户改版本号:只记进风险,提示以 `chore(release): 版本号 <旧>→<新>` 提交。
4. ❌ 删副本前必须问。
