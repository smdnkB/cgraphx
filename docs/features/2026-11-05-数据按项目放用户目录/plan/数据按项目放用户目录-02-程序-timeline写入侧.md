# T-2 程序:timeline 写入侧

> 产物: plan
> 依据: spec@4d4bf55

- 目标:hook 每记一条事件,先按会话登记认出会话的根、定好数据位置(要建就建),再写轮次记录、写事件,同一事务 upsert `timeline_roots`;git 钩子按工作区根认项目,一个仓库装了几个项目时按改到的文件分给各项目。卸载规则不在本任务(归 T-3)。
- 对应 spec 编号:D5、D6、D7、D9、D10;K3、K8、K17、K18;全局约束 2(hook 预算)
- 强制引用:`docs/guides/coding-standards.md`、`docs/guides/data-standards.md`、`docs/guides/interface-standards.md`
- 涉及范围:
  - `src/core/timeline/schema.sql`、`schema-bootstrap.ts`、`recorder.ts`、`hook-runner.ts`、`hooks.ts`、`git-commit.ts`(新)、`turn-state.ts`、`constants.ts`
  - 既有测试:`__tests__/core/timeline/` 下 `turn-id.test.ts`、`stop-event.test.ts`、`duration.test.ts`、`auto-message.test.ts`、`git-commit-numstat.test.ts`(被本任务弄红时)
- 必须严格执行:
  - 对外接口按 index C-7;用到的基础层按 C-1、C-2、C-4、C-5(import 自 `../project-identity`、`../repo-projects`、`../session-registry`、`../data-location`、`../db`)
  - `timeline_roots` 的 DDL 照 C-15 原文追加到 `schema.sql` 末尾;不加 `INSERT OR IGNORE INTO timeline_schema_versions` 新行,`constants.ts` 的 `TIMELINE_SCHEMA_VERSION` 不动(D10;data-standards「加版本号」那条按 spec 例外)
  - 写事件:按 C-7 的「记事件」(含 legacy 模式出错时再看记号那条)和 C-7 末尾的 upsert SQL;`recordEvent` 的根一律当已知根(`ensureDataDirAtRoot`、`locateDataAtRoot`),不按 D2 重新往上找;`git_commit` 照旧按 commit_hash 去重(`insertCommitOnce`),去重和 upsert 在同一个 `BEGIN IMMEDIATE` 事务里;其余事件也改成 `BEGIN IMMEDIATE` 包住 enricher、insert、upsert
  - 定位置(D6、D7):非会话开始的 hook,起点 = `process.env[<agent 描述的 projectDirEnv>]`,没有再用 payload.cwd;会话开始 hook 起点 = payload.cwd;都经 C-4 `sessionRootOf(payload.session_id ?? null, 起点)`。返回 null(git 出错)或 `root` 为 null → 这条不记、不写轮次记录。拿到根后先 `ensureDataDirAtRoot(root)`,null → 同样不记;之后轮次记录、事件都用这个根,不再用 `resolveProjectRoot(payload.cwd)`
  - 事件自己的 `cwd` 字段照旧记 payload.cwd(K17:中途 cd、在附加目录里改文件都不换项目,但 cwd 照实记)
  - 会话开始 hook 记完事件后调 `cleanupSessionRegistrations()`;原有的 skill 版本提示、补装 git 钩子片段的逻辑和输出不变
  - 轮次记录(`turn-state.ts`):目录按 C-7 末条(`locateDataAtRoot(root).dataDir` 下的 `TURNS_DIRNAME`);为 null 或目录不在 → 读返回 null、写和删什么都不做(只在已在的数据目录里建 `turns/`,不建数据目录本身);删掉 `main-missing` 分支;导出 `TURNS_DIRNAME`,`safeSessionName` 改为从 `../session-registry` re-export(导出名不变)
  - git 钩子(D9,`git-commit.ts`):照下面「具体要求 3」
  - hook 链路的写库一律 await;任何异常吞掉只写 stderr `[timeline] …`;stdout 只有会话开始 hook 的那一段 `hookSpecificOutput`(interface-standards「Hook 子命令契约」)
  - 不改 `installer.ts`、`cli.ts`(归 T-3)
- 允许局部适配:
  - `runHook` 怎么拿到 agent 与「是不是会话开始」(加选项、加参数都行),`buildEvent` 怎么拿到根;`runHook` 改了签名时同步改调用它的既有测试
  - `git-commit.ts` 内部函数拆分;`hooks.ts` 超 600 行时可再拆
  - 旧库模式再看记号的写法(只要在写事务里、insert 之前)
- 具体要求:
  1. `schema-bootstrap.ts`:`openTimelineDb(start)` 与 `openTimelineDbForRead(start)` 按 C-7;报错文案用 `missingDataMessage(locateData(start))`,`details` 照旧带 `{ projectRoot: path.resolve(start) }`;文件头注释改写(库在数据位置,不再是固定的 `.cgraphx/cgraphx.db`)
  2. `recorder.ts`:`recordEvent(root, event, enricher)`:
     - `dir = ensureDataDirAtRoot(root)`,null → 返回 null
     - 打开 `path.join(dir, DATABASE_FILENAME)`(`DatabaseConnection.open`)并 `ensureTimelineSchema`;`BEGIN IMMEDIATE`;`locateDataAtRoot(root).mode` 是 legacy 时读 `readLocalProjectJson(root)?.mergedAt`,有值 → `ROLLBACK`、关库、从头再走一次(第二次 `ensureDataDirAtRoot` 给的是项目目录;最多重走一次)
     - legacy 模式下从打开到 `COMMIT` 之间任何一步抛错:先关库,再读一次 `mergedAt`,有值 → 从头再走一次(同上,最多一次);没有 → 照常抛出
     - `git_commit` 走 `insertCommitOnce` 的去重;其余 `store.insert(applyEnricher(...))`;然后 upsert `timeline_roots`;`COMMIT`;出错先 `ROLLBACK` 再抛
     - `insertCommitOnce` 改成在调用方已开的事务里执行(不再自己 BEGIN)
  3. `git-commit.ts`(新):把 `gitCommitHook`、`readGitCommitInfo`、`isFastForward`、`commitMetadata`、`GitDiffStats`、`GitCommitInfo` 和 numstat 辅助函数从 `hooks.ts` 挪过来,`hooks.ts` 原名 re-export `gitCommitHook`、`readGitCommitInfo`、`GitCommitInfo`、`GitDiffStats`。`gitCommitHook` 在读完提交信息、判完快进之后:
     - `projects = listRepoProjects(info.cwd)`;`'git-error'` → 不记;空数组 → 不记
     - 只有一项、且它的 `subdir` 为 null(没有子目录项目)→ 整个提交照现在的字段记给这一项的 `root`
     - 否则按文件分:非合并提交跑 `git -c core.quotePath=false show --numstat --no-renames --format= <hash>`,合并提交跑 `git -c core.quotePath=false diff --numstat --no-renames <第一父提交> <hash>`,得到每个文件的增删行(二进制文件两列是 `-`,计文件不计行);每个文件归包含它的最深那个项目(子目录项目按 `subdir + '/'` 前缀;都不中的归 `subdir` 为 null 的那一项,没有这一项就不归);每个分到文件的项目记一条 `git_commit`:非合并提交 `commit_files` = 它的文件、增删行 = 它那些文件的合计;合并提交 `commit_files` = `[]`、增删行 0、`metadata.merge` = `{ parents, files, insertions, deletions }` 只算它的那份;`cwd` 一律 = `info.cwd`;会话 id、agent、分支照现在
     - 每一项各调一次 `recordEvent(项目.root, …)`;子目录项目的根可能没装过(如 worktree 里),`recordEvent` 按已知根处理,记不记、记哪个库由 D7 定(项目库不在的自然不记)
  4. `hook-runner.ts`、`hooks.ts`:按「必须严格执行」的定位置规则改;`userPromptHook` 写轮次记录、各 hook 读轮次记录、`sessionEndHook` 删轮次记录都用会话的根;`sessionStartHook` 的 `skillVersionNoticeWithoutTaskHook`、`repairGitHookSnippets` 照旧用 payload.cwd
  5. 既有测试:被弄红的只改准备数据、调用方式(如 `runHook` 签名),断言意图不变;测试里建的临时项目要让事件落在可预期的位置——要它照旧写本地库的,先让本地库里有 timeline 表(旧库模式)
- 完成条件:
  - `grep -n "timeline_roots" src/core/timeline/schema.sql` 有命中;`grep -c "INSERT OR IGNORE INTO timeline_schema_versions" src/core/timeline/schema.sql` 仍是 2
  - `grep -rn "resolveDataDir\|main-missing\|resolveProjectRoot(payload.cwd" src/core/timeline` 无输出
  - `grep -n "ensureDataDirAtRoot" src/core/timeline/recorder.ts` 有命中;`grep -n "ensureDataDir(" src/core/timeline/recorder.ts` 无输出
  - `grep -n "export { gitCommitHook\|readGitCommitInfo" src/core/timeline/hooks.ts` 有命中;`src/core/timeline/git-commit.ts` 存在
  - `grep -n "export const TURNS_DIRNAME" src/core/timeline/turn-state.ts` 有命中
- 提交点:
  1. `feat(timeline): 记事件按会话的根定位置——会话登记、旧库模式写事务里再看记号、同一事务记下项目根`:`schema.sql`、`schema-bootstrap.ts`、`recorder.ts`、`hook-runner.ts`、`turn-state.ts`、`constants.ts`(有改动时),以及改过的 `turn-id`、`stop-event`、`duration`、`auto-message` 测试
  2. `feat(timeline): 提交按工作区根认项目——一个仓库几个项目时按改到的文件分`:`git-commit.ts`、`hooks.ts`,以及改过的 `git-commit-numstat.test.ts`
- 风险/注意事项:
  - 旧库模式下,并旧数据刚提交的瞬间,本 hook 打开本地库时 `ensureTimelineSchema` 可能在本地库里重建出空的 timeline 表;记号已在,这些空表不影响判定(C-5 先看记号),不用处理
  - 不要在 post_tool_use、pre_tool_use、stop、user_prompt hook 里跑 git:根和标识都来自会话登记(D5);只有登记读不到时 `sessionRootOf` 会补认一次
  - `timeline_roots` 记的根取 realpath;事件 cwd 照原样,读取方按 C-6 匹配(原样不中再比 realpath)
  - `hooks.ts` 现有 535 行,挪走 git 钩子部分后应明显变短;别把新逻辑塞回 `hooks.ts`
  - 本任务和 T-3 同时改 timeline:`store.ts`、`stats.ts`、`roots.ts`、`merge.ts`、`indexer.ts`、`index.ts`、`types.ts`、`installer.ts`、`cli.ts` 归 T-3,不要碰
