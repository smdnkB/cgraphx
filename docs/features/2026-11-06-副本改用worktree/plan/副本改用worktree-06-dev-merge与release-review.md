# T-6: dev-merge 与 release-review 改写

> 产物: plan
> 依据: spec@e839c10

- 目标:`/dev-merge` 的合入与同步直接使用同一个仓库里的 `refs/heads/<分支>`,不再 fetch;删副本的说法改成「提交留在分支上」;`/release-review` 清理副本时回报分支结果。
- 对应 spec 编号:F2、F3、F4;D11;K8、K9、K10、K11、K12、K13;spec「文档」表
- 强制引用:无(文档任务)
- 涉及范围:`assets/claude-template/skills/dev-merge/SKILL.md`、`assets/claude-template/skills/release-review/SKILL.md`(两个文件,与其它任务不重叠)

## 必须严格执行

- 合入与同步的所有 git 命令都写全 `refs/heads/<分支>`,不写裸分支名(同名 tag 会抢先)。
- 删掉两处 `git fetch`(同步处、主目录合入处)与红线里「从副本取回需求分支」那条;文件里不出现 `fetch` 这个词(命令、说明、红线一律用「取远程对象」)。
- 删副本不再说「提交跟着没了」;`branch` 结果来自 C-7,`dirty`/`state`/`merged` 的说法不变。

## 允许局部适配

- 说明文字的措辞、范例里的 hash 与路径;命令本身与判定行不换。

## 具体要求

### A. `dev-merge/SKILL.md`

1. **frontmatter description**:去掉「从副本取回需求分支」;补一句「同一个仓库,合入、同步直接用 `refs/heads/<分支>`」。结尾的 `不推送,不把副本加成远程` 改成 `不推送、不取远程对象,不把副本加成远程`。
2. **「定位」节**:
   - 在「副本里同步主目录的分支只用 /dev-merge」那条之前加一条:「副本和主目录是同一个仓库:需求分支就在主目录的仓库里。合入、同步都直接写全 `refs/heads/<分支>`,不 fetch、不建远程。」
   - 第 21 行「副本里同步主目录的分支只用 /dev-merge……」保留(仍然成立)。
3. **「在副本里:同步」第 3 步**:

   ```bash
   git merge --no-ff -m "同步 dev/2.0.11" refs/heads/dev/2.0.11
   ```

   删掉 `git fetch --no-tags ...` 那一行;冲突处理、`git commit --no-edit`、门禁那段不变。
4. **「在主目录:合入」**:
   - 第 1 步:`state` 是 `missing` → 停下「cgraphx@订单导出 已不在;需求分支还在的话,先 /dev-start 订单导出 接上再合」;其余判断不变。
   - 第 5 步整段替换成「确认主目录里有这个分支」:

     ```bash
     git rev-parse -q --verify refs/heads/feat/订单导出
     ```

     输出为空 → 停下,文案按 F2 ⑥:「主目录没有分支 feat/订单导出,合不了;核对分支是不是被改名或删掉了」。
   - 第 6 步预演:

     ```bash
     git -c core.quotePath=false merge-tree --write-tree --name-only HEAD refs/heads/feat/订单导出; echo "exit=$?"
     ```

   - 第 8 步合入:

     ```bash
     git merge --no-ff -m "合入需求：订单导出" refs/heads/feat/订单导出
     ```

   - 第 9、10 步不变;第 11 步「没开版本就问删不删」的结果处理按下面「删副本」。
5. **「删副本」节**:
   - `merged` 是 false、`ahead` 大于 0 →「cgraphx@订单导出 还差 2 个提交没合入;目录删了,提交留在分支 feat/订单导出 上,/dev-start 订单导出 能接着做」,再问还删不删。
   - 其余状况(`dirty`、`ahead` 为 0、`merged` true、`merged` null、`state` missing)的判定与说法保留。
   - 用户说删后:
     - `"state": "removed"` → 「已删 cgraphx@订单导出,登记和数据都留着」;再看 `branch.state`:`deleted` → 加「分支 feat/订单导出 已删除」;`kept` → 加「分支 feat/订单导出 留着,提交还在;接着做:/dev-start 订单导出」。
     - `"state": "missing"` → 「cgraphx@订单导出 已不在,登记已标成已删」,同样按 `branch.state` 补前缀那句。
     - `warnings` 逐条转告。
     - `"code": "dirty"` 与其余 `code` 的处理不变。
6. **范例**:
   - 删掉 `$ git fetch --no-tags ...` 那一行,换成 `$ git rev-parse -q --verify refs/heads/feat/订单导出`(输出 40 位 hash)。
   - `merge-tree`、`merge` 两条命令的分支参数改成 `refs/heads/feat/订单导出`。
   - 副本同步范例的 `git fetch` + `git merge FETCH_HEAD` 改成一条 `git merge --no-ff -m "同步 dev/2.0.11" refs/heads/dev/2.0.11`。
   - 删副本范例补上 `branch` 结果与「分支留着,提交还在」的说法。
7. **「停下问用户」表**:
   - 更新「副本已不在」行:提示先 `/dev-start <需求>` 接上再合。
   - 加一行:「主目录没有 `refs/heads/<需求分支>`」→ 停下,提示核对分支是否被改名或删掉。
   - 加一行:「删副本时差提交」→ 照实说差几个、提交留在分支上,问过再删。
8. **「红线」**:
   1. ❌ 不推送、不取远程对象、不把副本加成远程;合入、同步都写全 `refs/heads/<分支>`,只合这个分支。
   2. ❌ 预演有冲突不合,不在主目录解决冲突。
   3. ❌ 版本分支上只做合并,不改代码。
   4. ❌ 删副本前必须问;有没提交的改动的不删。
   5. ❌ 没问过不跑 `cgraphx docs index`。

### B. `release-review/SKILL.md`

1. 「合入主干」第 7 步「清理副本」:
   - `merged` 是 true 的照旧放进可删组并问;差提交的说「差几个提交,留着,跟到下个版本」;还没有提交的、判断不了的、`missing` 的说法不变。
   - 用户说删后,逐个 `cgraphx replica remove <副本目录名> --json`;结果按 C-7 处理:
     - `"state": "removed"` 且 `"branch": { "state": "deleted" }` → 说「已删 cgraphx@订单导出(分支 feat/订单导出 已删除)」;
     - `"branch": { "state": "kept" }` → 说「已删 cgraphx@订单导出(分支 feat/订单导出 留着,提交还在)」;
     - `"state": "missing"` → 同样带分支结果;
     - `warnings` 逐条转告;
     - `"code": "dirty"` 与其余 `code` 的处理不变。
2. 范例里「用户说删」的回报改成带分支结果,例如:
   `已删 cgraphx@订单导出、cgraphx@退款(分支 feat/订单导出、feat/退款 已删除),登记留着,副本里记下的会话和提交在项目的数据里。cgraphx@积分发放 有 2 个文件没提交,没删:……`
3. 其余(审核、结论、风险、版本号、预演)一字不动。

## 完成条件

```bash
grep -n "fetch\|FETCH_HEAD\|ls-remote" assets/claude-template/skills/dev-merge/SKILL.md || echo "OK: 没有 fetch"
grep -n "refs/heads/" assets/claude-template/skills/dev-merge/SKILL.md
grep -n "branch" assets/claude-template/skills/release-review/SKILL.md | head
```

第一条无输出;第二条至少覆盖:同步、确认分支、预演、合入、红线;release-review 的第 7 步与范例都有分支结果。

## 提交点

1. `docs(skills): dev-merge 直接用需求分支——合入、同步不再 fetch`: `assets/claude-template/skills/dev-merge/SKILL.md`
2. `docs(skills): release-review 清理副本时带分支结果`: `assets/claude-template/skills/release-review/SKILL.md`

## 风险/注意事项

- 同步、预演、合入、红线四处都要写 `refs/heads/`,漏一处就会在存在同名 tag 时合错。
- `git rev-parse -q --verify` 失败时输出为空、退出码非零;流程里按「输出为空」判断,别写成看退出码弹提示后又继续。
- 删副本的「差提交」说法要同时保留「目录删了」和「提交留在分支上」两半,否则用户会以为提交没了。
- `release-review` 只改第 7 步与范例;审核、结论、风险的表和条文不要动。
