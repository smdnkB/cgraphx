# T-8: 知识库「需求副本」「版本分支」改写

> 产物: plan
> 依据: spec@e839c10

- 目标:知识库里的副本知识改成 worktree 口径——K1、带什么、怎么藏、删副本怎么处理分支;版本分支里提到旧副本行为的两处跟着改。
- 对应 spec 编号:F1、F3;K1、K4、K5、K9、K13、K15、K16;spec「文档」表
- 强制引用:无(文档任务)
- 涉及范围:`docs/knowledge/需求副本.md`、`docs/knowledge/版本分支.md`(两个文件,与其它任务不重叠)

## 必须严格执行

- `需求副本.md` 的 aliases 里删 `写时复制副本`,改 `worktree 副本`;Summary、K1、「开出来的副本里有什么」、删副本核对、命令、代码入口全部按新实现写。
- `版本分支.md` 只改提到旧副本行为的两三处(见下),审核、版本分支口径、报告格式等一字不动。
- 全部写完跑 `cgraphx docs validate`(每篇必须通过;非法文件会被索引跳过)。

## 允许局部适配

- 段落顺序、句子长短;frontmatter 里 `updated` 之外的其它字段。

## 具体要求

### A. `docs/knowledge/需求副本.md`

1. **frontmatter**
   - `aliases`:把 `写时复制副本` 改成 `worktree 副本`;其余保留。
   - `updated: 2026-11-06`。
   - `related_code` 加 `src/core/replica/carry.ts`、`src/core/replica/status.ts`。
   - `related_documents` 加 `docs/features/2026-11-06-副本改用worktree/副本改用worktree-spec.md`。
2. **Summary**:第一句改成「需求副本是一个需求独占的工作目录:由 `/dev-start`(程序侧 `cgraphx replica create`)在主目录旁边开出、并在主目录登记过的 git worktree,目录名 `<主目录名>@<文件前缀>`……」。保留「副本和主目录是同一个项目」「`shared` 链接只给版本流程、features 与 project 用」「知识库索引和『我的需求』索引各建各的」。最后一句改成「自己用 `git worktree add` 开的目录、`cp` 复制的目录不算副本」。
3. **命名与边界**
   - K1 改成:「副本 = 经 `/dev-start` 开出、在主目录 `.cgraphx/replicas/` 登记过的 git worktree。算:`cgraphx@订单导出`;不算:自己 `git worktree add` 开的目录、`cp` 复制的目录。」
   - K9 的最后一句「主目录一侧只查改了没提交的已跟踪文件,没被跟踪的新文件不拦,也不带进副本」保留,补一句「(主目录有改动只提示,不拦)」。
4. **关键约束与陷阱 →「开出来的副本里有什么」**(整块重写,按下面顺序)
   - worktree:与主目录同一个仓库,`git worktree add` 秒级;依赖和构建产物**不带**,第一次要在副本里安装、构建一次;Windows 返回 `unsupported_platform`。
   - 带 agent 配置:各已登记 agent 的配置目录、指引文件(`configDirName`、`instructionsFileName`)和额外配置(Claude Code 的 `.mcp.json`),只带**没被 git 跟踪**的部分;agent 自己开的 worktree(不管在哪家配置目录里)跳过;新增一家 agent 登记描述就一起带。
   - 带清单文件:主目录根下的 `.worktreeinclude`,gitignore 语法(一行一个路径,`#` 注释,可用通配),路径相对项目根;cgraphx 不创建、不提交,项目自己决定要不要提交(提交了团队共用);已被 git 跟踪的文件 worktree 本来就有,跳过;清单里的行主目录没有 → 提示、不带;`.cgraphx/` 下的不带。
   - 对 git 隐藏:带进来的文件在副本里用副本自己的 `core.excludesFile`(`<副本>/.cgraphx/replica-exclude`,内容是用户级忽略文件 + 这些路径)藏起来,主仓库为此开 `extensions.worktreeConfig`;主目录照常看得见;不写共享的 `.git/info/exclude`(worktree 共用,会盖住主目录)。这条也让 K10 不把带进来的 `.env`、`.mcp.json` 算成没提交。
   - 需求目录:这个需求目录下没被跟踪的文件拷进副本,其他步骤都成功后删主目录那份;删不掉提示手动删;内嵌的 git 仓库不删;被忽略的文件留在主目录(副本里已有一份)。
   - 副本的 `.cgraphx/` 只有 `.gitignore`、副本自己的知识库库文件和 `shared` 链接;需求分支从主目录当前所在的分支拉。
   - 登记不变:`name`、`path`、`featureId`、`branch`、`baseBranch`、`baseCommit`、`movedFiles`、`createdAt`、`removedAt`;删副本只填 `removedAt`。删副本时留下的分支,重开同一个需求会接上,`baseCommit` 沿用第一次那条,差几个提交照旧算(K15)。
   - 删掉 `no_cow`/`--full-copy`/写时复制/整份复制/pyvenv 的所有句子(包括「复制失败时只有克隆不了才报 no_cow」那条)。
5. **「开副本、删副本只在主目录执行」**:保留「在副本里、未初始化、项目根不是独立 git 仓库的根(含 worktree、子模块)、detached HEAD 都不行」的判定,把「整仓复制出来会和原仓库共用引用」改成「这些位置开出来的 worktree 不是需求副本(`/dev-start` 用 `replica create` 登记)`」。
6. **「删副本前的五条核对」** 改成六条:
   1. 登记过且没删;
   2. 目录就是登记的 `path`,不是主目录、也不是主目录的上级;
   3. 目录名是 `<主目录名>@…`;
   4. 目录里的 `.cgraphx/shared` 指向本主目录的 `.cgraphx/`;
   5. **确实是本仓库的 worktree**(`git worktree list` 里有它);
   6. 没有 K9 改动。
   删除用 `git worktree remove --force`(副本里常有被忽略的依赖);删完把登记填 `removedAt`,登记留着。需求分支按 K9 处理:已合入、或还没有提交的删;差提交的留着并在结果里给分支名与 `tip`;判断不了的留着;分支删不掉只提示。目录已被手动删掉 → `git worktree prune`,同样处理分支,再标已删(状态 `missing`)。
7. **「命令」**
   - `create` 去掉 `[--full-copy]`;补一句「开 worktree,带 agent 配置与清单文件,登记;接上删副本时留下的分支(`reattached`)」。
   - `remove` 补一句「结果带 `branch`(删了还是留着、删之前的 tip)」。
8. **「代码入口」**:`create.ts`(开 worktree)、`carry.ts`(带配置与清单、对 git 隐藏)、`status.ts`(K9 读主目录本地分支)、`remove.ts`(worktree 与分支)、`registry.ts`(登记)。删掉任何「写时复制」。
9. **Open Questions**:保留 Windows 一条;别的旧口径不要新增。

### B. `docs/knowledge/版本分支.md`

1. 「提交拦截放行什么」里「主目录一直有改动,`/dev-start` 报 `dirty_main`」改成「主目录一直有改动,开副本时只提示一句」。
2. 「装上的片段连同写进过的文件登记在……:……副本整仓复制带过去的登记里是主目录的文件,在副本里装、卸都不碰。」改成「……worktree 副本和主目录共用 git 公共目录,登记里的文件各按自己的工作区判断,在副本里装、卸不碰主目录那份。」
3. 「按登记补回缺了的钩子片段」那句的「新开的 worktree」后面补「(`/dev-start` 开副本时会补一次)」。
4. 「只保证高频场景」里的「同一仓库的多个 git worktree」改成「自己 `git worktree add` 开的多个 worktree(副本由 `/dev-start` 开、开时补钩子)」。
5. 其余不动;`updated` 改成 `2026-11-06`。

## 完成条件

```bash
node dist/cli/index.js docs validate docs/knowledge/需求副本.md
node dist/cli/index.js docs validate docs/knowledge/版本分支.md
grep -rn "写时复制\|no_cow\|full-copy\|整仓复制\|dirty_main" docs/knowledge/需求副本.md docs/knowledge/版本分支.md || echo "OK: 旧口径已清"
grep -n "worktree\|.worktreeinclude\|replica-exclude\|reattached" docs/knowledge/需求副本.md
```

两篇 `validate` 都通过;第一条 grep 无输出;第二条能命中。

## 提交点

1. `docs(knowledge): 需求副本与版本分支按 worktree 改写`: `docs/knowledge/需求副本.md`、`docs/knowledge/版本分支.md`

## 风险/注意事项

- 别把 `.worktreeinclude` 写成 cgraphx 创建/维护的文件;它由项目自己写。
- 「隐藏带来的文件」是副本自己的 `core.excludesFile` + 主仓库 `extensions.worktreeConfig`,不是 `.git/info/exclude`;写反了会指导用户踩坑。
- 删副本的分支规则要写全四种:已合入删、还没有提交删、差提交留、判断不了留。
- `版本分支.md` 改动很小,别顺手改审核口径与报告格式。
