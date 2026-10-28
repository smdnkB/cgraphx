# 实现计划: 版本流程与需求副本

> 产物: plan
> 依据: spec@16dc4b2

## 设计预览

原来发版时各需求的提交糅在同一个分支上,几个会话并行时改动也落在同一个分支;cgraphx 只认项目自己的 `.cgraphx/`。这次程序侧新增两个子系统:replica 开、列、删副本,并在主目录 `.cgraphx/replicas/` 登记;release 装版本分支的提交拦截。基础层新增数据目录解析(副本经 `.cgraphx/shared` 链接读写主目录的数据)和 git 钩子片段写入(跟随 core.hooksPath,只动本机:仓库外的共用目录、被 git 跟踪的钩子文件、链接都不写,给出原因和要加的几行;会话开始时按登记补回被冲掉的片段)。timeline 用 post-merge 钩子记下合并提交;task、sync、features 按「主目录 + 全部登记过的副本」换算路径,把副本里的会话归到它登记的需求。skill 侧新增 release-start、release-review、dev-start、dev-merge 四个,改 dev-impl-subagent、dev-impl、dev-handoff、dev-spec、doc-report 五个;流程图、使用指南、两份 CLAUDE.md、CHANGELOG、知识库同步。没开版本、没开副本的项目,除了记下合并提交、钩子装进 core.hooksPath 指向的目录,行为和输出不变。

**难回头的决策落在哪**(决策已在 spec 确认,这里核对落点,其余可略读)

| spec 决策 | 落在 | 怎么守住 |
|---|---|---|
| D1 🔒 新增 replica、release 两个子系统;task、sync、features → replica | T-2 `src/core/replica/`、T-3 `src/core/release/`、T-1 `src/core/git-hooks.ts` | replica、release 只 import 基础层与 agents 门面(C-4、C-6);别的子系统只写 `from '../replica'`;统一验证 4 查 import |
| D18 🔒 副本的 `.cgraphx/` 是普通目录,里面 `shared` 链接指回主目录的 `.cgraphx/` | T-2 `src/core/replica/create.ts` 建目录和链接;T-1 `src/core/directory.ts` 的 `resolveDataDir` 解析 | 链接名、登记目录名只在 `directory.ts` 定义(C-1);统一验证 5 第 ⑥ 步实测在副本里 `rm -rf .cgraphx/` |
| D19 🔒 登记存主目录 `.cgraphx/replicas/<副本目录名>.json`,记开副本时的 `baseCommit` | T-2 `src/core/replica/registry.ts` 写;T-1 `directory.ts` 读 `path`、`removedAt`;T-2 `status.ts` 读 `baseCommit` 判 K3 | 格式按 C-3,写入走临时文件 + rename;删副本只填 `removedAt`;目录名已登记给别的需求 → `name_taken`(C-5) |
| D28 🔒 副本里没对上会话的提交,每个副本单独上报一个会话 | T-6 `src/core/sync/payload.ts`;本地并进 T-5 `src/core/task/feature-link.ts` 的 `commits` | 会话 id 与绑定按 C-11,绑定的任务经 task 门面的 C-13 取;平台侧确认之前不发版(见待确认项) |
| D32 🔒 合并提交记成 git_commit,文件列表为空,统计进 `metadata.merge`;快进按 reflog 判断,不记 | T-4 `src/core/timeline/hooks.ts`、`installer.ts` | 格式按 C-7;统一验证 5 第 ④ 步、统一验证 9 查记录 |
| D35 🔒 删副本前逐条核对,删除不跟随链接 | T-2 `src/core/replica/remove.ts` | 五条核对全过才删(C-5 的 `unsafe_target`);统一验证 5 第 ⑤ 步 |

## 来源 spec

`docs/features/2026-10-27-版本流程与需求副本/版本流程与需求副本-spec.md`(spec@c1c2920):每个版本一个版本分支,每个需求在自己的写时复制副本里做、做完合入,发版前出审核报告再合进主干;副本里的会话、提交、任务归属记进主目录,知识库索引和「我的需求」索引各目录各建各的;整套流程按需启用。

## 范围

覆盖 F1~F4、F7~F10;spec 决策 D1~D37 全部落进任务(见「细节方案核对」)。

## 明确不包含

- F11 Claude Code 记忆迁进知识库(归 `2026-10-27-记忆迁进知识库`)
- 功能方案的不做项:同目录下的提交与合并(原 F5)、文件租约(原 F6)、线上修复回流、发版说明、多个版本同时开发、发布本身
- Windows 上的副本;副本和主目录同时起服务的端口冲突(spec 全局约束)
- web 的任务详情页展示「副本里没对上会话的提交」(D28 只要求 `cgraphx task show`)
- 新写测试:spec 设计验收里的单元测试项由全部任务完成后的 `/unit-spec` → `/unit-code` 补;本 plan 只要求既有测试不被弄红
- 本仓库根目录 `.claude/`、上级目录 `.claude/` 是部署出来的运行环境,由 `cgraphx install` 刷新,不手改
- 版本号:发版时另走 `npm version`

## 任务清单

| 任务 | 文件 | 对应 spec | 涉及范围 |
|---|---|---|---|
| T-1 程序:基础层——数据目录与钩子片段 | `plan/版本流程与需求副本-01-程序-基础层.md` | F8、D24、D33 | `src/core/directory.ts`、`src/core/git-hooks.ts`(新)、`src/core/db/index.ts`、`src/core/markdown/schema-bootstrap.ts`、`src/core/timeline/turn-state.ts`、`src/core/task/source.ts`、`src/core/dbquery/config.ts`、`src/core/dbquery/logging.ts`、`src/core/dbquery/init.ts` |
| T-2 程序:replica 子系统 | `plan/版本流程与需求副本-02-程序-replica子系统.md` | F7、F9、D1、D18~D22、D26、D35;K1、K3、K9 | `src/core/replica/` 下 10 个新文件 |
| T-3 程序:release 子系统 | `plan/版本流程与需求副本-03-程序-release子系统.md` | F2⑥、F10、D1、D5、D12 | `src/core/release/` 下 6 个新文件 |
| T-4 程序:timeline 记合并提交 | `plan/版本流程与需求副本-04-程序-timeline合并提交.md` | F8、D32、D33;全局约束(副本里拒绝清数据) | `src/core/timeline/installer.ts`、`hooks.ts`、`constants.ts`、`recorder.ts`、`cli.ts` |
| T-5 程序:task 多根换算与副本会话归属 | `plan/版本流程与需求副本-05-程序-task归属.md` | F8、D25~D28 | `src/core/task/auto-binding.ts`、`artifacts.ts`、`feature-task.ts`、`report.ts`、`feature-link.ts`、`resolve.ts`、`index.ts` |
| T-6 程序:sync 以主目录上报 | `plan/版本流程与需求副本-06-程序-sync上报.md` | F8、D25、D26、D28、D29 | `src/core/sync/runner.ts`、`payload.ts`、`artifacts.ts`、`paths.ts`、`git.ts`、`hooks.ts`、`lock.ts`、`cli.ts`、`constants.ts`、`references.ts` |
| T-7 程序:features 列出副本里的需求 | `plan/版本流程与需求副本-07-程序-features列出副本需求.md` | F8、D30 | `src/core/features/index.ts`、`types.ts`、`scanner.ts`、`cli.ts`、`sync.ts` |
| T-8 程序:CLI 入口与 web | `plan/版本流程与需求副本-08-程序-CLI入口与web.md` | D1、D12、D24、D31、D33(安装时的提示);全局约束 | `src/cli/index.ts`、`src/cli/installer/index.ts`、`src/cli/installer/agent-steps.ts`、`src/web/bootstrap.ts`、`src/core/markdown/indexer.ts` |
| T-9 skill:新增四个 | `plan/版本流程与需求副本-09-skill-新增四个.md` | F1~F4、F7、F9、F10、D2~D10、D13~D17、D20~D22、D35;全局约束(git 版本) | `assets/claude-template/skills/` 下 `release-start`、`release-review`、`dev-start`、`dev-merge` 四个新目录,各一个 `SKILL.md` |
| T-10 skill:改五个 | `plan/版本流程与需求副本-10-skill-改五个.md` | F2⑥、F7、F8、F10、D11、D22、D23、D34、D36 | `assets/claude-template/skills/` 下 `dev-impl-subagent`、`dev-impl`、`dev-handoff`、`dev-spec`、`doc-report` 的 `SKILL.md` |
| T-11 文档:流程图、指南与知识库 | `plan/版本流程与需求副本-11-文档-流程图与指南.md` | D37;全局约束末条 | `assets/claude-template/FLOW-MAP.md`、`assets/claude-template/CLAUDE.md`、`assets/claude-template/skills/cgraphx-guide/` 下 `SKILL.md`、`how-to-use.md`、`how-to-use.html`、`skills.html`,本仓库 `CLAUDE.md`、`CHANGELOG.md`,`docs/knowledge/需求副本.md`(新)、`docs/knowledge/版本分支.md`(新) |

## 执行顺序

- **第 0 步(主会话,开工前)**:
  1. 分支:从 `feat/需求目录命名可配置` 拉 `feat/版本流程与需求副本`(本 plan 依据的代码在这条分支上,起草时它比 main 多 9 个提交,含兄弟需求「记忆迁进知识库」的 eaeccb5);它已合进 main 时改从 main 拉。`git status` 确认暂存区是空的。
  2. 提交本需求的文档:`docs: 版本流程与需求副本——spec + plan`(`docs/features/2026-10-27-版本流程与需求副本/` 下全部文件)。
  3. 留基线,供统一验证 3、4 对比:

  ```bash
  mkdir -p .cgraphx/baseline/版本流程
  git rev-parse HEAD > .cgraphx/baseline/版本流程/base-commit
  npm run build
  node dist/cli/index.js features list --json > .cgraphx/baseline/版本流程/features-before.json
  node dist/cli/index.js task list --local --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log(JSON.stringify(r.tasks.filter(x=>x.source==='feature').map(x=>({featureId:x.featureId,name:x.name})),null,1))})" > .cgraphx/baseline/版本流程/tasks-before.json
  ```

- **第 1 步**:T-1、T-9、T-10、T-11 **同时跑**——改的文件不重叠;T-9~T-11 只写 skill 和文档,用到的命令、命名、文案都在下方契约里定死,不等程序。
- **第 2 步**:T-2、T-3、T-4 **同时跑**——都只用 T-1 已提交的 C-1、C-2,彼此改的文件不重叠。
- **第 3 步**:T-5、T-6、T-7、T-8 **同时跑**——都只用 T-2 已提交的 C-4(T-8 还用 T-3 的 C-6、T-4 的 C-7 报告字段),彼此改的文件不重叠;T-6 用 T-5 同一步实现的 C-13,签名在本 index 定死,照签名调用、不等 T-5(子 agent 不构建,第 4 步统一构建);T-6 交给 task 门面的已经是主目录。
- **第 4 步(主会话)**:每一步收齐回报就按各任务的提交点提交(子 agent 只改文件,不构建、不测试、不提交);全部提交后跑「统一验证」。有不通过的项 → 修好后单独提交 `fix(<scope>): …`,再从头跑一遍统一验证。

## 必须严格执行的契约

- **C-1 数据目录**(T-1 实现;T-2、T-4、T-5、T-6、T-7、T-8 只用不改)
  - `src/core/directory.ts` 新增导出:

    ```ts
    export const SHARED_LINK_NAME = 'shared';
    export const REPLICAS_DIRNAME = 'replicas';
    export type DataDirState = 'own' | 'replica' | 'main-missing';
    export interface DataDirInfo {
      /** 共用数据所在目录的绝对路径 */
      dir: string;
      state: DataDirState;
      /** own:项目根本身;replica / main-missing:dir 的上级目录 */
      mainRoot: string;
    }
    export function resolveDataDir(projectRoot: string): DataDirInfo;
    export function getDataDir(projectRoot: string): string; // = resolveDataDir(projectRoot).dir
    ```

  - 规则(spec D24),`local = getCodeGraphDir(projectRoot)`,`link = path.join(local, SHARED_LINK_NAME)`:
    1. link 不存在或不是符号链接(lstat)→ `{ dir: local, state: 'own', mainRoot: path.resolve(projectRoot) }`
    2. `target = path.resolve(local, fs.readlinkSync(link))`;target 不存在 → `{ dir: target, state: 'main-missing', mainRoot: path.dirname(target) }`
    3. 读 `path.join(target, REPLICAS_DIRNAME, path.basename(realpath(projectRoot)) + '.json')`:能解析成对象,`realpath(json.path) === realpath(projectRoot)`,且 `json.removedAt` 为 null → `{ dir: realpath(target), state: 'replica', mainRoot: path.dirname(realpath(target)) }`
    4. 其余(没登记、已删除、读不了)→ 同 1
    - 任何异常按 1 处理,不抛
  - `src/core/db/index.ts`:`getDatabasePath(p)` 改为 `path.join(getDataDir(p), DATABASE_FILENAME)`;新增导出 `getLocalDatabasePath(p)` = `path.join(getCodeGraphDir(p), DATABASE_FILENAME)`(即原来的 getDatabasePath)
  - 不变:`codeGraphDirName`、`getCodeGraphDir`、`isInitialized`、`createDirectory`、`removeDirectory`、`resolveProjectRoot`、`unsafeIndexRootReason`
  - 走数据目录的:共用库(经 getDatabasePath)、timeline 轮次目录 `turns/`、task 的 `task-source.json`、db-query 项目级的 `db-profiles.json`(读写两头:`config.ts` 读、`init.ts` 写)与 `db-query.log`(以上 T-1 改);sync 的锁、存活、触发文件(T-6 改)
  - 主目录不在(`state === 'main-missing'`)时,写数据目录的地方一律不建目录、不写(spec D24):轮次文件写入、db-query 日志直接跳过;`db init` 写连接配置报错,message 用 C-12 的 D31 原文;web 启动预检由 T-8 先查库文件存在再开。其余写入方本来就在目录不存在时失败,不用改:timeline、task、sync 的 `open*Db` 都先查库文件存在再 `DatabaseConnection.open`,`task-source.json` 写入先查目录存在,sync 的锁和触发文件直接写、目录不在即失败。否则 `mkdirSync({ recursive: true })`(`DatabaseConnection.open` 里也有)会在旧主目录位置重建 `.cgraphx/`,解析随之退成 own,数据写进副本本地
  - 固定用本地目录的:知识库库文件(经 getLocalDatabasePath,T-1 改 markdown)、`my-features.md`(`src/core/features/sync.ts` 现在就拼本地 `.cgraphx`,不改)
- **C-2 钩子片段写入**(T-1 实现;T-3、T-4 只用不改)
  - `src/core/git-hooks.ts`(新;文件级辅助——路径与链接、片段行、shebang 判断、`.git/info/` 增删行——拆到 `src/core/git-hooks-files.ts`,只给它用,外部一律经 git-hooks.ts):

    ```ts
    export type GitHookName = 'post-commit' | 'post-merge' | 'commit-msg';
    export type HookSkipReason = 'not_shell' | 'outside_repo' | 'symlink' | 'tracked';
    export interface HookLinkTarget {
      path: string;                                   // 链接最终指向的文件
      scope: 'tracked' | 'outside_repo' | 'local';    // 被 git 跟踪 / 在仓库外 / 本机文件
    }
    export interface HookSnippetResult {
      /** 钩子文件绝对路径(unsupported 时为没写入的那个文件) */
      hookPath: string;
      status: 'installed' | 'present' | 'updated' | 'unsupported';
      /** unsupported 时:没写入的原因;symlink、tracked 带要用户自己加的几行 */
      reason?: HookSkipReason;
      lines?: readonly string[];
      /** reason 为 symlink 时:链接指向的文件 */
      linkTarget?: HookLinkTarget;
    }
    export function resolveHooksDir(cwd: string): string | null;
    export function gitPathPattern(relPosix: string): string;  // 工作区相对路径 → 只匹配它自己的 gitignore 模式
    export function appendGitInfoLines(file: string, lines: readonly string[]): void;  // 往 .git/info/ 下的文件追加行,不重复
    export function hookNotice(
      result: Pick<HookSnippetResult, 'hookPath' | 'reason' | 'lines' | 'linkTarget'> & { status: string },
      what?: string,
    ): string | null;  // 安装提示;status 不是 unsupported → null
    export function installHookSnippet(
      cwd: string,
      hook: GitHookName,
      marker: string,
      lines: readonly string[],
      opts?: { legacyMatch?: string },
    ): HookSnippetResult | null; // 不在 git 仓库 → null
    export function removeHookSnippet(
      cwd: string,
      hook: GitHookName,
      marker: string,
      opts?: { legacyMatch?: string },
    ): HookRemoveResult | null; // 不在 git 仓库 → null
    export interface HookRemoveResult {
      /** removed:删过片段的文件;unsupported:片段提交在仓库里、没删的文件;absent:当前的钩子文件 */
      hookPath: string;
      status: 'removed' | 'absent' | 'unsupported';
      reason?: 'tracked';                             // unsupported 时:片段在被跟踪的文件里,是提交进仓库的
    }
    export function hookRemoveNotice(result: HookRemoveResult, what?: string): string | null;  // 卸载提示;status 不是 unsupported → null
    export function repairHookSnippets(cwd: string): HookSnippetResult[];  // 按登记补回缺了的片段,返回这次尝试补装的结果
    ```

  - 规则(spec D33):
    - 只保证 spec F8 细节方案末尾那段列的高频场景;那段列的低频情况(多个 worktree、子模块、链接、非 UTF-8、写不进的钩子等)出了问题记作已知限制,不加处理
    - `resolveHooksDir`:在 cwd 下跑 `git rev-parse --git-path hooks`,输出按 cwd 解析成绝对路径;不在 git 仓库 → null。安装、卸载、补装内部用一次 `git rev-parse --git-path hooks --git-common-dir --show-toplevel` 取齐(bare 仓库没有工作区,这条以非零退出,前两项从它失败时的输出里取,不跑第二次)
    - 钩子目录分三处:在 git 公共目录里、在工作区里、都不在(仓库外;两边都解析链接后判断);两边都含它时按更深的那个算(bare 仓库目录里建的 worktree 算工作区)
    - 只写不被 git 跟踪的钩子文件。install 按下面的顺序判断,什么都不写、返回 `unsupported` 的四种:钩子目录在仓库外(`outside_repo`);文件已存在(链接看它指向的文件)而第一行 shebang 的解释器不是 sh / bash / zsh / dash / ksh(含 `/usr/bin/env sh` 这类写法),或没有 shebang 而内容含 NUL 字节(`not_shell`,不带 lines);钩子文件是符号链接(`symlink`,带 `linkTarget`;链接悬空时顺着链接里写的路径解析指向);钩子文件或链接指向的文件被 git 跟踪(`tracked`)。`symlink`、`tracked` 带 `lines`
    - 被跟踪的(含链接指向的、整个 `.git/hooks` 链进仓库的)按 git 判断,文件不在工作区里(删了没暂存、稀疏检出)也不新建。链接、被跟踪的,git 实际执行的那份(工作区那份,链接看它指向的文件)含 marker → `present`(团队提交的、自己照提示加了没提交的都算);安装一行不删
    - 其余:先删掉文件里所有含 marker 的行(给了 legacyMatch 时含它的行也删),再把 lines 插到第一行 shebang 之后,没有 shebang 就放最前;文件不存在 → 新建(钩子目录不存在时一并创建),内容为 `#!/bin/sh` 加 lines,权限 0755;已有文件写回后没有执行位就补上
    - 新建在工作区里的钩子文件(本来没被忽略的)→ `gitPathPattern(相对路径)` 写进 `.git/info/exclude`;git 目录里的(如默认的 `.git/hooks`)不写;之后队友提交了同名钩子,就按 `tracked` 处理
    - 装上(installed / present / updated)后:片段登记进 `<git 公共目录>/cgraphx/hook-snippets.json`(`[{ hook, marker, lines, legacyMatch?, files }]`;files 是写进过的钩子文件,目录取 realpath、文件名照原样;临时文件 + rename,内容没变不写盘)。登记 files 里不是这次写的文件按 git 判断归谁(在文件所在目录跑上面那条 rev-parse,比公共目录和工作区根;不按路径前缀):本工作区或 git 目录的 → 删掉其中的片段(按 remove 的规则判断能不能动),从 files 去掉;同一仓库别的 worktree 的 → 留在 files,只在卸载时删;别的仓库的(副本整仓复制带过去的登记)、目录已不在的 → 从 files 去掉,不碰。再删默认钩子目录 `<git 公共目录>/hooks` 里含 marker(及 legacyMatch)的旧行——两边解析链接后不是同一个目录、`<git 公共目录>/hooks` 解析后仍在 git 目录里、旧钩子文件不是链接时才删;删后只剩 shebang 或空白就删掉文件
    - status:原文件里没有含 marker 的行 → `installed`;插入后的内容与原文件逐字相同 → `present`(不写盘);其余 → `updated`
    - remove:先删登记;当前钩子文件、默认钩子目录里的旧行(规则同上)、登记 files 里本仓库的文件(别的 worktree 的按那个 worktree 判断,别的仓库的不碰)都按这几条删:钩子目录在仓库外、链到仓库外 → 不碰;被跟踪的 → 暂存区那份有片段行就不删(当前钩子文件是这种情况时返回 `unsupported`、reason `tracked`),只是本机残留就删掉这些行(只写回、不删文件);链到本仓库里没被跟踪的文件 → 删掉其中的片段行(只写回);其余删掉含 marker(及 legacyMatch)的行,剩下的只有 shebang 或空白 → 删掉文件,连同它在 exclude 里的那一行。删掉的行都在文件末尾(2.0.10 追加的写法)时,连同末尾空行去掉、只留一个换行。status:当前钩子文件删过 → `removed`;只删了别处的 → `removed`,hookPath 为删过的那个;都没有 → `absent`
    - repairHookSnippets:按登记逐条看,钩子文件里已有这个 marker 的跳过,其余在已取到的位置照 install 写(同样按上面四种不写判断、登记、迁走旧位置);补不上(`unsupported`)的删掉这条登记,不再每次重试;返回这次尝试补装的结果,不在 git 仓库、没有登记 → []
    - 提示:`hookNotice` 给出——`outside_repo` →「钩子目录 <目录> 在仓库外,是多个仓库共用的,没写入」;`symlink` →「钩子文件 <hookPath> 是链接,指向 <linkTarget.path>(被跟踪:它被 git 跟踪,加进去会随提交给全组 / 仓库外:它在仓库外,加进去会影响所有用它的仓库),没写入;要装的话,把下面几行加到它指向的文件第一行 shebang 之后(没有 shebang 就放最前):」加 lines;`tracked` →「钩子文件 <hookPath> 被 git 跟踪,没写入(写进去会出现在 git status 里、随提交给全组);要装的话,把下面几行加到它第一行 shebang 之后(没有 shebang 就放最前):」加 lines;`not_shell` →「钩子文件 <hookPath> 不是 shell 脚本,没写入」;「没写入」可由调用方换说法。`hookRemoveNotice` →「钩子文件 <hookPath> 被 git 跟踪,里面的片段是提交在仓库里的,没删;要去掉就从仓库里删掉这几行再提交」,「片段」可由调用方换说法
    - git 调用一律 `execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] })`,出错按「不在仓库」处理
- **C-3 登记文件**(T-2 写;T-1 的 resolveDataDir 只读 `path`、`removedAt`)
  - 路径:`<主目录数据目录>/replicas/<副本目录名>.json`,一个副本一个文件
  - 字段照 spec「细节方案:F7」的登记文件示例:`name`、`path`(绝对路径)、`featureId`、`branch`、`baseBranch`、`baseCommit`(开副本那一刻主目录的提交)、`movedFiles`(开副本时从主目录这个需求目录移进副本的文件,仓库相对路径:第 ① 步保留、第 ⑥ 步要从主目录移走的,内嵌的 git 仓库不算)、`createdAt`(ISO 8601)、`removedAt`(ISO 8601 或 null);读的时候 `baseCommit` 不是字符串、`movedFiles` 不是字符串数组(以前的登记)→ null,其余 7 个缺一个就按解析失败跳过
  - 写入:同目录先写临时文件再 rename;`replicas/` 不存在时创建;读到不认识的字段,写回时原样保留
- **C-4 replica 门面**(T-2 实现;T-5、T-6、T-7、T-8 只用,一律 `from '../replica'`)

  ```ts
  export interface ReplicaEntry {
    name: string; path: string; featureId: string; branch: string;
    baseBranch: string; baseCommit: string | null; movedFiles: string[] | null; createdAt: string; removedAt: string | null;
  }
  /** replica 为 null 即主目录;realRoot 是 root 的 realpath(目录不在时取最近一级在的上级的 realpath 拼回),在 listProjectRoots 里一次算好 */
  export interface ProjectRoot { root: string; realRoot: string; replica: ReplicaEntry | null }
  export interface ReplicaStatus extends ReplicaEntry {
    state: 'present' | 'missing' | 'removed';
    merged: boolean | null;   // K3;还没有提交为 false;state 不是 present、git 判不了时为 null
    ahead: number | null;     // 需求分支自己做的提交里还没合入的个数;已合入、还没有提交为 0,不判时为 null
    dirty: string[];          // K9 文件列表(仓库相对路径)
  }
  export interface CreateReplicaResult extends ReplicaEntry { created: boolean; movedFiles: string[]; warnings: string[] }  // 副本已在时 movedFiles 照登记,以前的登记为 []
  export interface RemoveReplicaResult { name: string; state: 'removed' | 'missing' }

  export function resolveMainRoot(projectRoot: string): string;
  export function listReplicas(projectRoot: string, opts?: { includeRemoved?: boolean }): ReplicaEntry[];
  export function listProjectRoots(projectRoot: string): ProjectRoot[];
  export function matchProjectRoot(roots: readonly ProjectRoot[], absPath: string): { root: ProjectRoot; rel: string } | null;
  export function replicaOfCwd(roots: readonly ProjectRoot[], cwd: string): ReplicaEntry | null;
  export function locateFeatureRoot(roots: readonly ProjectRoot[], featureId: string): string | null;  // roots 是 listProjectRoots 的返回
  export function createReplica(projectRoot: string, opts: { featureId: string; prefix: string; branch: string; fullCopy?: boolean }): CreateReplicaResult;
  export function listReplicaStatus(projectRoot: string, opts?: { includeRemoved?: boolean }): ReplicaStatus[];
  export function removeReplica(projectRoot: string, nameOrFeatureId: string): RemoveReplicaResult;
  export { ReplicaError, exitCodeForError } from './errors';
  ```

  - `resolveMainRoot` = `resolveDataDir(projectRoot).mainRoot`;其余函数入口先换成主目录
  - `listReplicas`:读主目录数据目录下的 `replicas/*.json`,解析不了的跳过;默认不含 removedAt 非空的;按 createdAt 升序
  - `listProjectRoots`:主目录(replica 为 null)加全部登记(含已删除),按 root 路径长度降序
  - `matchProjectRoot`:absPath 先 `path.resolve`;每份 roots 建一次查找表(root → 根、realRoot → 根各一张,按 roots 对象缓存;同一路径登记过多次时取在用的,都删了取 createdAt 最新的),从 absPath 的上级目录逐级往上查表,第一个命中的就是最长的根——耗时只看路径深度,和登记了多少副本无关;都不中时取 absPath 所在目录的 realpath 拼回文件名,再按 realRoot 表查一次(和原路径相同也查);目录的 realpath 按目录缓存,先查目录在不在,不在时取最近一级在的上级;不在调用里给 root 算 realpath;`rel` 用 POSIX 分隔。Stop hook 每轮要比上万次,登记 5 个副本、另有 300 条已删登记时仍要在 50ms 预算内(spec 设计验收 11)
  - `replicaOfCwd`:判断同上,但 cwd 等于 root 本身也算命中;命中主目录或都不中 → null
  - `locateFeatureRoot`(spec D26,与 D30 同一口径):按 createdAt 升序,第一个 removedAt 为空、featureId 相同、`<path>/docs/features/<featureId>` 是目录的副本 → 它的 path;否则 `<主目录>/docs/features/<featureId>` 是目录 → 主目录;都没有 → null。开副本后主目录留下的空壳(被忽略的文件)不影响查找;roots 由调用方整轮取一次传入,不在函数里读登记
  - 登记每次都读文件,不缓存:登记可能被原地改写(编辑器保存),长驻进程(web、sync worker)要读到新值;一轮里要多次用的,调用方取一次 `listProjectRoots` 复用
- **C-5 replica 命令**(T-2 实现;T-9、T-10、T-11 照写)
  - `cgraphx replica create <feature-id> --prefix <文件前缀> --branch <分支> [--full-copy] [--json]`
  - `cgraphx replica list [--all] [--json]`
  - `cgraphx replica remove <副本目录名或 feature-id> [--json]`
  - 带 `--json`:成功 stdout 输出 `{ "ok": true, ... }`(create、remove 平铺结果字段;list 为 `{ "ok": true, "replicas": [ReplicaStatus...] }`);失败 stdout 输出 `{ "ok": false, "code": "<code>", "message": "<中文说明,带修复提示>", ...附加字段 }`;一律 `JSON.stringify(x, null, 2)` 加换行(两空格缩进,与 timeline、features 的 JSON 输出一致)
  - `create`、`remove` 只在主目录执行,按调用方传入的项目根(换成主目录之前)判断,message 写明是哪一种、怎么改:
    - 两个命令:`resolveDataDir(projectRoot).state` 不是 `own`(在副本里,或主目录已不在)→ `not_main_dir`
    - `create` 另外:`isInitialized(projectRoot)` 为假;`git rev-parse --show-toplevel` 不等于项目根的 realpath;`git rev-parse --absolute-git-dir` 不等于 `<项目根 realpath>/.git`,或 `<项目根>/.git` 不是目录(worktree、子模块的 `.git` 是文件,整仓复制会和原仓库共用引用);`git symbolic-ref -q --short HEAD` 失败(detached HEAD,没有基础分支可登记)→ 都是 `not_main_dir`
    - `list` 在副本里也能跑
  - 不带 `--json`:成功打中文结果;失败 stderr 输出 `[replica] <message>`
  - code 与退出码(经 `exitCodeForError`):`invalid_args` → 3;前置条件不满足 → 2:`not_main_dir`、`dirty_main`(附 `files`)、`no_cow`(附 `requiredBytes`;只在克隆不了时报,读不了的文件、权限这类原因照实报运行时错误)、`target_exists`、`name_taken`(副本目录名已登记给别的需求,在用、已删都算)、`unsupported_platform`、`dirty`(附 `files`)、`not_found`、`unsafe_target`;其他运行时错误 → 1
  - list 表格(不带 `--json`)五列:副本、需求、分支、状态(在 / 已不在 / 已删除)、合入(已合入 / 差 N 个提交 / 还没有提交 / -)
  - K3 取法照 spec「细节方案:F7」,两条计数:`own` = `git rev-list --count --first-parent --no-merges <最新提交> ^<baseCommit>`,0 → 还没有提交(merged false、ahead 0);`ahead` = 同一条再加 `^HEAD`,0 → 已合入。登记没有 baseCommit 照旧(`merge-base --is-ancestor`,不成立时数 `HEAD..<最新提交>`)。快进式同步主干后判不准(spec 待确认项),不另行处理
  - create 复制失败时按英文报错认「克隆不了」:cp 子进程带 `LC_ALL=C`
  - create 的 exclude 照 spec D21①:各 agent 配置目录里开副本时没被跟踪的部分(`git ls-files -z --others --exclude-standard --directory -- <配置目录>`,去掉末尾 `/`)和 `.cgraphx`,经 C-2 的 `gitPathPattern`、`appendGitInfoLines` 写进副本的 `.git/info/exclude`
  - create ⑥ 照 spec D21⑥:只删主目录这个需求目录下第 ① 步保留的文件和因此变空的目录;被忽略的文件留在原处
- **C-6 release**(T-3 实现;T-8、T-9 用)
  - `src/core/release/index.ts` 导出:

    ```ts
    /** K8 版本分支 */
    export const VERSION_BRANCH_PATTERN: RegExp; // /^dev\/[0-9]+\.[0-9]+\.[0-9]+$/
    export interface GuardResult {
      hookPath: string | null;
      status: 'installed' | 'present' | 'updated' | 'repaired' | 'unsupported' | 'removed' | 'absent';
      reason?: HookSkipReason;           // unsupported 时,同 C-2
      lines?: readonly string[];         // unsupported 时
      linkTarget?: HookLinkTarget;       // reason 为 symlink 时,同 C-2
      notice?: string;                   // unsupported 时:给人看的提示,和不带 --json 时 stderr 打的相同
    }
    export function installReleaseGuard(cwd: string): GuardResult; // 不在 git 仓库 → 抛 ReleaseError,code 'not_git_repo'
    export function removeReleaseGuard(cwd: string): GuardResult;  // 不在 git 仓库或没装 → 'absent';拦截那几行提交在被跟踪的钩子文件里 → 'unsupported'(reason 'tracked',带 notice;两个记号照样清)
    export { ReleaseError, exitCodeForError } from './errors';
    ```

    `registerReleaseCommands(program: Command): void` 由 `src/core/release/cli.ts` 导出(`src/cli/index.ts` 和其他子系统一样从 cli 模块导入)
  - 命令:`cgraphx release guard [--remove] [--json]`;带 `--json` 输出 `{ "ok": true, ...GuardResult }`,`JSON.stringify(x, null, 2)` 加换行;不在 git 仓库:code `not_git_repo`,退出码 2;status 为 `unsupported` 时退出码 0,结果带 `notice`(安装为 `hookNotice(…, '没装上提交拦截')`,卸载为 `hookRemoveNotice(…, '拦截那几行')`),不带 `--json` 时 stderr 打 `[release] ` + notice;其余 status 不打提示
  - 两个记号(本地 git 配置):「按版本走」`cgraphx.releaseFlow`——install 一开始就写 true,`unsupported` 也写;装过的 `cgraphx.releaseGuard`——装上(含 present)后写 true;remove 两个都 `--unset`;片段原来不在而 `cgraphx.releaseGuard` 为 true → status `repaired`(其余按 C-2 的 status)
  - commit-msg 片段,marker `# cgraphx-release-guard`,三行逐字:

    ```sh
    # cgraphx-release-guard — 版本分支只收合并提交和 chore(release): 开头的提交
    __cgx_rb=$(git symbolic-ref --short -q HEAD 2>/dev/null || true) # cgraphx-release-guard
    if printf '%s' "$__cgx_rb" | grep -Eq '^dev/[0-9]+\.[0-9]+\.[0-9]+$' && ! git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 && ! grep -v -e '^#' -e '^[[:space:]]*$' "$1" | head -n 1 | grep -q '^chore(release):'; then echo "[cgraphx] $__cgx_rb 是版本分支:需求改动到副本里做(/dev-start <需求>);整个版本的改动以 chore(release): 开头提交" >&2; exit 1; fi # cgraphx-release-guard
    ```

- **C-7 合并提交记录**(T-4)
  - post-merge 片段,marker 沿用 `# cgraphx-timeline-hook`,两行逐字:

    ```sh
    # cgraphx-timeline-hook — record merge commits to .cgraphx/cgraphx.db
    if [ "$1" != "1" ]; then __cgx_r=$(git log -g -1 --no-show-signature --format='%H %gs' HEAD 2>/dev/null || true); __cgx_sha=${__cgx_r%% *}; __cgx_reflog=${__cgx_r#* }; [ -n "$__cgx_sha" ] || __cgx_sha=$(git rev-parse HEAD 2>/dev/null || true); __cgx_branch=$(git symbolic-ref --short -q HEAD 2>/dev/null || true); CGRAPHX_GIT_HOOK=post-merge CGRAPHX_COMMIT_REFLOG="$__cgx_reflog" CGRAPHX_COMMIT_SHA="$__cgx_sha" CGRAPHX_COMMIT_BRANCH="$__cgx_branch" cgraphx timeline-git-commit-hook >/dev/null 2>&1 & fi # cgraphx-timeline-hook
    ```

    提交号和 reflog 那一行用同一条 `git log -g` 取,两者对应同一次 HEAD 变动;取不到 reflog 时提交号退回 `git rev-parse HEAD`

  - post-commit 片段:在 `buildGitPostCommitSnippet()` 现有三行上,第二行两处命令替换加 `|| true`,改经 C-2 写入(位置移到 shebang 之后),`legacyMatch` = `timeline-git-commit-hook`;三行逐字:

    ```sh
    # cgraphx-timeline-hook — record commit events to .cgraphx/cgraphx.db
    __cgx_sha=$(git rev-parse HEAD 2>/dev/null || true); __cgx_branch=$(git symbolic-ref --short -q HEAD 2>/dev/null || true) # cgraphx-timeline-hook
    CGRAPHX_COMMIT_SHA="$__cgx_sha" CGRAPHX_COMMIT_BRANCH="$__cgx_branch" cgraphx timeline-git-commit-hook >/dev/null 2>&1 & # cgraphx-timeline-hook
    ```

  - 三个片段(C-6 的 commit-msg、这里的 post-merge 和 post-commit)里会失败的命令替换一律写成 `$(… || true)`:片段紧跟 shebang,钩子用 `#!/bin/sh -e` 这类写法时,赋值里一条命令失败(如 detached HEAD 上的 `git symbolic-ref`)就让整个钩子提前退出——commit-msg 会挡下提交,post-commit、post-merge 会跳过原钩子后面的内容
  - 环境变量常量 `COMMIT_HOOK_ENV = 'CGRAPHX_GIT_HOOK'`:post-merge 片段传 `post-merge`;没有即视为 post-commit。`COMMIT_REFLOG_ENV = 'CGRAPHX_COMMIT_REFLOG'`:post-merge 片段当场取的 HEAD reflog 最新一行
  - 记录规则:`git rev-list --parents -n 1 <hash>` 取父提交;
    - 父提交 ≥ 2 → 记 git_commit:`commit_files: []`、`commit_insertions: 0`、`commit_deletions: 0`、`metadata: { branch?: <分支>, merge: { parents: string[], files: number, insertions: number, deletions: number } }`;files、insertions、deletions 取 `git diff --numstat <第一父提交> <hash>`(二进制文件计入 files,不计行数)
    - `CGRAPHX_GIT_HOOK=post-merge` 且这次是快进 → 不记:reflog 那一行(取 `CGRAPHX_COMMIT_REFLOG`,旧片段不传时现读)含 `: Fast-forward`;读不到 reflog 才看父提交只有 1 个。快进到别人做的合并提交时 HEAD 也有两个父提交,不能只看父提交数
    - 已有同一 commit_hash 的 git_commit 事件 → 不记(post-commit、post-merge 都查;查和写在同一个 `BEGIN IMMEDIATE` 事务里,两个钩子进程同时记同一提交时不会重复)
  - 其余照现有 gitCommitHook:fail-silent、全部 await、只写 stderr `[timeline] …`
  - 安装报告:`InstallReport`(`src/core/timeline/installer.ts`)新增 `gitHooks: HookSnippetResult[]`(C-2;post-commit、post-merge 各一项,不在 git 仓库为 `[]`);已有字段不改名、不删,`gitHookPath`、`gitHookWritten` 照旧指 post-commit(写入 = status 是 `installed` 或 `updated`)。`UninstallReport` 新增 `mergeHookRemoved: boolean`、`gitHookNotices: string[]`(片段提交在被跟踪的钩子文件里、没删时的 `hookRemoveNotice(…, '提交记录片段')`,timeline uninstall、cgraphx uninstall 都打);`gitHookRemoved`、`mergeHookRemoved` = 对应 remove 的 status 是 `removed`
  - 安装提示(timeline install、cgraphx install 都打):逐项 `hookNotice(…)`(C-2),同一句只打一次
  - 会话开始补装(spec D33⑥):`timeline-session-start-hook` 在写完事件之后调 C-2 的 `repairHookSnippets(cwd)`(post-commit、post-merge、commit-msg 三个片段都按登记补);补不上的逐条 `hookNotice(…, '版本分支提交拦截没补上')`(commit-msg)/ `hookNotice(…, '提交记录片段没补上')`(其余)加 `[cgraphx] ` 前缀,和没接 task hook 时的 skill 版本落后提示合成一条 SessionStart 的 `additionalContext`(stdout 一行 JSON),都没有时 stdout 为空;出错吞掉
  - diff-tree 取文件列表加 `-c core.quotePath=false` 和 `--root`:中文路径原样、根提交也列出文件;读 `commit_files` 时,截断写法 `{ files, _truncated_count }` 取其中的 `files` 当数组
  - 副本里 `timeline uninstall --purge`:一开始就拒绝,什么都不动(message 见 C-12)
- **C-8 命名与说明**(T-9 写进 skill;T-10、T-11 引用)
  - 版本分支 `dev/<版本号>`(K8);主干 `main`,没有 main、有 master 时用 master
  - tag:`git tag -a v<版本号> -m "发布 <版本号>"`
  - 需求合入:`合入需求：<标题>`(**全角冒号**);同一需求第 2 次起 `合入需求：<标题>(第 N 次)`(半角括号);标题 = 需求目录名去掉日期段
  - 合入主干:`发布 <版本号>:合入 <标题>、<标题>`(半角冒号,标题之间用顿号);F4② 时正文逐行写 `<短 hash> <说明>`
  - 整版提交:`chore(release): 版本号 <旧>→<新>`、`chore(release): <版本号> 发版审核报告`
  - 副本里同步主目录分支:`git merge --no-ff -m "同步 <分支>" FETCH_HEAD`
  - 副本目录 `<主目录名>@<文件前缀>`;需求分支 `feat/<文件前缀>`,bug 修复 `fix/<文件前缀>`;文件前缀 = feature-id 去掉日期段 `YYYY-MM-DD`
- **C-9 发版审核报告**(T-9)
  - 路径 `docs/releases/v<版本号>-发版审核.md`;不写 `> 产物:`
  - 头部一行,格式逐字:`> 版本分支: dev/<版本号> · 起点: v<上个版本号> · 审核时最新提交: <7 位 hash> · 日期: <YYYY-MM-DD>`
  - 节标题与顺序照 spec「细节方案:F3」的报告骨架(含「同步主干」一节);各项取法照 spec F3「取法」表(起点按版本分支第一父链取,第二个父提交已在主干里的合并是同步主干);结论规则照 D15;过期判断照 D17(读头部的「审核时最新提交」)
- **C-10 features 输出**(T-7)
  - `FeatureEntry` 加可选字段 `replica?: { name: string; path: string }`,只在副本里的需求上有;主目录自己的条目不带这个字段(JSON 与改动前逐字相同)
  - 表格「目录」列:副本里的需求写 `docs/features/<id>(在副本 <副本目录名>)`
  - `my-features.md`:副本里的需求,「需求」单元格的链接写 `<../../<副本目录名>/<主 spec 的项目相对路径>>`(没有主 spec 时链到 `<../../<副本目录名>/docs/features/<id>/>`),链接后加 `(在副本 <副本目录名>)`
- **C-11 副本会话**(T-6)
  - 会话 id:`cgraphx-replica-` + sha256(远程地址) 的十六进制前 16 位 + `-` + sha256(副本目录名) 的十六进制前 8 位;常量 `REPLICA_SESSION_PREFIX = 'cgraphx-replica-'`
  - 收哪些提交:session_id 为空、`replicaOfCwd(roots, 提交事件的 cwd)` 命中的 git_commit,按命中的副本分组;没命中的照旧进仓库终端会话
  - 会话内容:events `[]`、references `[]`;commits 照仓库终端会话的构造;artifacts 照终端会话规则(只看提交里的文件),路径按 C-4 换算;bindings 一条:`{ bindingId: '<会话 id>:replica', taskId, taskKey?, start: <这些提交里最早的 ts>, end: null }`;taskId、taskKey 取 C-13 的 `featureBindingTarget(root, featureId)`,`taskKey` 只在它不为 null 且协议支持任务键时带
  - 是否发送、回执写回,与仓库终端会话相同
- **C-12 给用户看的话**
  - 程序里逐字:
    - D31:stderr `[cgraphx] 副本关联的主项目不在 <主目录路径> 了`
    - 副本里拒绝清数据:`这是副本,数据在主目录 <主目录路径>;要清数据,到主目录执行 cgraphx timeline uninstall --purge(这次什么都没动)`,退出码非 0
    - D12:见 C-6 的片段
  - skill 里:给用户看的话照 spec 功能方案原文(各功能点行为链与边界里「」内的句子),名字和数字换成实际值;另外两句:
    - dev-start 的启动语:`在 <副本绝对路径> 开新会话，输入 /dev-clarify`(已经澄清过的换成 `/dev-spec`)
    - 开了副本的交接启动语:`在 <副本绝对路径> 开新会话，输入：先读 docs/features/<feature-id>/<文件前缀>-交接提示词.md 再继续。`
- **C-13 需求目录对应的平台任务**(T-5 实现;T-6 用)
  - `src/core/task/feature-task.ts` 新增,经 task 门面 `src/core/task/index.ts` 导出:

    ```ts
    export function featureBindingTarget(projectRoot: string, featureId: string): { taskId: string | null; taskKey: string | null };
    ```

  - 规则(与 sync 的 `toIngestBinding` 对目录任务、接口任务的口径一致):`root = resolveMainRoot(projectRoot)`;在 `locateFeatureRoot(listProjectRoots(root), featureId)` 找到的根上 `readFeatureTask` 读主 spec 头部声明(哪里都没有这个需求目录 → 算没声明);是 `T-<n>` → `{ taskId: 它, taskKey: null }`;否则 → `{ taskId: findTaskByValue(root, featureId)?.externalId ?? null, taskKey: featureId }`
  - sync 只经 task 门面取这个结果,不直接 import features

## 细节方案核对

| spec 决策 | 落进 |
|---|---|
| D1 🔒 模块边界与依赖方向 | T-1(git-hooks)、T-2、T-3;T-8 注册命令 |
| D2 版本流程用 git 命令 | T-9 |
| D3 主干、版本号、tag | T-9(release-start,C-8) |
| D4 F1 边界的判定 | T-9(release-start) |
| D5 每次开版本都跑 release guard,记「按版本走」 | T-9(release-start;dev-merge 在主干上见到 `cgraphx.releaseFlow` 先问);命令与记号由 T-3 提供 |
| D6 从副本取分支不建远程 | T-9(dev-merge) |
| D7 预演与冲突归属 | T-9(dev-merge、release-review;起点按版本分支第一父链取) |
| D8 合并说明与第 N 次 | T-9(C-8) |
| D9 副本里同步取主目录当前分支 | T-9(dev-merge) |
| D10 合入带进知识文件先问再重建索引 | T-9(dev-merge) |
| D11 实现前查版本分支 | T-10(dev-impl、dev-impl-subagent) |
| D12 commit-msg 提交拦截 | T-3(C-6);T-8 卸载时删除 |
| D13 按合并说明归组,同步主干单列 | T-9(release-review,C-9) |
| D14 越界改代码由 skill 读涉及范围 | T-9(release-review) |
| D15 结论规则 | T-9(release-review,C-9) |
| D16 报告存放与提交 | T-9(C-9) |
| D17 报告过期 | T-9(release-review) |
| D18 🔒 副本的数据布局 | T-2(create.ts);T-1(resolveDataDir) |
| D19 🔒 登记 | T-2(registry.ts,C-3;status.ts 读 `baseCommit` 判 K3;create.ts 写 `movedFiles`);T-1 读;T-6 读 `movedFiles` |
| D20 复制方式 | T-2(create.ts);T-9(dev-start 问用户后带 `--full-copy`) |
| D21 复制后的整理 | T-2(create.ts;exclude 只写配置目录里没被跟踪的部分,⑥ 被忽略的文件留在主目录,C-5);T-9(dev-start 接着建两份索引) |
| D22 名字从哪来 | T-2(校验;撞名报 `name_taken`,C-5)、T-9(dev-start 定名字、处理 `name_taken`)、T-10(dev-spec 复用目录) |
| D23 dev-handoff 何时开副本 | T-10(dev-handoff) |
| D24 数据目录解析 | T-1(C-1);T-8(web:知识库用本地库,启动预检查数据目录的库) |
| D25 以主目录为准 | T-5、T-6 |
| D26 路径读取时换算 | T-2(C-4 的换算函数;按 feature-id 找需求目录先找副本)、T-5、T-6 |
| D27 副本会话的归属(K2) | T-5 |
| D28 🔒 没对上会话的副本提交 | T-5(本地)、T-6(上报,C-11) |
| D29 上报 | T-6(移进副本的文件按登记 `movedFiles` 定根);目录任务声明的找目录在 T-5 |
| D30 主目录列出副本里的需求 | T-7(C-10) |
| D31 主目录挪走后的提示 | T-8(C-12) |
| D32 🔒 合并提交怎么记 | T-4(C-7) |
| D33 钩子装在哪、只动本机 | T-1(C-2)、T-4(会话开始补装)、T-3;T-8 安装时的提示 |
| D34 /doc-report 按需求出报告 | T-10(doc-report) |
| D35 🔒 删之前核对什么 | T-2(remove.ts);T-9(删之前先问用户) |
| D36 skill 改动、install 不装拦截 | T-10;T-8 只在卸载时删拦截 |
| D37 文档口径 | T-11 |
| D38 需求的本机任务行 | T-5(`ensureFeatureTaskRow` 唯一一处规则;全量刷新对账先补上声明的那条任务、再删掉过时的目录任务;按 feature-id 查先看头部);store 加只删没有平台编号的目录任务 |
| 全局约束「零变化」 | T-1、T-5、T-6、T-7 完成条件 + 统一验证 3 |
| 全局约束「副本里拒绝清数据」 | T-4 |
| 全局约束「git 2.38 以上」 | T-9 |
| 全局约束「只支持 macOS、Linux」 | T-2 |
| 全局约束「CHANGELOG、CLAUDE.md、知识库」 | T-11 |

写 plan 和审阅时补了 spec 几处(都已改进 spec,不是 plan 里的新拍板;6 条 🔒 决策的选择不变):`replica create` 加必填参数 `--prefix`(D22 与命令契约,D1 不让 replica 依赖 features 的日期段解析);D30 的 JSON 字段只在副本条目上带(与全局约束「输出不变」一致);D21 ① 把 agent 配置目录和 `.cgraphx/` 写进副本的 `.git/info/exclude`、② 保留 `.cgraphx/.gitignore` 原样,D1 的依赖清单加 agents 门面;D24 主目录不在时写入方不建目录;D33 非 shell 钩子不写入;D5 装过的记号记在本地 git 配置;`not_main_dir` 的含义写全(含 worktree、子模块、detached HEAD);D28 待确认项的确认时点改为发版前;D23 启动语标点与 F7 统一。没有其他选型缺口。

代码审查后 spec 改到 spec@561fdba,plan 的契约与任务随之同步:K3 只数需求分支自己的提交(登记加 `baseCommit`)、D33 钩子只动本机、D32 快进按 reflog 判断、D12 拦截看第一行有内容的说明、D5 记「按版本走」、F3 起点按第一父链取且同步主干单列、D21 ① exclude 只写没被跟踪的部分、D22 撞名报 `name_taken`;对应的检查见统一验证 9。

复审后 spec 改到 spec@c1c2920,plan 随之同步:D33 被跟踪的钩子文件不写(去掉本机过滤规则)、会话开始按登记补装、`.git/hooks` 的旧片段只在新片段装上且它在 git 目录里时清;D21 ⑥ 被忽略的文件留在主目录;D26 按 feature-id 找需求目录先找副本;K3 改为两条计数,快进式同步主干判不准记进待确认项;对应的检查见统一验证 9 的 ⑮、㉓~㉕。

第三轮复审后 spec 改到 spec@a8b762a,plan 随之同步:D33 ④ 被跟踪的钩子按暂存区那份区分团队提交的和本机残留、⑥ 登记记写进过的文件(按 git 判断归属,别的仓库的不碰)、补不上的在会话开始提示一次并删登记(C-2、C-6、C-7);D19 登记加 `movedFiles`、D29 据它定根(C-3、C-4、T-6);D38 需求的本机任务行收成一处规则并在全量刷新时对账(T-5);`locateFeatureRoot` 改收 roots、登记不再缓存(C-4);统一验证 9 补设计验收 26~30。

第四轮复审后 spec 改到 spec@16dc4b2,plan 随之同步:D33 写明只保证高频场景(F8 细节方案末尾那段),链接、被跟踪的钩子安装时看工作区那份、不删,被跟踪的不在工作区里也不新建(C-2);D38 对账删目录任务之前先补上声明的那条任务,副本删了也补,目录没有负责人时不删(T-5);dev-merge 取主干时有 main 用 main、没有用 master(T-9);统一验证 9 补 ㉛、㉜。

## 适用规范

- `docs/guides/coding-standards.md`「边界与结构」「选型(偏离社区默认)」「错误与日志」:T-1~T-8 强制引用(门面硬约定、src/core 不依赖 cli / web、子系统标准形态、`node:` 前缀、注释中文、单文件超 600 行必须拆、类型化错误 + 用户可修复的错误带修复提示)
- `docs/guides/interface-standards.md`「命令注册」「输出」「退出码」「Hook 子命令契约」:T-2、T-3、T-4、T-7、T-8 强制引用(`register<子系统>Commands` 自注册、新命令统一 `--json`、stderr 带 `[子系统]` 前缀、`exitCodeForError` 映射退出码;timeline-git-commit-hook fail-silent、必须 await)
- `docs/guides/git-standards.md`「提交消息规范」「提交前检查点」:结晶进下方「提交规范」
- 不涉及 `data-standards.md`(没有表结构变更:登记是文件,合并记录只用 timeline_events 已有的列和 metadata)和 `testing-standards.md`(本 plan 不写测试)

## 提交规范

摘自 `docs/guides/git-standards.md`:

- 格式:`type(scope): 中文描述`;type 用 feat / refactor / fix / docs;scope 常用 skills / installer,仓库级改动省 scope
- 补充说明用「——」,并列用「+」,数值对比用「→」(`159→60`)
- 正例:`feat(skills): init-guides 双模式——新项目立起步规范`;反例:`update skill`(无 type、英文、零信息)
- 无票据关联:需求追踪走 `docs/features/` 目录,不进标题
- body:非琐碎提交写 body——背景一行(问题 / 动机)+「-」列要点;琐碎可只留 subject
- 末尾按会话约定加署名行
- 提交门禁:本仓库的 precommit-check hook 会先拦一次——先跑 `cgraphx features check --staged`(暂存区产物不合格必须改对),再要求对照下面的检查点自查 `git diff --cached`;自查无问题后用 `CGRAPHX_PRECOMMIT_REVIEWED=1 git commit ...` 重试

提交前检查点(原文):

- 与 TS 同放的运行时资产未登记 `scripts/copy-assets.cjs` —— 不随包发布,用户机器运行时 ENOENT(本需求不新增运行时资产)
- src/core 出现对 src/cli / src/web 的 import —— 分层硬约定破坏,无 lint 拦截,只靠人眼
- schema.sql 丢失 `IF NOT EXISTS` —— 已初始化项目重复应用 schema 直接报错
- timeline hook 链路出现未 await 的 DB 写入 / 抛错不吞 —— 阻塞宿主 Claude Code 工具调用
- `vitest.config.ts` 的 `TZ: 'UTC'` 钉死被改 —— 日期断言失去跨机器可复现性
- 被注释掉的命令注册 / hook 接入项(commander `.command(...)` / settings.json hooks)—— 功能静默失效
- 写死的魔法值:绝对路径、密钥、阈值、版本号写进源码
- 新增 TODO / FIXME:确认是否应转任务,不随提交入库

## 统一验证

全部任务提交后,在仓库根依次跑:

1. `npm run build` → 无报错
2. `npm test` → 全部通过
3. 零变化(对比第 0 步基线):

   ```bash
   node dist/cli/index.js features list --json > .cgraphx/baseline/版本流程/features-after.json
   node -e "const a=require('./.cgraphx/baseline/版本流程/features-before.json'),b=require('./.cgraphx/baseline/版本流程/features-after.json');const m=new Map(b.map(x=>[x.featureId,JSON.stringify(x)]));const bad=a.filter(x=>!x.featureId.startsWith('2026-10-27-')&&m.get(x.featureId)!==JSON.stringify(x));const extra=b.filter(x=>'replica' in x);console.log(bad.length||extra.length?'DIFF '+JSON.stringify(bad.map(x=>x.featureId).concat(extra.map(x=>x.featureId))):'OK')"
   node dist/cli/index.js task list --local --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log(JSON.stringify(r.tasks.filter(x=>x.source==='feature').map(x=>({featureId:x.featureId,name:x.name})),null,1))})" > .cgraphx/baseline/版本流程/tasks-after.json
   node -e "const a=require('./.cgraphx/baseline/版本流程/tasks-before.json'),b=require('./.cgraphx/baseline/版本流程/tasks-after.json');const m=new Map(b.map(x=>[x.featureId,x.name]));const bad=a.filter(x=>m.has(x.featureId)&&m.get(x.featureId)!==x.name);console.log(bad.length?JSON.stringify(bad):'OK')"
   ```

   → 两条比对都输出 `OK`(2026-10-27 的两个需求目录在开发期间会变,不比)
4. 分层与文件长度:
   - `grep -rhoE "from '\.\./[^']+'" src/core/replica src/core/release | sort -u` → 不超出 `from '../agents'`、`from '../db'`、`from '../directory'`、`from '../git-hooks'` 这四行
   - `grep -rn "from '\.\./replica/" src/core --include='*.ts' | grep -v "^src/core/replica/"`、`grep -rn "from '\.\./release/" src/core --include='*.ts' | grep -v "^src/core/release/"` → 都无输出(外部只经门面)
   - `grep -rn "from '\.\./features'" src/core/sync --include='*.ts'` → 无输出(C-13)
   - `git diff --name-only --diff-filter=AM "$(cat .cgraphx/baseline/版本流程/base-commit)"..HEAD -- src | grep '\.ts$' | xargs wc -l | awk '$2 != "total" && $1 > 600'` → 无输出(只查本需求改过和新增的文件)
5. 临时仓库冒烟(在仓库根执行;用 PATH 垫片让钩子调到刚构建的 cgraphx;副本要写时复制,在 macOS 上跑,Linux 上给两条 `replica create` 加 `--full-copy`):

   ```bash
   REPO="$PWD"; T="$(mktemp -d)"; mkdir -p "$T/bin"
   printf '#!/bin/sh\nexec node "%s/dist/cli/index.js" "$@"\n' "$REPO" > "$T/bin/cgraphx"; chmod +x "$T/bin/cgraphx"
   export PATH="$T/bin:$PATH"
   wait2() { node -e "setTimeout(()=>{},2000)"; }   # 等后台钩子写完;会话环境里前台 sleep 可能被拦
   cd "$T" && git init -q -b main proj && cd proj && git config user.name t && git config user.email t@t
   printf '{ "name": "proj", "version": "1.0.0" }\n' > package.json && git add -A && git commit -qm "chore: init"
   node -e "require(process.argv[1]).ensureProjectInitialized(process.cwd()).then(r=>console.log(r))" "$REPO/dist/cli/installer/index.js"
   printf '#!/bin/sh\necho user-hook >> "%s/user-hook.log"\nexec true\n' "$T" > .git/hooks/post-commit && chmod +x .git/hooks/post-commit
   cgraphx timeline install >/dev/null
   # ① 版本分支拦截
   cgraphx release guard --json
   git checkout -qb dev/1.0.1 && echo x > x.txt && git add x.txt
   git commit -qm "feat: 直接提交" 2>"$T/guard.err"; echo "exit=$?"; cat "$T/guard.err"
   git commit -qm "chore(release): 版本号 1.0.0→1.0.1"; echo "exit=$?"
   git checkout -qb feat/g && echo g > g.txt && git add g.txt && git commit -qm "feat: g"; echo "exit=$?"
   git checkout -q dev/1.0.1 && git merge -q --no-ff -m "合入需求：g" feat/g; echo "exit=$?"
   git checkout -qb feat/k && echo k1 > k.txt && git add k.txt && git commit -qm "feat: k1"
   git checkout -q dev/1.0.1 && echo k2 > k.txt && git add k.txt && git commit -qm "chore(release): 冲突用"
   git merge -q --no-ff -m "合入需求：k" feat/k >/dev/null 2>&1; echo k3 > k.txt && git add k.txt && git commit -qm "合入需求：k"; echo "exit=$?"
   git checkout -qb dev/zhangsan && echo z > z.txt && git add z.txt && git commit -qm "feat: z"; echo "exit=$?"
   git checkout -q main && git merge -q --no-ff -m "发布 1.0.1:合入 g、k" dev/1.0.1; wait2
   cgraphx timeline query --type git_commit | grep -c '"commit_message": "feat: g"'
   test -s "$T/user-hook.log" && echo OK-user-hook
   # ② 开副本
   cgraphx replica create 2026-10-27-测试 --prefix 测试 --branch feat/测试 --json
   R="$T/proj@测试"; test -L "$R/.cgraphx/shared" && test -f .cgraphx/replicas/proj@测试.json && echo OK-create
   cgraphx features list --json | grep -c '"replica"'
   cgraphx replica list --json | grep -c '"dirty": \[\]'
   # ③ 副本里的提交记进主目录
   (cd "$R" && echo y > y.txt && git add y.txt && git commit -qm "feat: 副本里提交"); wait2
   cgraphx timeline query --type git_commit | grep -c '"commit_message": "feat: 副本里提交"'
   # ④ 合入、合并记录、K3
   git fetch -q --no-tags "$R" feat/测试 && git merge -q --no-ff -m "合入需求：测试" FETCH_HEAD; wait2
   cgraphx timeline query --type git_commit | grep -c '"merge": {'
   cgraphx replica list --json | grep -c '"merged": true'
   # ④b 快进不记;快进到已记过的合并提交,同一 hash 不重复记
   git checkout -qb ff && echo f > f.txt && git add f.txt && git commit -qm "feat: 快进用" && git checkout -q main && git merge -q --ff-only ff; wait2
   cgraphx timeline query --type git_commit | grep -c '"commit_message": "feat: 快进用"'
   git checkout -qb m2 && echo m > m.txt && git add m.txt && git commit -qm "feat: m" && git checkout -qb m3 main && git merge -q --no-ff -m "合并 m2" m2 && git checkout -q main && git merge -q --ff-only m3; wait2
   cgraphx timeline query --type git_commit | grep -c '"commit_message": "合并 m2"'
   # ④c 冲突后用 git commit 收尾,按合并提交记
   git checkout -qb c1 && echo 1 > c.txt && git add c.txt && git commit -qm "feat: c1"
   git checkout -q main && echo 2 > c.txt && git add c.txt && git commit -qm "feat: c2"
   git merge -q c1 >/dev/null 2>&1; echo 3 > c.txt && git add c.txt && git commit -qm "合并 c1 收尾"; wait2
   cgraphx timeline query --type git_commit | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const e=JSON.parse(s).filter(x=>x.commit_message==='合并 c1 收尾');console.log(e.length===1&&e[0].metadata.merge?'OK-conflict-merge':'FAIL')})"
   # ⑤ 删副本:核对后删除,登记留下
   cgraphx replica remove 2026-10-27-测试 --json
   test ! -e "$R" && grep -q '"removedAt": "' .cgraphx/replicas/proj@测试.json && echo OK-remove
   # ⑥ 在副本里 rm -rf .cgraphx/,主目录数据完好
   cgraphx replica create 2026-10-27-测试二 --prefix 测试二 --branch feat/测试二 --json >/dev/null
   (cd "$T/proj@测试二" && rm -rf .cgraphx/)
   cgraphx timeline query --type git_commit | grep -c '"commit_message": "feat: 副本里提交"'
   # ⑦ core.hooksPath:片段写进 .husky/_ 并会执行
   git config core.hooksPath .husky/_ && cgraphx timeline install >/dev/null && cgraphx release guard --json
   test -f .husky/_/post-commit && test -f .husky/_/post-merge && test -f .husky/_/commit-msg && echo OK-hookspath
   echo h > h.txt && git add h.txt && git commit -qm "feat: hookspath 下提交"; wait2
   cgraphx timeline query --type git_commit | grep -c '"commit_message": "feat: hookspath 下提交"'
   git checkout -q dev/1.0.1 && echo h2 > h2.txt && git add h2.txt && git commit -qm "feat: hookspath 下直接提交" 2>/dev/null; echo "exit=$?"
   cd "$REPO" && rm -rf "$T"
   ```

   → ① `release guard` 输出 `"status": "installed"`;直接提交 `exit=1`,`guard.err` 含「dev/1.0.1 是版本分支」;之后五个 `exit=` 都是 `0`(chore(release) 提交、feat/ 分支提交、版本分支上的合并提交、版本分支上的冲突收尾、dev/zhangsan 上的提交);`"feat: g"` 计数为 `1`(原钩子以 exec 结尾,片段照样执行);打出 `OK-user-hook`(原钩子内容照常执行)
   → ② create 输出 `"ok": true` 与 `"created": true`;打出 `OK-create`;`"replica"` 计数为 `1`;`"dirty": []` 计数为 `1`(刚开出的副本没有改动)
   → ③ 输出 `1`
   → ④ `"merge": {` 计数为 `4`(合入需求：g、合入需求：k、发布 1.0.1、合入需求：测试);`"merged": true` 计数为 `1`;④b 两次都输出 `1`(快进不记;快进到已记过的合并提交不重复记);④c 输出 `OK-conflict-merge`
   → ⑤ remove 输出 `"state": "removed"`;打出 `OK-remove`
   → ⑥ 输出 `1`
   → ⑦ `release guard` 输出的 `hookPath` 以 `.husky/_/commit-msg` 结尾;打出 `OK-hookspath`;`"feat: hookspath 下提交"` 计数为 `1`;版本分支上的直接提交 `exit=1`
6. skill 与文档:
   - `ls assets/claude-template/skills/{release-start,release-review,dev-start,dev-merge}/SKILL.md` → 四个文件都在
   - `grep -c "先停下问用户要不要建分支" assets/claude-template/skills/dev-impl-subagent/SKILL.md` → `0`
   - `grep -lF 'dev/[0-9]+' assets/claude-template/skills/dev-impl/SKILL.md assets/claude-template/skills/dev-impl-subagent/SKILL.md` → 两个文件都列出
   - `grep -rn "合入需求:" assets/claude-template` → 无输出(合并说明只能用全角「合入需求：」)
   - `grep -n "版本流程(可选)" assets/claude-template/FLOW-MAP.md` → 有命中
   - `grep -n "release-" CLAUDE.md` → skill 命名约定那一行有 `release-`
7. `node dist/cli/index.js docs validate docs/knowledge/需求副本.md`、`node dist/cli/index.js docs validate docs/knowledge/版本分支.md` → 都通过;`node dist/cli/index.js features check docs/features/2026-10-27-版本流程与需求副本` → 全部通过
8. 本仓库开副本的耗时(spec 设计验收 12;工作区干净时跑,会在上级目录临时建出 `cgraphx@测速`):

   ```bash
   time node dist/cli/index.js replica create 2026-10-27-测速 --prefix 测速 --branch feat/测速 --json
   node dist/cli/index.js replica remove 2026-10-27-测速 --json
   rm .cgraphx/replicas/cgraphx@测速.json   # 测速用的登记,删掉
   ```

   → create 的 real 时间不超过 5 秒;remove 输出 `"state": "removed"`
9. 钩子只动本机、K3、版本起点、目录任务对账、移进副本的文件定根的临时仓库冒烟(在仓库根执行;全局 git 配置换成临时文件,不碰本机的;副本要写时复制,在 macOS 上跑):

   ```bash
   REPO="$PWD"; T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"; mkdir -p "$T/bin"
   printf '#!/bin/sh\nexec node "%s/dist/cli/index.js" "$@"\n' "$REPO" > "$T/bin/cgraphx"; chmod +x "$T/bin/cgraphx"
   export PATH="$T/bin:$PATH" GIT_CONFIG_GLOBAL="$T/gitconfig" GIT_CONFIG_NOSYSTEM=1; unset CLAUDE_CODE_SESSION_ID CODEBUDDY_SESSION_ID
   git config --global user.name t; git config --global user.email t@t; git config --global init.defaultBranch main
   init_cgx() { node -e "require(process.argv[1]).ensureProjectInitialized(process.cwd()).then(()=>{})" "$REPO/dist/cli/installer/index.js" >/dev/null; }
   k3() { cgraphx replica list --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=JSON.parse(s).replicas.find(e=>e.name===process.argv[1]);console.log(x.merged+'/'+x.ahead)})" "$1"; }
   # ⑭ 全局 core.hooksPath 指向仓库外;⑳ 拦截没装上也记「按版本走」
   mkdir "$T/shared" && printf '#!/bin/sh\nexit 0\n' > "$T/shared/commit-msg" && chmod +x "$T/shared/commit-msg" && git config --global core.hooksPath "$T/shared"
   cd "$T" && git init -q a && cd a && echo a > a && git add a && git commit -qm init && init_cgx
   cgraphx timeline install 2>&1 >/dev/null | grep -c "是多个仓库共用的"
   cgraphx release guard --json | grep -E '"(status|reason)"'; echo "releaseFlow=$(git config --local --get cgraphx.releaseFlow)"
   cgraphx timeline uninstall >/dev/null 2>&1; cgraphx release guard --remove --json | grep '"status"'
   echo "shared=[$(ls "$T/shared")] $(wc -l < "$T/shared/commit-msg" | tr -d ' ') 行 releaseFlow=[$(git config --local --get cgraphx.releaseFlow)]"
   git config --global --unset core.hooksPath
   # ⑮ 被跟踪的钩子文件不写;⑯ 工作区里新建的钩子文件写进 exclude
   cd "$T" && git init -q o && cd o && mkdir .husky && printf '#!/usr/bin/env sh\necho team\n' > .husky/commit-msg && chmod +x .husky/commit-msg && printf '.cgraphx/\n.claude/\n' > .gitignore && git add -A && git commit -qm init && git config core.hooksPath .husky && init_cgx
   cgraphx release guard --json | grep -E '"(status|reason)"'; cgraphx release guard 2>&1 >/dev/null | grep -c "被 git 跟踪"; cgraphx timeline install >/dev/null 2>&1
   echo "status=[$(git status --porcelain)] 索引=[$(git diff --cached --name-only)] marker=$(grep -c cgraphx .husky/commit-msg) post-commit=$(test -e .husky/post-commit && echo 在 || echo 没有) exclude=$(grep -c husky .git/info/exclude)"
   cgraphx release guard --remove >/dev/null 2>&1; cgraphx timeline uninstall >/dev/null 2>&1
   echo "卸载后 status=[$(git status --porcelain)] post-commit=$(test -e .husky/post-commit && echo 在 || echo 没了) exclude=$(grep -c husky .git/info/exclude)"
   # ⑯ 链接形式的钩子文件
   cd "$T" && git init -q c && cd c && mkdir scripts && printf '#!/bin/sh\necho mine\n' > scripts/commit-msg && chmod +x scripts/commit-msg && git add -A && git commit -qm init
   ln -s ../../scripts/commit-msg .git/hooks/commit-msg
   cgraphx release guard --json | grep -E '"(status|reason|scope)"'; cgraphx release guard 2>&1 >/dev/null | grep -c "指向 $T/c/scripts/commit-msg(它被 git 跟踪"; echo "链接目标 $(wc -l < scripts/commit-msg | tr -d ' ') 行"
   # ⑰ 仓库跟踪了 .claude 的一部分;.claude 是链接
   cd "$T" && git init -q d && cd d && mkdir -p .claude/commands && echo team > .claude/commands/team.md && printf '.cgraphx/\n' > .gitignore && git add -A && git commit -qm init
   mkdir -p .claude/skills/x && echo s > .claude/skills/x/SKILL.md && init_cgx
   cgraphx replica create 2026-10-28-丙 --prefix 丙 --branch feat/丙 --json | grep '"created"'
   (cd "$T/d@丙" && echo new > .claude/commands/new.md && git status --porcelain)
   cgraphx replica remove 2026-10-28-丙 --json | grep '"code"'
   mkdir "$T/shared-claude" && echo cfg > "$T/shared-claude/a"
   cd "$T" && git init -q l && cd l && echo a > a && printf '.cgraphx/\n' > .gitignore && git add -A && git commit -qm init && ln -s ../shared-claude .claude && init_cgx
   cgraphx replica create 2026-10-28-丁 --prefix 丁 --branch feat/丁 --json | grep '"created"'
   test -L "$T/l@丁/.claude" && echo OK-symlink-kept; echo "副本 status=[$(cd "$T/l@丁" && git status --porcelain)]"
   # ⑱ K3 五种情况
   cd "$T" && git init -q m && cd m && printf '.cgraphx/\n.claude/\n' > .gitignore && echo a > a && git add -A && git commit -qm init && init_cgx
   for r in 甲 乙 戊; do cgraphx replica create 2026-10-28-$r --prefix $r --branch feat/$r --json >/dev/null; done
   echo "刚开:$(k3 m@甲)"
   (cd "$T/m@乙" && echo b1 > b1 && git add b1 && git commit -qm B1); (cd "$T/m@戊" && echo e1 > e1 && git add e1 && git commit -qm E1)
   git fetch -q --no-tags "$T/m@乙" feat/乙 && git merge -q --no-ff -m "合入需求：乙" FETCH_HEAD
   echo x > x && git add x && git commit -qm "main 往前走"
   for r in 甲 乙; do (cd "$T/m@$r" && git fetch -q --no-tags "$T/m" main && git merge -q --no-ff -m "同步 main" FETCH_HEAD); done
   echo "没提交过但同步过:$(k3 m@甲) 已合入后又同步:$(k3 m@乙) 提交过没合入:$(k3 m@戊)"
   (cd "$T/m@乙" && echo b2 > b2 && git add b2 && git commit -qm B2); echo "合入后又提交:$(k3 m@乙)"
   # ⑲ 版本期间同步主干:起点不变,同步主干单列
   START0=$(git rev-parse HEAD) && git checkout -qb dev/1.0.1
   git fetch -q --no-tags "$T/m@戊" feat/戊 && git merge -q --no-ff -m "合入需求：戊" FETCH_HEAD
   git checkout -q main && echo hot > hot && git add hot && git commit -qm "fix: 热修复" && git checkout -q dev/1.0.1 && git merge -q --no-ff -m "Merge branch 'main' into dev/1.0.1" main
   L=$(git rev-list --first-parent dev/1.0.1 --not main --) || exit 1; C=$(printf '%s\n' "$L" | tail -n 1); START=${C:+$C^1}; START=${START:-dev/1.0.1}
   test "$(git rev-parse "$START")" = "$START0" && echo OK-start; test "$(git merge-base main dev/1.0.1)" != "$START0" && echo merge-base-moved
   git log --first-parent --merges --format='%h %p' "$START"..dev/1.0.1 | while read -r M P1 P2; do
     git merge-base --is-ancestor "$P2" main && echo "$(git log -1 --format=%s "$M") → 同步主干" || echo "$(git log -1 --format=%s "$M") → 合入"
   done
   # ㉑ 注释开头的提交模板写 chore(release): 放行
   cgraphx release guard >/dev/null 2>&1 && echo y > y && git add y
   printf '#!/bin/sh\nprintf "# 提交说明格式\\n\\nchore(release): 版本号 1.0.0→1.0.1\\n" > "$1"\n' > "$T/editor.sh" && chmod +x "$T/editor.sh"
   GIT_EDITOR="$T/editor.sh" git commit -q; echo "exit=$? 首行=$(git log -1 --format=%s)"
   echo z > z && git add z && git commit -qm "feat: 直接" 2>/dev/null; echo "直接提交 exit=$?"; git reset -q --hard
   # ㉒ 副本目录名已登记给别的需求(副本已删)
   git checkout -q main && cgraphx replica remove 2026-10-28-甲 --json | grep '"state"'
   cgraphx replica create 2026-11-01-甲 --prefix 甲 --branch feat/甲二 --json | grep '"code"'
   node -e "const e=require('./.cgraphx/replicas/m@甲.json');console.log('旧登记', e.featureId, e.removedAt !== null)"
   # ㉓ .git/hooks 链到仓库外的共用目录;链到仓库里的目录;钩子目录在仓库外时旧片段不删;卸载删掉顺着链接写进仓库里文件的旧片段
   mkdir "$T/sh2" && printf '#!/bin/sh\necho shared\ncgraphx timeline-git-commit-hook >/dev/null 2>&1 & # cgraphx-timeline-hook\n' > "$T/sh2/post-commit" && chmod +x "$T/sh2/post-commit"
   cd "$T" && git init -q e && cd e && echo a > a && git add a && git commit -qm init && rm -rf .git/hooks && ln -s "$T/sh2" .git/hooks && init_cgx
   cgraphx timeline install >/dev/null 2>&1; cgraphx timeline uninstall >/dev/null 2>&1; echo "共用目录=[$(ls "$T/sh2" | tr '\n' ' ')] $(wc -l < "$T/sh2/post-commit" | tr -d ' ') 行"
   cd "$T" && git init -q f && cd f && echo a > a && mkdir githooks && git add a && git commit -qm init && rm -rf .git/hooks && ln -s ../githooks .git/hooks && init_cgx
   cgraphx release guard >/dev/null 2>&1; cgraphx release guard --json | grep '"status"'
   mkdir "$T/gh" && printf '#!/bin/sh\nexec "$(git rev-parse --git-dir)/hooks/post-commit" "$@"\n' > "$T/gh/post-commit" && chmod +x "$T/gh/post-commit"
   cd "$T" && git init -q g && cd g && echo a > a && git add a && git commit -qm init && init_cgx
   printf '#!/bin/sh\n\n# cgraphx-timeline-hook — record commit events\ncgraphx timeline-git-commit-hook >/dev/null 2>&1 &\n' > .git/hooks/post-commit && chmod +x .git/hooks/post-commit
   git config core.hooksPath "$T/gh" && cgraphx timeline install >/dev/null 2>&1; echo "旧片段=$(grep -c timeline-git-commit-hook .git/hooks/post-commit)"
   cd "$T" && git init -q i && cd i && mkdir scripts && printf '#!/bin/sh\necho mine\n' > scripts/post-commit && chmod +x scripts/post-commit && printf '.cgraphx/\n' > .gitignore && git add -A && git commit -qm init && ln -s ../../scripts/post-commit .git/hooks/post-commit && init_cgx
   printf '\n# cgraphx-timeline-hook — record commit events\ncgraphx timeline-git-commit-hook >/dev/null 2>&1 &\n' >> scripts/post-commit
   cgraphx timeline uninstall >/dev/null 2>&1; echo "卸载后 status=[$(git status --porcelain)]"
   # ㉔ husky 9 冲掉片段后会话开始补回;队友提交同名钩子后不再写;卸载后不再补
   sess() { printf '{"session_id":"s%s","cwd":"%s","source":"startup"}' "$1" "$PWD" | cgraphx timeline-session-start-hook >/dev/null 2>&1; }
   husky9() { mkdir -p .husky/_ && printf '*\n' > .husky/_/.gitignore && printf '#!/usr/bin/env sh\n. "${0%%/*}/h"\n' > .husky/_/commit-msg && chmod +x .husky/_/commit-msg; }
   cd "$T" && git init -q h && cd h && echo a > a && printf '.cgraphx/\n.claude/\n' > .gitignore && git add -A && git commit -qm init && init_cgx
   husky9 && git config core.hooksPath .husky/_ && cgraphx release guard >/dev/null 2>&1 && husky9
   echo "冲掉后=$(grep -c cgraphx-release-guard .husky/_/commit-msg)"; sess 1; echo "会话开始后=$(grep -c cgraphx-release-guard .husky/_/commit-msg)"
   git config core.hooksPath .husky && cgraphx release guard >/dev/null 2>&1
   printf '#!/usr/bin/env sh\necho team\n' > .husky/commit-msg && git add -f .husky/commit-msg && git commit -qm "chore: 队友的钩子" >/dev/null 2>&1
   sess 2; echo "被跟踪后=$(grep -c cgraphx .husky/commit-msg) status=[$(git status --porcelain)]"
   cgraphx release guard --remove >/dev/null 2>&1; git config core.hooksPath .husky/_ && husky9 && sess 3; echo "卸载后=$(grep -c cgraphx-release-guard .husky/_/commit-msg)"
   # ㉕ 被忽略的文件留在主目录;主目录留下空壳时按 feature-id 找副本那份,副本 spec 声明的任务读得到
   cd "$T" && git init -q n && cd n && printf '.cgraphx/\n.claude/\n*.local.md\n' > .gitignore && echo a > a && git add -A && git commit -qm init && init_cgx && cgraphx timeline install >/dev/null 2>&1
   F=docs/features/2026-10-28-会员导出; mkdir -p "$F" && echo draft > "$F/讨论稿.md" && echo notes > "$F/调研.local.md"
   cgraphx replica create 2026-10-28-会员导出 --prefix 会员导出 --branch feat/会员导出 --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('movedFiles='+JSON.stringify(JSON.parse(s).movedFiles)))"
   echo "主目录 调研.local.md=$(test -f "$F/调研.local.md" && echo 在 || echo 没了) 讨论稿.md=$(test -f "$F/讨论稿.md" && echo 在 || echo 没了)"
   printf '# 规格说明: 会员导出\n\n> 产物: spec\n> 负责人: t\n> 任务: T-789\n' > "$T/n@会员导出/$F/会员导出-spec.md"
   (cd "$T/n@会员导出" && git add -A && git commit -qm "feat: 会员导出 spec"); node -e "setTimeout(()=>{},2000)"
   cgraphx task show T-789 --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log(r.task.externalId, JSON.stringify(r.featureDirs), JSON.stringify(r.commits.map(c=>c.commit_message)))})"
   # ㉖ husky 8 → 9:旧目录里的拦截迁走,--remove 两处都不留;换了钩子目录再 cgraphx uninstall,旧目录里的片段也删
   cd "$T" && git init -q p && cd p && echo a > a && printf '.cgraphx/\n.claude/\n' > .gitignore && git add -A && git commit -qm init && init_cgx
   mkdir .husky && git config core.hooksPath .husky && cgraphx release guard >/dev/null 2>&1
   echo "husky8=$(grep -c cgraphx-release-guard .husky/commit-msg) exclude=$(grep -c '^/.husky/commit-msg$' .git/info/exclude)"
   husky9 && git config core.hooksPath .husky/_ && cgraphx release guard >/dev/null 2>&1
   echo "husky9=$(grep -c cgraphx-release-guard .husky/_/commit-msg) 旧文件=$(test -e .husky/commit-msg && echo 在 || echo 没了) exclude=$(grep -c '^/.husky/commit-msg$' .git/info/exclude)"
   cgraphx release guard --remove >/dev/null 2>&1; echo "卸载后=$(grep -c cgraphx .husky/_/commit-msg)"
   git config core.hooksPath .githooks && cgraphx timeline install >/dev/null 2>&1 && git config core.hooksPath .husky/_
   cgraphx uninstall -y >/dev/null 2>&1; echo "uninstall 后 .githooks=[$(ls .githooks 2>/dev/null | tr '\n' ' ')]"
   # ㉗ 被跟踪的非 shell 钩子报 not_shell、不带几行;bare 仓库目录里的 worktree,被跟踪的钩子按 ④ 不写,会话开始也不写回;悬空链接说清指向
   cd "$T" && git init -q q && cd q && mkdir githooks && printf '#!/usr/bin/env python3\nprint(1)\n' > githooks/commit-msg && chmod +x githooks/commit-msg && printf '.cgraphx/\n.claude/\n' > .gitignore && git add -A && git commit -qm init && git config core.hooksPath githooks && init_cgx
   cgraphx release guard --json | grep -cE '"reason": "not_shell"|"lines"'
   cd "$T" && git init -q r0 && cd r0 && printf '.cgraphx/\n.claude/\n' > .gitignore && echo a > a && git add -A && git commit -qm init && cd "$T" && git clone -q --bare r0 r.git && git -C r.git worktree add -q -b wt "$T/r.git/wt" main
   cd "$T/r.git/wt" && init_cgx && git config core.hooksPath .husky && cgraphx release guard --json | grep '"status"'
   printf '#!/usr/bin/env sh\necho team\n' > .husky/commit-msg && git add -f .husky/commit-msg && git commit -q --no-verify -m "chore: 队友的钩子"
   ctx=$(printf '{"session_id":"s27","cwd":"%s","source":"startup"}' "$PWD" | cgraphx timeline-session-start-hook 2>/dev/null)
   echo "会话开始提示=$(printf '%s' "$ctx" | grep -c '被 git 跟踪') 写回=$(grep -c cgraphx .husky/commit-msg) status=[$(git status --porcelain)]"; cgraphx release guard --json | grep '"reason"'
   cd "$T" && git init -q s && cd s && echo a > a && git add a && git commit -qm init && init_cgx && ln -s "$T/nowhere/commit-msg" .git/hooks/commit-msg
   cgraphx release guard --json | grep -E '"(reason|scope)"'; cgraphx release guard 2>&1 >/dev/null | grep -c "指向 $T/nowhere/commit-msg(它在仓库外"
   # ㉘ 副本会话在 spec 之前建出目录任务;spec 声明 T-123 后全量刷新删掉它,task show <需求> 落到 T-123;已有平台编号的目录任务不删
   tasks() { cgraphx task list --local --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).tasks.map(t=>t.source==='feature'?'F:'+t.featureId+'@'+(t.externalId??'-'):'A:'+t.externalId).sort().join(' ')))"; }
   stop() { printf '{"session_id":"%s","cwd":"%s"}' "$1" "$2" | cgraphx task-stop-hook >/dev/null 2>&1; }
   cd "$T" && git init -q t && cd t && printf '.cgraphx/\n.claude/\n' > .gitignore && echo a > a && git add -A && git commit -qm init && init_cgx
   for r in 订单导出 发票; do cgraphx replica create 2026-10-28-$r --prefix $r --branch feat/$r --json >/dev/null; printf '{"session_id":"r-%s","cwd":"%s","source":"startup"}' "$r" "$T/t@$r" | cgraphx timeline-session-start-hook >/dev/null 2>&1; stop "r-$r" "$T/t@$r"; done
   echo "spec 之前:$(tasks)"
   node -e "require(process.argv[1]).recordFeatureTaskMappings(process.cwd(), [{ featureId: '2026-10-28-发票', taskId: 'T-900' }])" "$REPO/dist/core/task/index.js"
   for x in 订单导出:T-123 发票:T-456; do r=${x%%:*}; printf '# 规格说明: %s\n\n> 产物: spec\n> 负责人: t\n> 任务: %s\n' "$r" "${x#*:}" > "$T/t@$r/docs/features/2026-10-28-$r/$r-spec.md"; done
   echo "声明之后:$(tasks)"
   cgraphx task show 2026-10-28-订单导出 --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log(r.task.externalId, JSON.stringify(r.sessions.map(x=>x.binding.sessionId)))})"
   # ㉙ 主目录会话写的 spec 开副本移走、副本里提交并推送、合入主目录并推送、删副本:这个会话的产出一直是 create 带副本那笔提交
   art() { node -e "const p=require(process.argv[1]);p.createSyncContext(process.cwd(),{tier:'1.2'}).then(c=>p.buildSessionPayload(c,'s29',0)).then(b=>console.log(b.session.artifacts.map(a=>a.action+'+'+(a.commitHash?a.commitHash.slice(0,7):'空')).join(' ')))" "$REPO/dist/core/sync/payload.js"; }
   cd "$T" && git init -q --bare u-origin.git && git init -q u && cd u && printf '.cgraphx/\n.claude/\n' > .gitignore && echo a > a && git add -A && git commit -qm init && git remote add origin "$T/u-origin.git" && git push -q origin main && init_cgx && cgraphx timeline install >/dev/null 2>&1
   F=docs/features/2026-10-28-订单导出 && mkdir -p "$F" && printf '# 规格说明: 订单导出\n\n> 产物: spec\n> 负责人: t\n' > "$F/订单导出-spec.md"
   node -e "const t=require(process.argv[1]),c=process.cwd();(async()=>{await t.recordEvent(c,{session_id:'s29',event_type:'session_start',cwd:c});await t.recordEvent(c,{session_id:'s29',event_type:'post_tool_use',tool_name:'Write',tool_args:{file_path:c+'/'+process.argv[2]},tool_result_summary:'{\"success\":true}',cwd:c})})()" "$REPO/dist/core/timeline/index.js" "$F/订单导出-spec.md"
   node -e "setTimeout(()=>{},1100)"; cgraphx replica create 2026-10-28-订单导出 --prefix 订单导出 --branch feat/订单导出 --json >/dev/null
   (cd "$T/u@订单导出" && git add -A && git commit -qm "docs: 订单导出 spec" && git push -q origin feat/订单导出); C1=$(git -C "$T/u@订单导出" rev-parse --short=7 HEAD); node -e "setTimeout(()=>{},2000)"
   echo "合入前=$(art)"
   git fetch -q --no-tags "$T/u@订单导出" feat/订单导出 && git merge -q --no-ff -m "合入需求：订单导出" FETCH_HEAD && git push -q origin main; node -e "setTimeout(()=>{},2000)"
   echo "合入推送后=$(art)"; cgraphx replica remove 2026-10-28-订单导出 --json >/dev/null; echo "删副本后=$(art) C1=$C1"
   # ㉚ 副本里卸载只删副本的片段;建在主工作区里的 worktree,主目录装不迁走它的,主目录卸载两边都删
   cd "$T" && git init -q w && cd w && printf '.cgraphx/\n.claude/\n' > .gitignore && echo a > a && git add -A && git commit -qm init && init_cgx && cgraphx release guard >/dev/null 2>&1 && cgraphx timeline install >/dev/null 2>&1
   cgraphx replica create 2026-10-28-乙 --prefix 乙 --branch feat/乙 --json >/dev/null
   (cd "$T/w@乙" && cgraphx release guard --remove --json | grep '"status"' && cgraphx timeline uninstall >/dev/null 2>&1)
   echo "主目录 拦截=$(grep -c cgraphx-release-guard .git/hooks/commit-msg) 提交记录=$(grep -c cgraphx-timeline-hook .git/hooks/post-commit) 副本=$(cat "$T/w@乙/.git/hooks/commit-msg" "$T/w@乙/.git/hooks/post-commit" 2>/dev/null | grep -c cgraphx)"
   git worktree add -q .claude/worktrees/wt -b wt && git config core.hooksPath .husky/_ && (cd .claude/worktrees/wt && cgraphx release guard >/dev/null 2>&1) && cgraphx release guard >/dev/null 2>&1
   echo "嵌套=$(grep -c cgraphx-release-guard .claude/worktrees/wt/.husky/_/commit-msg) 主=$(grep -c cgraphx-release-guard .husky/_/commit-msg)"
   cgraphx release guard --remove >/dev/null 2>&1; echo "卸载后 嵌套=$(test -e .claude/worktrees/wt/.husky/_/commit-msg && echo 在 || echo 没了) 主=$(test -e .husky/_/commit-msg && echo 在 || echo 没了)"
   # ㉛ 被跟踪的钩子里自己加了没提交的片段:算已装上、再装不删,卸载删掉;被跟踪的钩子在工作区里删了也不新建
   cd "$T" && git init -q x && cd x && mkdir .husky && printf '#!/usr/bin/env sh\necho team\n' > .husky/commit-msg && chmod +x .husky/commit-msg && printf '.cgraphx/\n.claude/\n' > .gitignore && git add -A && git commit -qm init && git config core.hooksPath .husky && init_cgx
   cgraphx release guard --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const fs=require('fs');const t=fs.readFileSync('.husky/commit-msg','utf8').split('\n');t.splice(1,0,...JSON.parse(s).lines);fs.writeFileSync('.husky/commit-msg',t.join('\n'))})"
   cgraphx release guard --json | grep '"status"'; cgraphx release guard >/dev/null 2>&1; echo "再装后=$(grep -c cgraphx-release-guard .husky/commit-msg)"
   cgraphx release guard --remove >/dev/null 2>&1; echo "卸载后=$(grep -c cgraphx-release-guard .husky/commit-msg) status=[$(git status --porcelain)]"
   rm .husky/commit-msg && cgraphx release guard --json | grep -E '"(status|reason)"'; echo "删了之后=$(test -e .husky/commit-msg && echo 新建了 || echo 没建) status=[$(git status --porcelain)]"
   # ㉜ 副本删掉以后主 spec 头部才声明 T-123、本机没有这条任务:全量刷新补上 T-123,会话落到它;spec 没有负责人时目录任务不删
   cd "$T" && git init -q y && cd y && printf '.cgraphx/\n.claude/\n' > .gitignore && echo a > a && git add -A && git commit -qm init && init_cgx
   for r in 退款 积分; do cgraphx replica create 2026-10-28-$r --prefix $r --branch feat/$r --json >/dev/null; printf '{"session_id":"r-%s","cwd":"%s","source":"startup"}' "$r" "$T/y@$r" | cgraphx timeline-session-start-hook >/dev/null 2>&1; stop "r-$r" "$T/y@$r"; done
   mkdir -p "$T/y@退款/docs/features/2026-10-28-退款" && printf '# 规格说明: 退款\n\n> 产物: spec\n> 负责人: t\n' > "$T/y@退款/docs/features/2026-10-28-退款/退款-spec.md"
   (cd "$T/y@退款" && git add -A && git commit -qm "docs: 退款 spec") && git fetch -q --no-tags "$T/y@退款" feat/退款 && git merge -q --no-ff -m "合入需求：退款" FETCH_HEAD && cgraphx replica remove 2026-10-28-退款 --json >/dev/null
   printf '# 规格说明: 退款\n\n> 产物: spec\n> 负责人: t\n> 任务: T-123\n' > docs/features/2026-10-28-退款/退款-spec.md
   mkdir -p "$T/y@积分/docs/features/2026-10-28-积分" && printf '# 规格说明: 积分\n\n> 产物: spec\n> 任务: T-456\n' > "$T/y@积分/docs/features/2026-10-28-积分/积分-spec.md"
   echo "声明之后:$(tasks)"; for v in 2026-10-28-退款 2026-10-28-积分; do cgraphx task show $v --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log(r.task.externalId??r.task.featureId, JSON.stringify(r.sessions.map(x=>x.binding.sessionId)))})"; done
   cd "$REPO" && rm -rf "$T"
   ```

   → ⑭ 计数为 `1`;guard 输出 `"status": "unsupported"`、`"reason": "outside_repo"`;`releaseFlow=true`;remove 输出 `"status": "absent"`;`shared=[commit-msg] 2 行 releaseFlow=[]`
   → ⑮ guard 输出 `"status": "unsupported"`、`"reason": "tracked"`;提示计数 `1`;`status=[] 索引=[] marker=0 post-commit=在 exclude=2`(post-commit、post-merge 新建在 `.husky/`,各一行);`卸载后 status=[] post-commit=没了 exclude=0`
   → ⑯ guard 输出 `"status": "unsupported"`、`"reason": "symlink"`、`"scope": "tracked"`;提示计数 `1`;`链接目标 2 行`
   → ⑰ 两次 create 都输出 `"created": true`;副本里 status 列出 `?? .claude/commands/new.md`;remove 输出 `"code": "dirty"`;打出 `OK-symlink-kept`;`副本 status=[]`
   → ⑱ `刚开:false/0`;`没提交过但同步过:false/0 已合入后又同步:true/0 提交过没合入:false/1`;`合入后又提交:false/1`
   → ⑲ 打出 `OK-start`、`merge-base-moved`;`Merge branch 'main' into dev/1.0.1 → 同步主干`、`合入需求：戊 → 合入`
   → ㉑ `exit=0 首行=chore(release): 版本号 1.0.0→1.0.1`;`直接提交 exit=1`
   → ㉒ remove 输出 `"state": "removed"`;create 输出 `"code": "name_taken"`;`旧登记 2026-10-28-甲 true`
   → ㉓ `共用目录=[post-commit ] 3 行`;guard 输出 `"status": "present"`;`旧片段=1`;`卸载后 status=[]`
   → ㉔ `冲掉后=0`、`会话开始后=3`(拦截片段 3 行);`被跟踪后=0 status=[]`;`卸载后=0`
   → ㉕ `movedFiles=["docs/features/2026-10-28-会员导出/讨论稿.md"]`;`主目录 调研.local.md=在 讨论稿.md=没了`;`T-789 ["docs/features/2026-10-28-会员导出"] ["feat: 会员导出 spec"]`
   → ㉖ `husky8=3 exclude=1`;`husky9=3 旧文件=没了 exclude=0`;`卸载后=0`;`uninstall 后 .githooks=[]`
   → ㉗ 计数为 `1`(有 `"reason": "not_shell"`,没有 `"lines"`);guard 输出 `"status": "installed"`;`会话开始提示=1 写回=0 status=[]`,再跑 guard 输出 `"reason": "tracked"`;悬空链接 guard 输出 `"reason": "symlink"`、`"scope": "outside_repo"`,提示计数 `1`
   → ㉘ `spec 之前:F:2026-10-28-发票@- F:2026-10-28-订单导出@-`;`声明之后:A:T-123 A:T-456 F:2026-10-28-发票@T-900`;`T-123 ["r-订单导出"]`
   → ㉙ `合入前`、`合入推送后`、`删副本后` 三处都是 `create+` 加末尾打出的 C1
   → ㉚ remove 输出 `"status": "removed"`;`主目录 拦截=3 提交记录=3 副本=0`;`嵌套=3 主=3`;`卸载后 嵌套=没了 主=没了`
   → ㉛ guard 输出 `"status": "present"`;`再装后=3`;`卸载后=0 status=[]`;删了之后 guard 输出 `"status": "unsupported"`、`"reason": "tracked"`;`删了之后=没建 status=[ D .husky/commit-msg]`
   → ㉜ `声明之后:A:T-123 A:T-456 F:2026-10-28-积分@-`;`T-123 ["r-退款"]`;`2026-10-28-积分 ["r-积分"]`

spec「设计验收」各条的落点:1 → 统一验证 3;2 的 `rm -rf` 部分、7、8、9 → 统一验证 5;12 → 统一验证 8;13 → 统一验证 1、2;14~21、23~30 → 统一验证 9;22 → 统一验证 9 先验一遍,单元测试与 3、4、5、6、10、11(单元测试、并发写、计时)以及 2 的 `cgraphx uninstall` 部分 → 全部任务完成后由 `/unit-spec` → `/unit-code` 补。

## 允许局部适配的范围

只限各任务文件「允许局部适配」列出的项:内部辅助函数的拆分与局部命名、注释与文档措辞、markdown / html 排版、错误消息措辞(C-7、C-12 列出的原文除外)。其余(契约 C-1~C-13、涉及范围、导出名与签名、调用方式、提交点)一律固定。

## Plan 冲突上报规则

执行中发现 spec、plan 与代码现实对不上(如契约里的函数在代码里已有同名不同义的、要改的文件超出涉及范围、既有测试与契约冲突)→ 停下,向主会话报 `PLAN_CONFLICT: <任务编号> <冲突点> <依据(文件:行)>`,不自行改契约。权威链:spec > plan > docs/guides 规范。

## 关键风险与防跑偏约束

- D24 / C-1:解析错了,数据会写进别处或写不进去——规则逐条照 C-1,没有 `shared` 链接时所有路径必须与改动前逐字相同(统一验证 3)
- 主目录挪走(C-1 `main-missing`):任何一处顺手 `mkdirSync({ recursive: true })` 都会在旧位置重建 `.cgraphx/`,之后解析退成 own、数据悄悄写进副本本地——T-1 逐个核对写入方,T-8 的 web 预检先查库文件存在再开
- worktree、子模块做项目根:它们的 `.git` 是文件,整仓复制出的副本会和原仓库共用引用,在副本里切分支会改到原仓库——create 按 C-5 先查 `.git` 是 `<项目根>/.git` 目录
- 钩子文件是 node、python 等非 shell 脚本:插进 sh 片段会让钩子报错、每次提交都失败——C-2 遇到非 shell 的 shebang 不写,返回 `unsupported`,timeline install、cgraphx install、release guard 都打 C-7 / C-6 的提示
- D35:删除不可恢复——只删通过五条核对的目录,用 `fs.rmSync`(不跟随符号链接),不调 shell `rm -rf`
- 钩子片段每次提交都会执行:commit-msg 片段只在违规时 `exit 1`,其余路径不得退出;post-merge 片段后台执行、输出丢弃;不得在片段里加其他 `exit`
- 600 行上限:`src/core/timeline/store.ts` 582 行、`src/core/task/store.ts` 567 行、`src/core/sync/runner.ts` 541 行——新增逻辑放进新文件或已有的短文件,store.ts 两个文件不加代码(`src/web/server.ts` 552 行,本需求不改)
- 子 agent 不改测试文件;统一验证里失败的既有用例,属于 spec 有意改掉的行为(D24 的路径来源、D32 的合并记录、D33 的钩子位置与目录)→ 主会话按 spec 改那条用例的期望,提交 `fix(<scope>): …` 时在 body 里列出;其余一律修实现
- skill 改动只在 `assets/claude-template/`
- D28:平台侧确认之前代码照 C-11 写完,但不发版(待确认项)

## 待确认项

- D28【待确认】平台能否把「只有提交、没有事件、带一段绑定」的会话归到任务——要平台侧确认,不阻塞实现:代码照 C-11 写完,发版前必须确认。不能的话退回:不构造副本会话,这些提交照旧挂仓库终端会话,本地 `task show` 仍归到需求(只删 T-6 第 4 条里构造副本会话的部分,C-11 作废)。

## 启动语

```
/dev-impl-subagent docs/features/2026-10-27-版本流程与需求副本/plan/版本流程与需求副本-index.md
```
