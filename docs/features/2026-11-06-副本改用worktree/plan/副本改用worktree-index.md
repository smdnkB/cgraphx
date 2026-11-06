# 实现计划: 副本改用worktree

> 产物: plan
> 依据: spec@e839c10

## 设计预览

原来开副本要把整个主目录写时复制一份,受文件系统限制,合入还要跨仓库取分支。这次副本改成一个 git worktree:在主目录旁边 `git worktree add` 出 `<主目录名>@<文件前缀>`,只带 agent 配置和 `.worktreeinclude` 里写的文件(依赖默认不带),再用副本自己的 `core.excludesFile` 把这些文件对 git 藏起来;合入、同步直接读同一个仓库里的 `refs/heads/<分支>`,不再 fetch;删副本改成 `git worktree remove --force`,需求分支按合入情况删或留,留下的下次开同一个需求接上。skills 与知识库同步改写。

**难回头的决策落在哪**(决策已在 spec 确认,这里核对落点,其余可略读)

| spec 决策 | 落在 | 怎么守住 |
|---|---|---|
| D3 🔒 清单文件 `.worktreeinclude`,gitignore 语法 | T-2 `carry.ts`、T-5 `dev-start` | 文件名只在 `constants.ts` 一处(C-8);清单里的行主目录没有只提示、不报错(C-9 的 W2) |
| D4 🔒 带来的文件对 git 隐藏 | T-2 `carry.ts` | 只写副本的 `.cgraphx/replica-exclude` + 主仓库 `extensions.worktreeConfig`,绝不碰共享的 `.git/info/exclude`(C-3) |
| D12 🔒 删副本按合入情况删/留需求分支 | T-4 `remove.ts`、`cli.ts` | 分支结果走 `RemoveReplicaResult.branch`(C-7),`tip` 在删除前取 |

## 来源 spec 摘要

- feature-id:`2026-11-06-副本改用worktree`;spec:`docs/features/2026-11-06-副本改用worktree/副本改用worktree-spec.md`
- 功能点:F1 开副本、F2 同步和合入、F3 查看和删除副本、F4 发版审核和清理
- 细节方案:D1~D14(机制、带文件、隐藏、数据目录、回滚、接分支、钩子、合入判断、删分支、删目录);全局约束见 spec「全局约束」
- spec 待确认项:无

## 范围

- F1:开 worktree、带 agent 配置(K4)与清单文件(K16)、建副本自己的数据目录(K5)、拷需求目录未跟踪文件(K6)、主目录有改动只提示(K7)、接上留下的分支(K15)
- F2:合入判断改读主目录本地分支(K9)、`/dev-merge` 直接使用 `refs/heads/<分支>`
- F3:`git worktree remove --force` 删目录、按 K9 删/留需求分支(K13)、目录核对加 worktree 归属(K14)
- F4:清理副本的说法跟着 F3 的返回值走(流程不变)
- 文档与知识:两份 skill、`release-review`、cgraphx-guide/FLOW-MAP、知识库「需求副本」「版本分支」、本仓库 `CLAUDE.md`、`CHANGELOG.md`

## 明确不包含

- spec 功能方案「建议新增 ✂️」「边界外」的全部不做项:带依赖的开关、主目录改名后一键修复、兼容旧版写时复制副本、多个副本的端口/数据库隔离、认 agent 自己开的 worktree、Windows 与子模块的完整支持
- 不写迁移代码;旧版写时复制副本由用户升级前手动清理,只写进 CHANGELOG
- 不排测试任务:单元测试、接口测试走代码完成后的独立流程(`unit-spec`→`unit-code`、`api-case`→`api-run`);本 plan 只要求既有测试不被弄红
- 不改 `replica list` 的显示、登记文件格式、K1 判定,不改 `replicaLinkOf`、`shared` 链接、timeline/features/project 的调用

## 任务清单

| 编号 | 任务 | 对应 spec | 涉及范围 | 文件数 |
|---|---|---|---|---|
| T-1 | 描述层:`extraConfigFiles` 与 worktree 列表 | D2、K4 | `src/core/agents/types.ts`、`src/core/agents/profiles.ts`、`src/core/repo-projects.ts` | 3 |
| T-2 | 开副本改用 worktree:带配置/清单、隐藏、接分支、回滚 | F1、D1~D9、K1~K7、K15、K16 | `src/core/replica/create.ts`、`src/core/replica/carry.ts`(新)、`src/core/replica/constants.ts`、`src/core/replica/errors.ts`、`src/core/replica/types.ts`(create 部分)、`src/core/replica/cli.ts`(create 部分) | 6 |
| T-3 | 合入判断改读主目录本地分支,删掉 fetch | F2(K9)、D10 | `src/core/replica/status.ts` | 1 |
| T-4 | 删副本改删 worktree,按 K9 删/留分支 | F3、D12~D14、K13、K14 | `src/core/replica/remove.ts`、`src/core/replica/types.ts`(remove 部分)、`src/core/replica/cli.ts`(remove 部分) | 3 |
| T-5 | `dev-start` 改写:worktree、带什么、启动提示 | F1、spec「文档」 | `assets/claude-template/skills/dev-start/SKILL.md` | 1 |
| T-6 | `dev-merge` 与 `release-review` 改写:直接用分支、删副本说法 | F2、F3、F4、D11、spec「文档」 | `assets/claude-template/skills/dev-merge/SKILL.md`、`assets/claude-template/skills/release-review/SKILL.md` | 2 |
| T-7 | cgraphx-guide 与 FLOW-MAP 改写 | spec「文档」 | `assets/claude-template/skills/cgraphx-guide/SKILL.md`、`how-to-use.md`、`how-to-use.html`、`skills.html`、`assets/claude-template/FLOW-MAP.md` | 5 |
| T-8 | 知识库「需求副本」「版本分支」改写 | spec「文档」、K1、K4、K5、K9、K13 | `docs/knowledge/需求副本.md`、`docs/knowledge/版本分支.md` | 2 |
| T-9 | 本仓库 `CLAUDE.md` 与 `CHANGELOG.md` | spec「文档」、破坏性说明 | `CLAUDE.md`、`CHANGELOG.md` | 2 |

任务涉及文件 25 次,去重后 23 个(含新增 `carry.ts`;`types.ts`、`cli.ts` 被 T-2、T-4 各改一次)。

## 执行顺序

1. **T-1**(单独跑):T-2、T-4 都用到 C-1、C-2 的签名,先把它落地,后两步不必为编译不过分心。
2. **T-2、T-3 同时跑**:T-2 改 `create.ts`/`carry.ts`/`constants.ts`/`errors.ts`/`types.ts`/`cli.ts`,T-3 只改 `status.ts`,文件不重叠;两者都依赖的 C-4/C-5/C-6 已在下面定死。两笔提交都落地后 `npm run build` 应通过。
3. **T-4**(依赖 T-2 的 `types.ts`/`cli.ts` 与 T-3 的 C-6,不能与前一步同时跑)。
4. **T-5~T-9 同时跑**:五个任务改的文件互不重叠,内容以本 index 的契约和 spec 为准(不依赖代码实际长什么样)。

## 必须严格执行的契约

跨任务共享的签名、文件名、文案只在这里定义;任务文件按编号引用,不抄原文。

**C-1 `AgentProfile.extraConfigFiles`**

- `src/core/agents/types.ts` 的 `AgentProfile` 增加必填字段 `readonly extraConfigFiles: readonly string[]`,注释:项目根下除配置目录、指引文件外还要带走的额外配置文件(相对项目根)。
- `src/core/agents/profiles.ts`:`CLAUDE_CODE.extraConfigFiles = ['.mcp.json']`,`CODEBUDDY.extraConfigFiles = []`。其余字段、登记顺序、`assetReplacements` 不变。

**C-2 `listWorktreeRoots`**

- `src/core/repo-projects.ts` 的 `listWorktreeRoots(cwd: string): string[] | null` 改为导出;行为不变:`git worktree list --porcelain` 的各个 `worktree ` 行 `path.resolve` 后返回,git 出错 → `null`。

**C-3 `carry.ts` 的带文件契约**

- 新文件 `src/core/replica/carry.ts`,导出 `carryIntoReplica(mainRoot: string, target: string): { warnings: string[] }`,只做 D2(K4)、D3(K16)、D4 三件事,按 K4 → K16 → D4 的顺序。
- K4(agent 配置,只带没被跟踪的):对每家 `listAgentProfiles()` 取 `configDirName`、`instructionsFileName`、`extraConfigFiles`,去重后在 `mainRoot` 跑
  `git ls-files -z --others --directory -- <这些路径>`;对每一项(末尾 `/` 去掉)用
  `fs.cpSync(源, 副本同相对路径, { recursive: true, verbatimSymlinks: true, filter })` 拷过去,`filter` 用 `fs.realpathSync` 比对 `listWorktreeRoots(mainRoot)` 的 realpath 集合,命中即 `false`(跳过 agent 自己开的 worktree;`listWorktreeRoots` 返回 `null` 时不跳过)。目标父目录不存在先建。
- K16(`.worktreeinclude`,见 C-8):照 D3 的取法
  `git ls-files -z --others --ignored --exclude-from=.worktreeinclude`(在 `mainRoot` 跑;**不加** `--exclude-standard`,`--exclude-from` 里的模式就是全部匹配来源),NUL 切分后去掉以 `.cgraphx/` 开头的项,再逐个拷到 `target`。清单里的行逐行按 C-8 判断主目录有没有,没有的进 `warnings`(W2)。
- D4(对 git 隐藏):在 `target` 跑
  `git ls-files -z --others --exclude-standard --directory -- <实际带进来的相对路径> .cgraphx`,路径一律写成 `:(literal)<相对路径>`(防止清单里的 `../out`、通配被当 pathspec 二次解释;`../out` 这类路径不得传给 git)。`.cgraphx` 必须一起查:它里面的 `.gitignore` 是 `*` + `!.gitignore`,项目根没忽略 `.cgraphx/` 时它是可见的,不藏起来每个副本的 K10 都会永远不干净(旧实现一直在 `.git/info/exclude` 里加它)。没有任何可见项 → 直接返回,不改任何 git 配置。
  有可见项时:
  1. 取用户级忽略文件:`git -C <mainRoot> config --get core.excludesFile`;取不到用 `$XDG_CONFIG_HOME/git/ignore`,再没有用 `~/.config/git/ignore`;读不到按空串。
  2. 内容 = 用户级忽略文件原文(有内容且末尾没换行补一个换行)+ 每个可见项去掉末尾 `/` 后用基础层 `gitPathPattern()` 转成的一行。
  3. 写到 `<target>/.cgraphx/replica-exclude`。
  4. `git -C <mainRoot> config extensions.worktreeConfig true`,再
     `git -C <target> config --worktree core.excludesFile <target>/.cgraphx/replica-exclude 的绝对路径`。
  5. 不写、不改 `<mainRoot>/.git/info/exclude`(worktree 共用,会盖住主目录)。
- 所有 git 命令都带 `cwd = <mainRoot>` / `-C <target>`;所有拷贝的源、目标路径都用 `path.join(<mainRoot 或 target>, 相对路径)` 拼绝对路径,不依赖进程当前目录。
- 任何 git 命令非零退出、文件拷贝失败 → 抛 `Error`(消息带命令和 git 原话),由 `createReplica` 按 ⑧ 回滚;清单里某行主目录没有**不**抛,只 warning。

**C-4 replica 错误码**

- `src/core/replica/errors.ts` 的 `REPLICA_ERROR_CODES` 改为:
  `invalid_args`、`not_main_dir`、`worktree_failed`、`target_exists`、`name_taken`、`feature_has_replica`、`unsupported_platform`、`dirty`、`not_found`、`unsafe_target`。
  删 `dirty_main`、`no_cow`;加 `worktree_failed`。
- `ReplicaErrorDetails` 只留 `files?: string[]`(删 `requiredBytes`)。
- `exitCodeForError` 不变:`invalid_args` → 3,其余 `ReplicaError` → 2,非 `ReplicaError` → 1。

**C-5 开副本的类型与 CLI**

- `CreateReplicaOptions`:只留 `featureId`、`prefix`、`branch`(删 `fullCopy`)。
- `CreateReplicaResult extends ReplicaEntry`:加 `movedFiles: string[]`(实际从主目录删掉的)、`warnings: string[]`、`reattached: boolean`(这次接上了删副本时留下的分支)。
- `ReplicaEntry` 的字段与登记文件格式不变(K15 靠 `branch`、`baseCommit`、`featureId`)。
- CLI:`cgraphx replica create <feature-id> --prefix <prefix> --branch <branch> [--json]`;删 `--full-copy`,命令与子命令描述改成 worktree 的说法。`--json` 成功 `{ ok: true, ...结果 }`,失败 `{ ok: false, code, message, files? }`,退出码按 C-4。
- 失败 code:`worktree_failed`(⑦,git 原话)、`invalid_args`(③ 分支不是本需求留下的)、`target_exists`、`name_taken`、`feature_has_replica`、`not_main_dir`、`unsupported_platform`。

**C-6 合入判断 `mergeStateOf`**

- `src/core/replica/status.ts` 导出
  `export function mergeStateOf(mainRoot: string, entry: ReplicaEntry): { merged: boolean | null; ahead: number | null }`。
- 取法:`git -C <mainRoot> rev-parse -q --verify refs/heads/<entry.branch>`;非零或空 → `tip = ''`(不再有 fetch、不再有 `cat-file`)。`tip === ''` → `{ merged: null, ahead: null }`;其余照旧走 `ownCommitsState`(第一父链、非合并提交、`^baseCommit`),`baseCommit` 为 `null` 的旧登记走 `merge-base --is-ancestor` 那条。
- `listReplicaStatus` 内部改用 `mergeStateOf`;`ReplicaStatus` 字段不变。

**C-7 删副本的结果**

```ts
export interface RemoveReplicaResult {
  name: string;
  state: 'removed' | 'missing';
  branch: { name: string; state: 'deleted' | 'kept'; tip: string };
  warnings: string[];
}
```

- `branch.name` 是 `entry.branch`;`tip` 是删除前 `refs/heads/<分支>` 的提交号,引用不在 → `''`。
- 分支删不掉(非零退出)进 `warnings`,该分支结果记 `state: 'kept'`。
- `state` 含义不变:`removed` 删掉了目录;`missing` 目录早已不在,只在登记里记为删除。

**C-8 `.worktreeinclude` 的处理规则**

- 位置:主目录根下的 `.worktreeinclude`;cgraphx 不创建、不提交,不存在就什么都不带、不提示。
- 语法:gitignore 语法;空行忽略;`#` 开头是注释;`!` 开头的行照常交给 `--exclude-from` 生效,但不参与「主目录没有」的逐行判断。
- 取文件用 D3 的命令;`.cgraphx/` 下的不带。
- 「主目录没有」判断:每一行(非空、非注释、非 `!`)先跑
  `git ls-files -z --others --ignored --exclude=<行>`(失败 → 抛),空再跑
  `git ls-files -z -- <行>`(按 pathspec 通配匹配,已跟踪的才对得上 `*.txt` 这类行;路径在仓库外等非零退出按空处理);两者都空 → W2。
- 常量:文件名放 `src/core/replica/constants.ts` 的 `WORKTREE_INCLUDE_NAME = '.worktreeinclude'`,别处不写字面量。

**C-9 警告与错误文案**

- W1(主目录有改动,K7/D9):`主目录有 ${n} 个文件没提交,没带进副本`
- W2(清单里没有,⑩):`清单里的 ${line} 主目录没有,没带`
- W3(主目录那份没删掉,⑨):`主目录里的 ${rel} 没删掉(${reason}),副本里已有一份;手动删掉主目录这份`
- W4(钩子没补上,D8):`hookNotice(result, '钩子片段没补上')` 返回的原话;为 `null` 的不进 warnings
- ⑦ 的报错:`开 worktree 失败:${git stderr 第一行};没有留下任何东西,主目录没动`
- ③ 的报错(分支已存在、又不是本需求留下的):`主目录已有本地分支 ${branch};换个分支名再开副本`
- D13 的 `unsafe_target` 原因(拼在现有 `${entry.name} 没删:${reason};...` 里):`这个目录不是本仓库的 worktree`(最终消息由前缀补上「没删」)

**C-10 不变的边界**

- 副本目录仍是 `<主目录 realpath 的上级>/<主目录名>@<文件前缀>`;登记仍是 `<主目录>/.cgraphx/replicas/<副本目录名>.json`,字段不变。
- K1 判定、`replicaLinkOf`/`shared` 链接、`replica list` 显示、`replica list --json` 字段不变。
- 副本数据目录仍是 `<副本>/.cgraphx/`(本地知识库 + `.gitignore` + `shared` 链接);`shared` 只链这一个。

## 细节方案核对

| spec 决策 | 落点 | 核对 |
|---|---|---|
| D1 开目录的机制 | T-2 `create.ts` | `worktree add -q -b <分支> <目标> HEAD`;删 `copyTree`、`dropUntracked`、`venvWarnings`、`--full-copy`、`no_cow`、`dirty_main`;新增 `worktree_failed` |
| D2 带 agent 配置 | T-1 + T-2 | C-1 字段、C-2 导出、C-3 的 K4 |
| D3 🔒 清单文件 | T-2 + T-5 | C-8 规则;dev-start 写文件名与提示 |
| D4 🔒 带来的文件对 git 隐藏 | T-2 | C-3 的 D4;不碰共享 `info/exclude` |
| D5 cgraphx 目录与「在副本里」 | T-2 | `prepareDataDir`:链接/文件先删、`createDirectory`、建空本地库、`shared` 链回主目录;`replicaLinkOf` 不动 |
| D6 拷讨论稿与失败回滚 | T-2 | 拷完再写登记;失败 `worktree remove --force` + 新建分支 `branch -D` + 删登记文件;接上的分支留着 |
| D7 接上留下的分支 | T-2 | 按 `featureId`+`branch` 找已删/目录不在的最新登记;`worktree prune` 后 add;`baseCommit` 沿用;`reattached: true`;旧登记名字不同标已删 |
| D8 钩子 | T-2 | `repairHookSnippets(target)` → W4 |
| D9 主目录有改动 | T-2 | `trackedChanges` → W1;git 出错不拦 |
| D10 合入判断 | T-3 | C-6:本地 ref、删 fetch |
| D11 `/dev-merge` 的命令 | T-6 | 合入、同步都写全 `refs/heads/`;删两处 fetch 与红线 1 |
| D12 🔒 处理需求分支 | T-4 | C-7:`merged === true` 或 `merged === false && ahead === 0` 才删;tip 删除前取 |
| D13 删目录 | T-4 | 核对加 worktree 归属;`git worktree remove --force` |
| D14 目录已不在 | T-4 | `worktree prune` → 按 D12 处理分支 → 标已删 |
| spec「文档」表 | T-5~T-9 | 逐文件对应,见任务清单 |

K1、K2 沿用现有实现(无新决策);K5、K8、K10、K11、K12、K14 的其余部分沿用;F4 只改 `release-review` 的文案(T-6)。

## 适用规范

- `docs/guides/coding-standards.md`:「边界与结构」「选型(偏离社区默认)」「错误与日志」
- `docs/guides/interface-standards.md`:「命令注册」「输出」「退出码」(本仓库的「接口」= CLI 命令面)
- `docs/guides/git-standards.md`:交给下面的「提交规范」一次结晶;各任务不再单独读

## 提交规范

以下从 `git-standards.md` 结晶,实施期直接照此写 message、过检查点,不再现场读规范。

- 格式:`type(scope): 中文描述`。type 用 feat / refactor / fix / docs;scope 常用 `skills` / `installer`,仓库级改动省 scope。
- 补充说明用「——」,并列用「+」,数值对比用「→」;不写票据;需求追踪走 `docs/features/`。
- body:非琐碎提交写背景一行 + 「-」列要点;琐碎可只留 subject。
- 提交前检查点(逐条对照 `git diff --cached`):
  - 与 TS 同放的运行时资产登记 `scripts/copy-assets.cjs`(本需求没有新增运行时资产,`carry.ts` 是 TS);
  - `src/core` 不出现对 `src/cli` / `src/web` 的 import;
  - `vitest.config.ts` 的 `TZ: 'UTC'` 不被改;
  - 不出现写死的绝对路径、密钥、阈值、版本号;
  - 不新增 TODO / FIXME,不留被注释掉的命令注册。
- 每笔提交前 `git status --short` 确认只含本提交点列出的文件;被 commit-msg 门禁拦下时按提示自查暂存内容,说明不改时带 `CGRAPHX_PRECOMMIT_REVIEWED=1` 重试。

## 统一验证

全部任务做完后跑(在仓库根;先 `npm run build` 用新代码):

```bash
npm run build
npm test

# 旧实现与旧说法必须清零
grep -rn "no_cow\|--full-copy\|fullCopy\|写时复制" src/ assets/claude-template/ || echo "OK: 无残留"
grep -rn "fetch" src/core/replica/ assets/claude-template/skills/dev-merge/SKILL.md || echo "OK: 没有 fetch"

# 命令面
node dist/cli/index.js replica create --help          # 没有 --full-copy,描述不再说复制整个主目录
node dist/cli/index.js replica remove --help
node dist/cli/index.js replica list --help
```

端到端冒烟(临时 HOME + 临时仓库,别在本仓库跑):

```bash
export CGRAPHX="$PWD/dist/cli/index.js"
TMP=$(mktemp -d)
export HOME="$TMP/home"; mkdir -p "$HOME"
unset CLAUDE_CODE_SESSION_ID CODEBUDDY_SESSION_ID
REPO="$TMP/demo"; mkdir -p "$REPO/docs/features/2026-11-06-demo"; cd "$REPO"
git init -q; git config user.email a@b; git config user.name a
printf 'node_modules/\n.claude/\n' > .gitignore
printf '# demo\n' > CLAUDE.md; printf 'LOCAL=1\n' > .env; printf '{"mcp":{}}\n' > .mcp.json
printf '.env\n' > .worktreeinclude
printf '# 讨论稿\n' > docs/features/2026-11-06-demo/demo-功能方案-v1.md
git add .gitignore CLAUDE.md; git commit -qm init
node "$CGRAPHX" install -y -t claude-code >/dev/null

# F1:worktree、带文件、移讨论稿
node "$CGRAPHX" replica create 2026-11-06-demo --prefix demo --branch feat/demo --json | tee "$TMP/create.json"
test -d "$TMP/demo@demo" && test -f "$TMP/demo@demo/.env" && test -f "$TMP/demo@demo/.mcp.json" \
  && test -d "$TMP/demo@demo/.claude" && echo "OK: 带进来了"
test ! -e docs/features/2026-11-06-demo/demo-功能方案-v1.md && echo "OK: 讨论稿已移走"
git -C "$TMP/demo@demo" worktree list | grep -q "demo@demo" && echo "OK: 是真的 worktree"
git -C "$TMP/demo@demo" status --porcelain | grep -q "docs/features/" && echo "OK: 讨论稿在副本里(未跟踪)"
! git -C "$TMP/demo@demo" status --porcelain | grep -qE "\.env|\.mcp\.json" && echo "OK: 带进来的文件被藏起来"
test -n "$(git -C "$REPO" status --porcelain -- .env)" && echo "OK: 主目录照常看得到 .env"
test "$(git -C "$REPO" config --get extensions.worktreeConfig)" = true && echo "OK: 开了 worktreeConfig"

# F2:提交、合入判断、直接合 refs/heads
cd "$TMP/demo@demo"; printf 'x\n' > x.txt; git add -A; git commit -qm "feat: demo"
cd "$REPO"; node "$CGRAPHX" replica list --json    # ahead 1、merged false、dirty []
git merge --no-ff -q -m "合入需求：demo" refs/heads/feat/demo
node "$CGRAPHX" replica list --json                # merged true

# F3:删目录、删已合入的分支
node "$CGRAPHX" replica remove demo@demo --json    # state removed、branch.state deleted、tip 非空
test -z "$(git worktree list | grep demo@demo)" && echo "OK: worktree 已删"
git show-ref --verify --quiet refs/heads/feat/demo || echo "OK: 分支已删"

# K15:差提交 → 分支留下 → 重开接上,baseCommit 不换
node "$CGRAPHX" replica create 2026-11-06-demo --prefix demo --branch feat/demo --json  # 新分支
cd "$TMP/demo@demo"; printf 'y\n' > y.txt; git add y.txt; git commit -qm "feat: demo 2"
cd "$REPO"; node "$CGRAPHX" replica remove demo@demo --json   # branch.state kept
node "$CGRAPHX" replica create 2026-11-06-demo --prefix demo --branch feat/demo --json \
  | grep -q '"reattached": true' && echo "OK: 接上了留下的分支"
node "$CGRAPHX" replica list --json                # ahead 1(不是 0)

# K7:主目录有改动只提示
printf 'change\n' >> CLAUDE.md
node "$CGRAPHX" replica create 2026-11-06-demo2 --prefix demo2 --branch feat/demo2 --json \
  | grep -q '主目录有 1 个文件没提交,没带进副本' && echo "OK: dirty main 只提示"
git checkout -- CLAUDE.md

# ③:分支已存在、不是本需求留下的 → invalid_args
git branch feat/other
node "$CGRAPHX" replica create 2026-11-06-other --prefix other --branch feat/other --json   # code invalid_args

cd /; rm -rf "$TMP"
```

预期:`npm test` 全绿;两处 grep 无输出;冒烟各条 `OK` 都打出来;`reattached` 前后分别为 `false`/`true`,`ahead` 在重开后仍是 1;`create.json` 里 `warnings` 为空。

## 允许局部适配

- 内部函数与文件的拆分、内部命名、参数顺序(`carry.ts` 内部怎么拆、`create.ts` 里 `prepareDataDir`/`copyFeatureFiles` 等私有函数怎么命名),只要 C-3、C-5 的导出面不变。
- 错误与警告消息的措辞,除了 C-9 固定的几句;不得改变语义(比如 W2 不能升成错误)。
- 注释写法、中文措辞;不改代码行为。
- `carry.ts` 内部先拷哪一类、怎么收集可见项——只要满足 C-3 的顺序和结果。

除此之外一律固定:签名、文件名、命令面、CLI 输出字段、判定口径、文案(C-9)、登记格式。

## Plan 冲突上报规则

实现中发现下列情况,停下按 `PLAN_CONFLICT: <任务编号> <一句话冲突>` 上报,不自行改契约:

- spec 的决策与现有代码/API 冲突,或按 plan 做会违反 spec;
- 两份任务文件对同一符号、文案、命令的写法不一致;
- 本 plan 没有覆盖、但必须由人拍板的接口/口径(业务规则、数据结构、命令面)。

纯代码内部适配(见「允许局部适配」)自行处理,不报。

## 关键风险与防跑偏约束

- **回滚顺序**:`git worktree remove --force` 成功后才 `git branch -D`;接上的分支在任何失败下都留着;登记文件最后写、先回滚。主目录那份永远最后删。
- **不碰共享的 `.git/info/exclude`**:worktree 共用,写进去会盖住主目录(D4 实测);只写副本自己的 `core.excludesFile`。
- **`--exclude-from` 不要配 `--exclude-standard`**:配了会把 `.gitignore` 忽略的 `node_modules` 一起带进来;D3 的取法依赖「清单模式就是全部匹配来源」。
- **`--directory` 的输出可能是文件、也可能是带末尾 `/` 的目录**:两种都要能拷;目录项要带 `filter` 跳过嵌套 worktree,否则会把 agent 自己开的 worktree 拷进副本。
- **D4 的可见性检查不要把清单原行当 pathspec**:`../out` 会让 `git ls-files` 以 128 退出;只用实际拷进来的相对路径并加 `:(literal)`。
- **删目录必须带 `--force`**:副本里通常有被忽略的 `node_modules`/`.env`,不带 force 会被拒绝。
- **旧副本兼容**:旧版写时复制副本的分支不在主目录 → `merged: null`;`/dev-merge` 停在 ⑥,`remove` 停在 D13,不会删错。不写迁移代码。
- **D8 的钩子登记走共享 git 公共目录**:`repairHookSnippets` 会把副本里的钩子文件加进 `files[]`,主目录那份保留;不要再走 `appendGitInfoLines`。
- **文件行数**:`create.ts` 若超 600 行,按 coding-standards 继续向外拆(只能拆内部实现,不得改 C-3/C-5 的导出面)。

## 待确认项

无。spec 的「待确认项」为空;本 plan 把 `.worktreeinclude` 的 `!` 行、用户级忽略文件的取法、删副本分支结果在 CLI 的说法都落在 C-3、C-8、C-7,不留到实现期。

## Plan Review

派了两次 `plan-document-reviewer` 子 agent(隔离上下文,按模板的 6 个维度审查),均超时未返回;主 agent 按同样的 6 个维度自查:

- 完整性:各任务「具体要求」「完成条件」与 index「统一验证」无 TBD/占位;跨任务引用只用 C-1~C-10;
- spec 覆盖:F1~F4、D1~D14、「文档」表、全局约束、迁移与兼容逐条有任务对应;
- 可执行性:每个任务给出文件、命令、签名、完成条件;冒烟脚本可跑;
- 跨任务一致性:`mergeStateOf`、`RemoveReplicaResult.branch`、`carryIntoReplica`、`reattached`、CLI 字段只在 index 定义一次;
- 执行契约:每个任务都有「必须严格执行」「允许局部适配」;冲突上报条件已写;
- 规范遵循:coding/interface/git 三份规范已标注,提交规范已结晶。

未发现阻塞问题。实现期发现 plan 与 spec/代码冲突,按「Plan 冲突上报规则」停下上报。

## 启动语

```text
/dev-impl-subagent docs/features/2026-11-06-副本改用worktree/plan/副本改用worktree-index.md
```
