# T-9 程序:project 子系统

> 产物: plan
> 依据: spec@4d4bf55

- 目标:新增 `project` 子系统(无表):`cgraphx project show / name / list / remove` 四个命令,install 时问名字、记名字的两个函数,以及把一个目录的本地旧库并进用户目录的编排(拿锁、备份、两段并、文件并、写记号、删旧表)。
- 对应 spec 编号:D1、D17、D18、D19(含补的「旧库里不许改名」)、D25(给 install / uninstall 调的函数)、D26、D27、D28(编排)、D29(文件部分与编排)、D30、D32、D33;F2、F4、F5;K2、K6、K9、K10、K11、K13~K16
- 强制引用:`docs/guides/coding-standards.md`、`docs/guides/interface-standards.md`、`docs/guides/data-standards.md`
- 涉及范围:
  - `src/core/project/` 下新文件 `index.ts`、`cli.ts`、`errors.ts`、`types.ts`、`constants.ts`、`show.ts`、`name.ts`、`list.ts`、`remove.ts`、`merge.ts`、`merge-files.ts`
- 必须严格执行:
  - 门面按 index C-12,命令按 C-13,文案按 C-14,文件格式按 C-15
  - 只 import:基础层(`../project-identity`、`../repo-projects`、`../user-data-dir`、`../session-registry`、`../data-location`、`../directory`、`../db`、`../root-match`)与 timeline、task、sync、replica 的门面(`from '../timeline'` 这种,不带子路径);不 import dbquery、markdown、features、`src/cli/`、`src/web/`
  - 用到的门面:timeline C-8(`listTimelineRoots`、`readTimelineSummary`、`countEventsUnderRoots`、`createTimelineMerger`、`maxTimelineEventId`、`ensureTimelineSchema`、`TURNS_DIRNAME`)、task C-10 `mergeTaskTables` 与既有 `ensureTaskSchema`、`TASK_SOURCE_CONFIG_FILENAME`、sync C-11 `mergeSyncTables` 与既有 `ensureSyncSchema`、replica 既有 `listReplicas`
  - `constants.ts` 记 `MERGE_LOCK_FILENAME = 'merge.lock'`、`MERGE_LOCK_STALE_MS = 2 * 3600_000`、`MERGE_LOCK_WAIT_MS = 120_000`,以及 `DB_PROFILES_FILENAME = 'db-profiles.json'`、`DB_QUERY_LOG_FILENAME = 'db-query.log'`(注释写明与 dbquery 的 `PROFILES_FILENAME`、`LOG_FILENAME` 同值;project 按 D1 不依赖 dbquery,这里另记一份)
  - 错误:`errors.ts` 的 `ProjectError`(带 `code`,直接继承 `Error`),`PROJECT_ERROR_CODES` 与 `exitCodeForError` 按 C-12;`cli.ts` 的 action 里 try/catch 后 `process.exitCode = exitCodeForError(err)`,stderr `[project] <message>`;不在 action 里散写退出码字面量
  - `--json` 只给 `show`、`list`;JSON 结构照 spec「接口契约」表下面那段:`show --json` = `{ project: {dir, display, kind, origin, name}, dataDir, mode, roots: [{path, lastActiveAt, exists}] }`;`list --json` = 数组,每项 `{ project, size, lastActiveAt, roots, backups: {count, size}, identityMissing }`(标识缺失时 `project` 的 `kind`、`origin`、`name` 为 null,`display` 为目录名)
- 允许局部适配:
  - 文件内部拆分;文本输出的列宽、对齐;大小的显示取整
  - 合并编排里各步的私有函数划分(顺序不能变)
- 具体要求:
  1. `show.ts` `showProject(start)`:`loc = locateData(start)`;`loc.root` 为 null 或 `loc.identity` 为 null → `ProjectError('no_project', missingDataMessage(loc))`;`mode`:legacy → `'legacy'`,`dataDir` 非 null → `'project'`,否则 `'none'`;`project.dir` = `loc.projectDirName ?? findProjectDir(identity)?.name ?? null`;`roots` = `listTimelineRoots(start)` 逐个 `{ path: root, lastActiveAt: lastTs, exists: fs.existsSync(root) }`
  2. `name.ts`:
     - `renameProject(start, rawName)`,按顺序:① `validateProjectName` 不过 → `ProjectError('invalid_name', reason)`;② `loc = locateData(start)`,`loc.root` 为 null → `ProjectError('cannot_record', <C-13 project name 行「记不下」的文案>)`;③ `loc.mode === 'legacy'` → `ProjectError('legacy_data', M10)`;④ `info = identityOfRoot(root)`,`'git-error'` → `ProjectError('no_project', missingDataMessage(loc))`;不在 git 里且没装过 → `cannot_record`(文案同 C-1 `writeProjectName` 的报错);⑤ 新标识:工作区根 → `{origin: null, name}`,子目录项目 → `{origin: 原 origin, name}`,不在 git 里 → `{origin: null, name}`;旧标识非 null 且 `sameIdentity` → 返回 `['没有变化']`,不写;⑥ `siblings = listSiblingRoots(root)`;`N = 旧标识有目录 ? countEventsUnderRoots(旧目录, siblings) : 0`;⑦ `writeProjectName(root, name)`;⑧ `newDir = findProjectDir(新标识)`;`rewriteSessionRegistrations(siblings, 新标识, newDir?.name ?? null)`(D19「本机正在跑的会话」= 这些登记,见 index 细节方案核对);⑨ 文案:`newDir` 在 → M7(最近活动的根取 `readTimelineSummary(newDir.dir)?.roots[0]?.root`,没有写 `—`);否则旧标识按 origin 认 → M8(仓库名 = 旧 origin 按 `/` 拆后最后一段);否则 → M6;旧标识为 null 时只给 `之后记到 <新显示名>` 一行
     - `planInstallName(start)`:`root = findProjectRoot(start)`;没有根或 `identityOfRoot` 出错 → `{ needsName: false, defaultName: null, recorded: false }`;`needsName` 照 `info.needsName`;`recorded = info.nameSource === 'recorded'`;`defaultName = recorded ? info.identity.name : defaultProjectName(info)`
     - `applyInstallName(start, name)`:校验同上;只有 `info.nameSource === 'recorded'` 且记下的名字与 `name` 相同时不写;其余(包括用默认名字的,K2 要求装的时候记下名字)一律 `writeProjectName`,写完照 ⑥⑧ 改写会话登记;`notice`:新标识的项目目录在、且这个根(realpath)不在它 `readTimelineSummary` 的根里 → M5(最近活动的根同上),否则 null
  3. `list.ts` `listProjects()`:`listProjectDirs()` 逐个:`size` = 整个目录的字节数(递归 `lstat`,不跟随链接);`summary = readTimelineSummary(dir)`;`lastActiveAt` = roots 里最大的 `lastTs`;`roots` 同 show;`backups` = `backups/` 下一级目录的个数与总字节;`identityMissing = identity === null`;只读,不建库
  4. `remove.ts`:
     - `planRemoval(dirName, { backupsOnly })`:`dirName` 含 `/`、`\`、为 `.`、`..` 或以 `.` 开头 → `ProjectError('unsafe_target', …)`;`target = path.join(projectsRoot(), dirName)`;`lstat` 不在 → `ProjectError('not_found', '没有项目数据目录 <dirName>;用 cgraphx project list 查看')`;是符号链接或不是目录 → `unsafe_target`;`realpath(path.dirname(target)) !== realpath(projectsRoot())` → `unsafe_target`;读 `identity.json`(读不出显示名用目录名)、`readTimelineSummary`(null 按 0)、存在的配置文件(`TASK_SOURCE_CONFIG_FILENAME`、`DB_PROFILES_FILENAME`)、备份个数与大小;`lines` = C-13 的预览
     - `executeRemoval(plan)`:先按 summary 的根算 `stillInstalled`(目录在、`isInitialized` 为真的);`backupsOnly` → `fs.rmSync(path.join(plan.dir, BACKUPS_DIRNAME), { recursive: true, force: true })`,否则删整个 `plan.dir`;文案 M16 / M17 / 只删备份那句;删的时候有 hook 在写照样删(D33)
  5. `merge.ts` `mergeLegacyData(start)`、`hasUnmergedLegacyData(start)`,顺序固定(D26、D27、D30):
     1. `root = findProjectRoot(start)`;没有根或 `!isInitialized(root)` → `{ kind: 'nothing' }`
     2. `info = identityOfRoot(root)`;出错或 identity 为 null:`mergedAt` 有值 → `already`(不建项目库),否则 → `failed`,reason = `missingDataMessage(locateData(root))`
     3. `readLocalProjectJson(root)?.mergedAt` 有值 → 照第 4 步拿到项目目录、照第 5 步的写法确保三套 schema,返回 `{ kind: 'already', mergedAt }`(C-12:删过项目数据的,重装时建回来)
     4. `{ dir, name } = ensureProjectDir(identity)`(唯一建目录入口,C-3)
     5. `!hasLegacyTables(root)` → 打开项目库(`DatabaseConnection.open(path.join(dir, 'cgraphx.db'))`)依次 `ensureTimelineSchema`、`ensureTaskSchema`、`ensureSyncSchema`,关库;`updateLocalProjectJson(root, { mergedAt: 现在, mergedInto: name })`;返回 `nothing`
     6. 拿 `merge.lock`(C-15;每秒重试,最多等 `MERGE_LOCK_WAIT_MS`;等不到 → `failed`,reason `另一个目录正在往这个项目并旧数据,稍后再装一次`);拿到后再读一次 `mergedAt`,有值 → 放锁、返回 `already`
     7. 备份(`merge-files.ts`):打开本地旧库(`getLocalDatabasePath(root)`),`BEGIN IMMEDIATE`;把 `cgraphx.db`、`-wal`、`-shm`、`task-source.json`、`db-profiles.json`、`db-query.log`、`turns/` 中在的复制进 C-15 的备份目录(文件用 `fs.copyFileSync(src, dst, fs.constants.COPYFILE_FICLONE)`,`turns/` 用 `fs.cpSync(…, { recursive: true })`);`COMMIT`;任何一步失败 → `ROLLBACK`、放锁、`failed`(备份失败就不并)
     8. `ensureTimelineSchema(旧库)`(补 agent 列、自动消息改记);打开项目库并应用三套 schema
     9. `merger = createTimelineMerger(旧库, 项目库)`;`N = maxTimelineEventId(旧库)`;`merger.mergeEventsUpTo(N)`
     10. 旧库 `BEGIN IMMEDIATE`:`merger.mergeTail(N, [root, ...listReplicas(root, { includeRemoved: true }).map(e => e.path)])`;`mergeTaskTables(旧库, 项目库, merger.mapping)`;`notices = mergeSyncTables({ oldDb, projectDb, mapping, mergingRoot: root, oldDataDir: getCodeGraphDir(root), projectDataDir: dir, dirName: path.basename(root) }).notices`;文件并(下一条);`updateLocalProjectJson(root, { mergedAt: 现在, mergedInto: name })`;按外键从子表到父表 DROP 旧库里全部 `timeline_%`、`task_%`、`sync_%` 表(`task_superseded_bindings` 先于 `task_sessions`,`task_sessions` 先于 `task_items`);`COMMIT`。任何一步失败:写过记号就 `updateLocalProjectJson(root, { mergedAt: null, mergedInto: null })` 撤掉,`ROLLBACK`,放锁,`failed`(项目库里已写进去的保留,D30)
     11. 文件并(`merge-files.ts`,在第 10 步的旧库事务里做,照 spec D29 表;每一类先看旧目录里有没有,没有就什么都不做、不提示):`db-profiles.json` 旧的在、项目里没有 → 复制过去并 chmod 0600;两份逐字相同 → 不管;不一样 → 留项目里的,`notices` 加 M2 的 db-query 那句;`db-query.log` 旧的在 → 追加到项目里的日志末尾(项目里没有就复制),0600;`turns/` 旧的在 → 下面每个文件,项目的 `turns/` 里没有同名的才复制(项目里没有 `turns/` 先建);`task-source.json` 由 `mergeSyncTables` 处理,这里不碰
     12. `COMMIT` 之后:删掉本地 `.cgraphx/` 里在的 `task-source.json`、`db-profiles.json`、`db-query.log`、`turns/`(备份里有;`db-query.log` 的轮转文件 `db-query.log.1`… 一并删);对旧库试一次 `VACUUM`,失败不管;关两个库;放锁
     13. 返回 `merged`:`events`、`sessions`、`duplicates` 取 `merger.stats()`,`display` = 显示名,`notices`
     - `hasUnmergedLegacyData(start)` = 根装过、没有 `mergedAt`、`hasLegacyTables(root)`
     - `mergeLegacyData` 自己 try/catch 全部异常,一律返回 `failed`(reason 取异常 message),不抛
  6. `cli.ts` `registerProjectCommands(program)`:`program.command('project').description('项目数据 — 查看这个目录属于哪个项目、改项目名称、列出与删除用户目录里的项目数据')`,下挂四个子命令按 C-13;`show`、`name` 的起点 = `resolveProjectRoot(process.cwd())`;`remove` 的确认用 `node:readline` 读一行,`process.stdin.isTTY` 为假且没给 `--yes` → `ProjectError('needs_yes', '没给 --yes,非交互终端里不删;确认要删就加 --yes')`;时间显示用本地时间 `MM-DD HH:mm`;路径里的家目录前缀显示成 `~`
  7. `index.ts`:按 C-12 导出;门面注释写明职责(F2 查和改名、F4 并旧数据、F5 列出和删除)与依赖(基础层 + timeline、task、sync、replica 门面)
- 完成条件:
  - `grep -rn "from '\.\./\(timeline\|task\|sync\|replica\)/" src/core/project` 无输出(只走门面)
  - `grep -rn "from '\.\./\(dbquery\|markdown\|features\)\|from '\.\./\.\./\(cli\|web\)" src/core/project` 无输出
  - `grep -n "export function registerProjectCommands" src/core/project/cli.ts` 有命中
  - `grep -rn "process.exitCode = [0-9]" src/core/project` 无输出
  - 每个文件不超过 600 行
- 提交点:
  1. `feat(project): 新增 project 子系统——show / name / list / remove 四个命令`:`index.ts`、`cli.ts`、`errors.ts`、`types.ts`、`constants.ts`、`show.ts`、`name.ts`、`list.ts`、`remove.ts`
  2. `feat(project): 并旧数据进用户目录——先备份,两段并,写记号后删旧表`:`merge.ts`、`merge-files.ts`
- 风险/注意事项:
  - 第 10 步持旧库写锁:同目录正在写的 hook 最多等这一段(busy_timeout 5 秒);第 9 步已经把绝大多数事件并完,第 10 步只剩尾巴、task、sync 表与几个文件,不要把大块工作挪进第 10 步
  - 记号必须在旧库 `COMMIT` 之前写好:等写锁的 hook 拿到锁后在写事务里看记号(C-7),看到就改写项目库
  - 并到一半杀掉进程再装一次,结果要和一次并完相同(设计验收 2):项目库里已写进去的靠 C-8 的去重与 task、sync 的按键对上;不要在失败时去删项目库里这次写进去的
  - `project remove` 只删 `projects/` 下的一级真实目录;任何链接、`..`、绝对路径都拒绝(设计验收 10)
