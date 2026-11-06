# 实现计划: 项目按名称认

> 产物: plan
> 依据: spec@fb50532

## 设计预览

原来项目按仓库地址认:地址一变、fork 与上游、GitHub 与内网镜像都算不同项目,数据跟着分成几份。这次把认项目的依据换成项目名称:项目标识只剩名字,`install` 时每个项目都问一次名字并记进本地配置(在 git 仓库里是本地 git 配置,不在 git 里是 `.cgraphx/project.json`;没记的依次取仓库名、目录名),项目目录名就是名字;地址只用来取默认名字和判断重名。随之改三处落点:sessions.db 的删项目记录与开始目录归属改用名字,`start_dirs` 不再写地址;重名判断的记录进 sessions.db 新表 `dirs_checked`,项目记下的地址进 `identity.json` 的 `origins`;补录侧开始目录还在就现认、全量重建不重读已记到别的项目的会话文件。重名时在第一条命令末尾(stderr)或 `install` 里提示一句,数据照样记进去。

**难回头的决策落在哪**(决策已在 spec 确认,这里核对落点,其余可略读)

| spec 决策 | 落在 | 怎么守住 |
|---|---|---|
| D1 🔒 项目标识只留 `name` | T-1 `project-identity.ts`、`user-data-dir.ts`,同任务的各调用方 | `ProjectIdentity` 只剩 `name`(C-1),`identity.json` 升版本 2、只按 `name` 比(C-3) |
| D7 🔒 判断过的记录用 sessions.db 新表 `dirs_checked` | T-1 `session-index.ts`,T-2 `duplicate.ts` | 新表不过期;只有走完判断才写(C-5、C-6) |
| D8 🔒 项目记下的地址放 `identity.json` 的 `origins` | T-1 `user-data-dir.ts`,T-2 `duplicate.ts` | 写入只经 `appendProjectOrigin`(C-3),判断只看 `origins`(C-6) |

## 来源 spec 摘要

- spec 路径:`docs/features/2026-11-06-项目按名称认/项目按名称认-spec.md`(指纹 `fb50532`)
- 功能点:F1 只按名称认项目(核心)、F2 install 记下项目名称(支撑)、F3 重名提示(支撑)
- 细节方案:D1–D11;全局约束四条(地址不得参与项目比较、提示不影响命令、sessions.db/identity.json 不走 data-standards、分层不变)
- 功能方案的边界外排除:按名称合并/搬动已记下的数据、同名时阻止记录或要求确认

## 范围

- F1:基础层的认法、所有调用方、补录侧的开始目录归属与重建
- F2:`install` 一律问名字并写回(交互与 `-y`)
- F3:重名判断(K4–K6)、判断记录、提示(命令末尾与 `install`)
- 文档与 skill 资产:知识库 3 篇(`项目`、`并旧数据`、`需求副本`)、`CLAUDE.md`、`cgraphx-guide`、`db-query`、`CHANGELOG.md`、`knowledge-recall` 子 agent

## 明确不包含

- 不做「按名称合并、搬动已记下的数据」:改名后已经记下的数据不挪(spec 边界外排除)
- 不做「同名时阻止记录或要求确认」:重名也记成一个项目,只提示(spec 边界外排除)
- 不写迁移代码(spec「迁移与兼容」):本机旧数据按 index 末尾的手工步骤处理
- 不排测试任务:单元/接口测试是代码完成后的独立流程(unit-spec → unit-code),本 plan 只要求既有测试不被弄红
- 不改 timeline 事件表、schema 版本、事件采集范围;不动已下掉的 web/平台功能;不新增依赖;不碰 `dist/`

## 任务清单

| 任务 | 任务文件 | 对应 spec | 涉及范围(文件) |
|---|---|---|---|
| T-1 | `项目按名称认-01-项目标识换血.md` | D1、D2、D3、D4(键部分)、D6、D7(建表)、D8(存储) | `src/core/project-identity.ts`、`src/core/user-data-dir.ts`、`src/core/session-index.ts`、`src/core/repo-projects.ts`、`src/core/project/{index,types,show,list,cli,name}.ts`、`src/cli/installer/project-steps.ts`、`src/core/timeline/ingest/ingest.ts`(只改归属形状) |
| T-2 | `项目按名称认-02-重名提示.md` | F3、D7、D8、D9、D10 | `src/core/project/duplicate.ts`(新建)、`src/core/project/index.ts`、`src/core/project/name.ts`、`src/cli/installer/project-steps.ts`、`src/cli/index.ts`、`src/core/replica/index.ts`(注释) |
| T-3 | `项目按名称认-03-补录归属与重建.md` | D4、D5 | `src/core/timeline/ingest/ingest.ts`、`src/core/timeline/ingest/rebuild.ts` |
| T-4 | `项目按名称认-04-文档与提示送达.md` | D11 + spec「文档」表 | `docs/knowledge/项目.md`、`docs/knowledge/并旧数据.md`、`docs/knowledge/需求副本.md`(同一说法的直接后果,spec 文档表未列)、`CLAUDE.md`、`assets/claude-template/skills/cgraphx-guide/SKILL.md`、`.../how-to-use.md`、`.../how-to-use.html`、`assets/claude-template/skills/db-query/SKILL.md`、`assets/claude-template/agents/knowledge-recall.md`、`CHANGELOG.md` |

## 执行顺序

1. **T-1**(必须第一个:项目标识的形状被其余任务和全项目类型检查依赖。这 12 个文件被 `tsc` 全项目编译绑在一起,拆开任何一半都编译不过——任务文件里写明了原因)
2. **T-2**(消费 T-1 的 C-1、C-3、C-5;改 project 子系统与两个 CLI 挂点)
3. **T-3**(消费 T-1 的 C-1、C-5;只改 timeline 补录两个文件)
4. **T-4**(等 T-1~T-3 的行为定稿后写文档与 skill 资产,文档必须和最终行为一致)

> T-2 与 T-3 改的文件不重叠,但两者都要跑 `npm run build` / `npm test`,在同一个工作区并行会抢 `dist/` 与构建输出,所以按顺序跑,不并行。

大需求判据:预估变更文件 26 个、跨基础层 / project 子系统 / timeline 补录 / 安装器 / 文档资产五个独立模块,用 `/dev-impl-subagent` 执行。

## 必须严格执行的契约

> 跨任务共享的契约只在这里定义;任务文件按编号引用,不抄原文。

**C-1 项目标识与根标识(`src/core/project-identity.ts`)**

- `export interface ProjectIdentity { name: string }`
- 删除 `IdentityKind`、`identityKind()`、`RootIdentity.needsName`
- `sameIdentity(a, b)` ⇔ `a.name === b.name`;`projectDisplayName(id)` 返回 `id.name`(函数保留,调用方语义不变)
- `export interface RootIdentity { root: string; identity: ProjectIdentity | null; origin: string | null; workTreeRoot: string | null; subdir: string | null; nameSource: 'recorded' | 'repo' | 'default' | null }`
  - `origin` 是规整后的 origin(已应用 `insteadOf`),只给 K2 取默认名字与 C-6 的 K6 用,**不得参与任何「是不是同一个项目」的比较**;`identity` 为 null 时 `origin` 也可能非 null
  - `nameSource` 与 `identity` 同时为 null,或同时非 null
- `identityOfRoot(root)` 返回值带上 `origin`
- `rememberRootIdentity(root, identity, origin: string | null)`:新增第三个参数写进进程内记忆;已记住的根保留原 `origin`(不因后填的标识把它清成 null);`nameSource` 按 `identity !== null ? 'recorded' : null`
- `writeProjectName`、`validateProjectName`、`defaultProjectName`、`normalizeOrigin`、`readGitConfig` 的对外语义不变

**C-2 默认名字的来源顺序(读根标识时,`src/core/project-identity.ts` 内部)**

按以下顺序取第一个成立的,取不到 → `identity: null`:

1. 记下的名字(`recorded`):工作区根读 `cgraphx.projectName`,子目录项目读 `cgraphx.<子目录>.projectName`,不在 git 仓库读本地 `.cgraphx/project.json` 的 `name`;空串 / 全空白按没记
2. 工作区根(`subdir === null`)且有 `origin`(`repo`):取规整后 origin 按 `/` 拆段的最后一段(如 `github.com/smdnkB/cgraphx` → `cgraphx`);过一遍 `validateProjectName`(去空白后非空、无控制字符、≤100 字),不过就往下走。**子目录项目不走这一条**
3. 装过(`isInstalled(root)`,`default`):目录名;子目录项目取子目录最后一段
4. 都没有 → `identity: null`

`origin` 在以上每一步都原样带出(C-1)。`git` 跑不起来 → 返回 `'git-error'`,不写进程内记忆。

**C-3 项目目录的 `identity.json`(版本 2)与读写 API(`src/core/user-data-dir.ts`)**

- `IDENTITY_VERSION = 2`
- `export interface ProjectDirIdentity { name: string; origins: string[] }`
- `export function readIdentityFile(dir: string): ProjectDirIdentity | null`:
  - 版本 2:`name` 必须是 string,去首尾空白后非空(返回去空白后的名字);`origins` 是数组时只取其中的 string 元素,不是数组按 `[]`;返回 `{ name, origins }`
  - 版本 1:`name` 是 string 且去空白后非空 → `{ name: 去空白后的名字, origins: [] }`;`name` 为 null / 不是 string / 去空白后为空(只有 origin)→ `null`
  - 其余(版本不对、JSON 读不出、不是对象)→ `null`
- `writeIdentityFile(dir, id)`(内部)写 `{ version: 2, name, origins: [], createdAt }`:两空格缩进 + 末尾换行,字段顺序 `version`、`name`、`origins`、`createdAt`
- `export function appendProjectOrigin(dir: string, origin: string): boolean`:读原 JSON 对象,`origins` 里没有该值就追加并写回(同目录临时文件 + `rename`),保留 `name`、`createdAt` 和其余不相干的字段;写回的 `version` 一律是 2(版本 1 带 name 的文件顺手升上来),版本 1 的顶层 `origin` 字段丢掉(版本 2 里地址只放在 `origins`);返回是否追加。文件读不出 / 不是对象 → 返回 false 不动它
- `ensureProjectDir` 建新目录时按 C-3 写 `identity.json`

**C-4 项目目录命名与查找(`src/core/user-data-dir.ts`)**

- `projectDirBaseName(id)`:取 `id.name`;不能做文件名的字符(`/ \ : * ? " < > |` 与控制字符)换成 `-`;去掉首尾的 `.` 和空格;超过 120 个字截断(截断后再去一次首尾 `.` 和空格);清空后什么都不剩 → `-`
- `findProjectDir(id)`、`ownedDir` 按 `readIdentityFile(dir)?.name === id.name` 认(不再比 origin)
- `ProjectDirEntry.identity` 类型改为 `ProjectDirIdentity | null`
- `-2`、`-3`…的撞号规则不变:同一个基础名已被别的名字占着(含文件系统不分大小写时 `api` 与 `API` 撞到同一路径)就试下一个

**C-5 sessions.db 合同(`src/core/session-index.ts`)**

- 删除 `identityKey()`(不再有 `{origin,name}` 的 JSON 键)
- `removed_projects`:键改成项目名称;方法签名保持 `recordRemovedProject(id: ProjectIdentity)` / `removedProjectAt(id: ProjectIdentity): string | null`,内部用 `id.name` 作键;列名 `identity_key` 不变
- `start_dirs`:
  - 建表 SQL 保留 `origin TEXT` 列(旧库已有),旁边注释「旧列,不再读写」
  - `StartDirRow` 去掉 `origin`;`getStartDir` 显式 `SELECT cwd, root, name, project_dir, classified_at`
  - `saveStartDir(row: { cwd; root; name; project_dir })` 的 INSERT 不写 `origin` 列
- 新表(幂等):
  ```sql
  CREATE TABLE IF NOT EXISTS dirs_checked (
    root       TEXT PRIMARY KEY,
    checked_at TEXT NOT NULL
  );
  ```
  方法 `dirCheckedAt(root: string): string | null`、`recordDirChecked(root: string): void`(`INSERT OR REPLACE`,时间取 `new Date().toISOString()`)
- 文件头注释「四表」改五表,补 `dirs_checked` 一句话说明

**C-6 重名判断(新文件 `src/core/project/duplicate.ts`,经 `project/index.ts` 导出)**

`export function checkDuplicateName(start: string): string | null`

判定顺序(全部按 `path.resolve` / `realpath` 处理,失败退回 `path.resolve`):

1. `root = findProjectRoot(start)`;没有根 → `null`,不记
2. `loc = locateDataAtRoot(root)`;`loc.mode === 'legacy'`、或 `loc.dataDir === null`、或 `loc.projectDirName === null`、或 `loc.identity === null` → `null`,不记
3. `key = realpath(root)`;打开 sessions.db,`dirCheckedAt(key) !== null` → `null`(打开失败按调用方 try/catch 处理)
4. `info = identityOfRoot(root)`;`'git-error'` → `null`,不记
5. 读项目库根:`roots = readTimelineSummary(loc.dataDir)?.roots ?? []`(读抛出 → `null`,不记)
6. `others` = `roots` 里 `realpath(该项的 root) !== key` 的那些(即去掉这个目录自己;保持原有的「最近活动在前」顺序);`others` 为空 → 不算重名
7. K6 依次(命中即「不算重名」):
   - ① `listSiblingRoots(root)` 里除自己以外的根与 `others` 按 realpath 有交集(worktree)
   - ② `replicaLinkOf(root).state === 'replica'`(登记过的副本)
   - ③ 这个目录有 origin(`info.origin !== null`)且项目 `origins` 为空(`readIdentityFile(loc.dataDir)?.origins ?? []`)
   - ④ 这个目录有 origin 且 origin 在 `origins` 里(两边的值都是规整后的 origin,ssh 与 https 写法已归一)
   - 都不命中 → 算重名,提示里的「在 … 记的」取 `others[0].root`(最近活动的最新一条)
8. 收尾(所有走到这里的分支都做,包括不算重名):`info.origin !== null` 且不在 `origins` 里 → `appendProjectOrigin(loc.dataDir, info.origin)`;`recordDirChecked(key)`。这两步各自 try/catch 吞掉失败(写不上只导致下次再判断一次,不影响提示与命令)
9. `sessions.db` 连接用 `try/finally` 关闭;函数不吞判定异常(由调用方 try/catch),但上面第 8 步的写失败要吞

**C-7 重名提示原文**

函数返回的字符串以 `[cgraphx] ` 开头,内容与顺序照 spec F3 图(换行只是图上的版面,实际一行输出):

```
[cgraphx] <项目名> 已经有数据(在 <最近活动的其他根绝对路径> 记的),这个目录也记进去,数据库连接配置也共用;不是同一个项目的话,运行 cgraphx project name 新名字
```

- `<项目名>` = `loc.identity.name`;`<最近活动的其他根绝对路径>` = `others[0].root` 原值(不缩成 `~`)
- 项目还没有其他根时走不到这里(第 6 步已返回),不会出现「在 — 记的」

**C-8 两个挂点**

- **命令末尾**(`src/cli/index.ts` 的 `postAction`):在 `emitSessionNotices(process.cwd())` 之后,`try { const notice = checkDuplicateName(process.cwd()); if (notice !== null) process.stderr.write(`${notice}\n`); } catch { /* 提示不影响命令 */ }`;沿用同一个 `NON_SESSION_COMMAND_NAMES` 早退(隐藏命令、git 钩子调起的命令、`version` 不判断)
- **install**(`src/cli/installer/project-steps.ts` 的 `recordProjectName`):记下名字之后 `const notice = checkDuplicateName(projectRoot); if (notice !== null) clack.log.info(notice);`;`applyInstallName` 改成返回 `void`,原来的 `installNotice` 删除
- `checkDuplicateName` 自己在判断成功时写 `dirs_checked`;所以 install 内部**判断成功过**时,同一次 `install` 之后的 `postAction` 不会再提示(install 时项目目录还没建、判断没成立的情况,由 `postAction` 补判一次)

**C-9 开始目录归属(`src/core/timeline/ingest/ingest.ts`)**

- `DirClassification` 改成 `{ dirName: string | null; root: string | null; name: string | null }`(去掉 origin)
- `ClassificationContext` 增加 `readonly classified: Map<string, DirClassification>`;`classifyStartDir` 先查这个本趟记忆(键 = 传入的 `cwd` 原值),命中直接返回——这是「同一趟别为每个文件重复扫项目目录」,不是 `start_dirs` 缓存
- 判定顺序:
  1. `cwd` 还在(`fs.statSync(cwd, { throwIfNoEntry: false })` 且 `isDirectory()`,抛错按不在)→ **现认,不读 `start_dirs`**:
     - `root = findProjectRoot(cwd)`;没有根 → 三个字段都 null
     - `identityOfRoot(root)`;`'git-error'` → 三个字段都 null,并且**不写 `start_dirs`**,下次再认
     - 否则 `dirName = identity !== null ? findProjectDir(identity)?.name ?? null : null`,`name = identity?.name ?? null`
  2. `cwd` 不在了 → 读 `start_dirs`:有行且 `project_dir !== null` 直接返回它(`dirName/root/name`);否则用 `ctx.fallbackMatcher().match(cwd, { allowSelf: true })` 兜底(命中 → `dirName = ctx.currentDirName`、`root = hit.root`、`name = null`;不中 → 都 null)
  3. 除 `git-error` 外,把结果写一行 `start_dirs`(`saveStartDir`,`project_dir = dirName`);写失败吞掉(只影响下次还要现认)
- 文件头注释第 4 步改成「开始目录还在就现认;不在了才用 `start_dirs` 缓存,再退到 `timeline_roots` 与副本登记」
- **不改变**「别的项目 / 没认出来的文件不推进偏移」的现有行为

**C-10 全量重建的跳过规则(`src/core/timeline/ingest/rebuild.ts`)**

- 遍历文件时先取一次 `recorded = sessionIndex.getSessionFile(file)`(后文 `knownStartCwd` 复用这次读取,不再取第二遍)
- 若 `recorded !== null && recorded.project_dir !== null && recorded.project_dir !== currentDirName && recorded.byte_offset > 0` → **跳过这个文件**:不从 0 读、不写临时库、不动它的偏移(交给之后的增量),避免改名后新项目把旧历史再解析一遍
- 其余照旧从头读:没记过的文件、`project_dir` 为 null 的、偏移为 0 的、以及 `project_dir` 就是本项目的
- 被跳过的文件不加进 `parsedRows`,所以第 ⑥ 步不会推进它们的偏移
- 文件头注释第 4 步补一句这个跳过规则

**C-11 `cgraphx project` 的输出形态与改名提示**

- `ProjectRef` 改成 `{ dir: string | null; display: string; name: string | null }`(有标识时 `display` 就是名字,标识缺失时是目录名),删除 `kind`、`origin` 两个字段;`ProjectKind` 类型删除
- `project show` 文本第一行:`项目:<display>`,不再带 `(按 origin 认)` 之类的括号标注;`--json` 里没有 `kind`、`origin`
- `project list` 的 `identity.json` 读不出的项:`{ dir: 目录名, display: 目录名, name: null }`,`identityMissing: true` 照旧
- `renameProject` 的提示:删掉 `identityWithName`(只返回 `{ name }`,留着它的 `info` 参数会触发 `noUnusedParameters`),改用字面量 `{ name }`;`renameLines` 里原来按 origin 分支的「别的 clone 照旧记在那里」改成不依赖地址的一句,原文:
  ```
  别的按「${projectDisplayName(prev)}」记的目录照旧记在那里
  ```
  只在旧标识非 null 时出;`repoNameOf`、`identityKind` 相关代码删除
- `InstallNamePlan` 改成 `{ defaultName: string | null; recorded: boolean }`:`defaultName` 为 null 表示不问(没有根 / git 跑不起来);有根且 git 正常时一律有值(记下的名字、C-2 的仓库名或目录名),`recorded` 仍表示「记下的名字」

**C-12 `knowledge-recall` 子 agent 带回提示(`assets/claude-template/agents/knowledge-recall.md`)**

- 在「约束」里给「不要返回命令输出」加例外:以 `[cgraphx]` 或 `cgraphx 提示` 开头的行必须原样放在结论最前面,一条不落(重名提示、skill 版本落后等)
- 只改这一个子 agent 的提示送达规则,不改它的召回流程

## 细节方案核对

> spec 设计决策表逐条落到任务。发现缺口不在这里新定:本表「备注」列只记录 spec 已明确、plan 只是选落点的内容。

| spec 决策 | 落在 | 备注 |
|---|---|---|
| D1 项目标识的形状 | T-1 | C-1、C-3、C-11;`project show --json` 去 `kind`/`origin` |
| D2 名字的来源 | T-1 | C-2;仓库名只对工作区根生效,子目录项目取子目录名 |
| D3 项目目录名 | T-1 | C-4;撞号只在换字符 / 文件系统不分大小写时用到 |
| D4 归属缓存 | T-1(键与列)+ T-3(现认顺序) | C-5、C-9;`start_dirs.origin` 不再读写,`removed_projects` 键改名字 |
| D5 新项目第一次重建不重读别家文件 | T-3 | C-10 |
| D6 install 什么时候问、什么时候写 | T-1(planInstallName / applyInstallName 的写入)+ T-2(重名提示取代 installNotice) | C-8、C-11 |
| D7 判断过的记录 | T-1(建表与方法)+ T-2(写入) | C-5、C-6 |
| D8 项目记下的地址 | T-1(存储与 API)+ T-2(使用) | C-3、C-6 |
| D9 判断流程 | T-2 | C-6、C-7 |
| D10 挂点 | T-2 | C-8 |
| D11 提示送达 | T-4 | C-12 |

spec 全局约束的落点:

- 地址只用于取默认名字和 F3:由 C-1(只暴露 `origin` 给 K2/C-6)、C-2(默认名字)、C-6(K6)守住;`sameIdentity` 只比 name
- 提示和判断不影响命令结果与退出码:由 C-8 的两个 try/catch、C-6 第 8 步吞写失败、C-7 只写 stderr 守住
- `sessions.db`、`identity.json` 不走 `docs/guides/data-standards.md` 的目标项目 Schema 变更约定:C-5 仍用幂等 `CREATE TABLE IF NOT EXISTS`,C-3 用临时文件 + rename
- 分层不变:基础层 `project-identity.ts`、`user-data-dir.ts`、`session-index.ts` 不 import 子系统;F3 放 `src/core/project/duplicate.ts`(C-6)

spec「设计验收」的 10 条由后续 unit-spec → unit-code 覆盖,plan 不排测试任务;本 plan 的统一验证只跑既有测试与手工冒烟。

**拆解中钉死的内部细节**(spec 未明说,不落盘、不是对外接口;钉死是为了 implementer 不各自发挥):

- `RootIdentity.origin`:D9 的 K6 需要「这个目录的地址」,而 D1 只约束 `ProjectIdentity`;因此 origin 留在 `RootIdentity` 上,只读不比较(C-1)
- `planInstallName` 用 `defaultName: null` 表示「不问」,不新增 `ask` 字段(避免等于把 `needsName` 换个名字,违背 D6)
- 重名提示一行输出、路径用绝对路径(C-7):照 spec F3 图的原文,图上的折行是版面
- `project show` 文本去掉「(按 origin 认)」括号:只有一种认法后这个标注没有信息量(C-11)

## 适用规范

| 文件 | 章节 | 用在哪 |
|---|---|---|
| `docs/guides/coding-standards.md` | 「边界与结构」「选型」「错误与日志」 | 全部代码任务:分层、门面、`node:` 前缀、中文注释、单文件 ≤600 行、错误消息带修法 |
| `docs/guides/interface-standards.md` | 「输出」「退出码」 | T-2:提示只写 stderr、带 `[cgraphx] `、`--json` 的 stdout 不混提示 |
| `docs/guides/data-standards.md` | 「DDL 层」「Schema 变更约定」 | T-1:表命名、幂等建表;spec 全局约束明确 `sessions.db` / `identity.json` 不走目标项目 Schema 变更约定 |
| `docs/guides/git-standards.md` | 「提交消息规范」「提交前检查点」 | 已结晶进下节,实施期按此写 message 与自查 |

## 提交规范

> 从 `docs/guides/git-standards.md` 结晶,实施期不再现场读;precommit 门禁只作兜底。

**开工前一笔**:本需求目录(spec、功能方案 v1/v2、plan)还没入库时,先单独提交一笔 `docs: 项目按名称认——spec + plan`;之后按各任务的提交点提交,不把文档混进代码提交。

**消息格式**:`type(scope): 中文描述`

- type 用 `feat` / `refactor` / `fix` / `docs`;scope 用 `project` / `timeline` / `skills` / `installer`(仓库级改动省 scope)
- 非琐碎提交写 body:背景一行(问题 / 动机)+ `-` 列要点;琐碎可只留 subject
- 正例:`refactor(project): 项目按名称认——标识只剩 name、identity.json 升版本 2`

**提交前检查点**(按本 plan 相关项):

- 与 TS 同放的运行时资产要登记 `scripts/copy-assets.cjs`(本 plan 无新运行时资产,`duplicate.ts` 是 TS 源码,随 `tsc` 走)
- `src/core/` 不得出现对 `src/cli/` 的 import
- `schema.sql` / 建表 SQL 必须 `IF NOT EXISTS`
- 不改 `vitest.config.ts` 的 `TZ: 'UTC'`
- 不提交被注释掉的命令注册 / hook 接入项
- 不写死绝对路径、密钥、阈值、版本号;不留 TODO / FIXME
- 提交说明与改动范围一致,不夹带本 plan 之外的改动

## 统一验证

全部任务做完后依次执行,结果写进收尾回报。

**1. 构建与既有测试**

```bash
npm run build   # tsc + copy-assets,必须 0 错误
npm test        # 既有测试全绿;没有为迁就本 plan 改 vitest 的 TZ
```

**2. 旧概念没有漏网**

```bash
grep -rn "needsName\|identityKind\|IdentityKind\|ProjectKind" src   # 期望无输出
grep -rn "installNotice" src                                        # 期望无输出
grep -rn "\.origin" src/core src/cli                                # 期望只出现在 project-identity.ts、repo-projects.ts、project/duplicate.ts
grep -n "origin" src/core/session-index.ts                          # 期望只有 start_dirs 建表那一列的「旧列」注释
```

**3. 命令输出形态(本仓库;数据目录还没迁移,显示「还没有数据」是正常的)**

```bash
node dist/cli/index.js project show
# 期望第一行「项目:cgraphx」,没有括号标注、没有 kind/origin 字样

node dist/cli/index.js project show --json \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);if('kind' in r.project||'origin' in r.project)process.exit(1);console.log(r.project.name)})"
# 期望输出 cgraphx、退出码 0

node dist/cli/index.js project list --json \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s);for(const i of a){if('kind' in i.project||'origin' in i.project)process.exit(1)};console.log(a.length)})"
# 期望退出码 0;旧目录 github.com-smdnkB-cgraphx 一项 json 里 identityMissing 为 true
```

**4. F2 + F3 冒烟(临时 HOME,不碰真实用户目录)**

```bash
(
CGX="$PWD/dist/cli/index.js"; SMOKE=$(mktemp -d); A="$SMOKE/a/api"; B="$SMOKE/b/api"
mkdir -p "$A" "$B"
# 让 HOME / CLAUDE_CONFIG_DIR 都指向临时目录,不读真实会话文件
export HOME="$SMOKE/home" CLAUDE_CONFIG_DIR="$SMOKE/home"
for d in "$A" "$B"; do (cd "$d" && git init -q && git config user.email a@b && git config user.name a); done
(cd "$A" && git remote add origin git@github.com:corp/api.git)
(cd "$B" && git remote add origin git@github.com:other/api.git)

# A 装一遍:-y 不提问,但要把项目名 api 写进本地 git 配置
(cd "$A" && node "$CGX" install -y --target none >/dev/null 2>&1)
test "$(git -C "$A" config --local cgraphx.projectName)" = api && echo NAME-OK
cat "$HOME/.cgraphx/projects/api/identity.json"
# 期望 version 2、name "api"、origins 里没有 B 的地址

# 给 A 的项目造一条根记录(K5 要求项目有别的目录的数据)
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.HOME+'/.cgraphx/projects/api/cgraphx.db');db.exec(\"INSERT OR REPLACE INTO timeline_roots(root,first_ts,last_ts) VALUES('$A','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')\");db.close()"

# B 的第一条命令:应提示一次,提示里有 A 的路径
(cd "$B" && node "$CGX" project show >/dev/null 2>"$SMOKE/err1")
grep -Fq "[cgraphx] api 已经有数据(在 $A 记的)" "$SMOKE/err1" && echo NOTICE-OK

# B 的第二条命令:不再提示
(cd "$B" && node "$CGX" project show >/dev/null 2>"$SMOKE/err2")
test ! -s "$SMOKE/err2" && echo ONCE-OK

# B 的地址记进了项目 origins
node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.env.HOME+'/.cgraphx/projects/api/identity.json','utf8'));console.log(j.origins.join(','))"
# 期望包含 github.com/corp/api 与 github.com/other/api

# 项目目录名就是名字,没有第二个目录
ls "$HOME/.cgraphx/projects"   # 期望只有 api
)
```

**5. 文档合法**

```bash
node dist/cli/index.js docs validate docs/knowledge/项目.md      # 期望合法
node dist/cli/index.js docs validate docs/knowledge/并旧数据.md  # 期望合法
node dist/cli/index.js docs validate docs/knowledge/需求副本.md # 期望合法
grep -rn "按规整后的 origin\|按 origin 认" docs/knowledge CLAUDE.md  # 期望无输出
```

## 允许局部适配的范围

**允许**:

- 内部辅助函数的拆分、命名、存放模块(除契约钉死的对外导出:类型名、字段名、函数名、方法名)
- 局部变量名、循环写法、错误处理的组织方式
- 注释措辞(内容必须与行为一致)
- 报错 / 提示文案里契约没钉死的部分(C-7 的原文除外)

**不允许**(必须按契约):

- 类型 / 字段 / 函数 / 方法 / 表名 / 列名 / 导出面
- 判定顺序(C-2、C-6、C-9、C-10)、提示原文(C-7)、输出字段(C-11)
- 分层与文件落点(`src/core` 不 import `src/cli`;F3 在 project 子系统)

## Plan 冲突上报规则

- 执行中发现 spec 与本 plan 冲突 → **按 spec 做**,并在回报里写一行 `PLAN_CONFLICT: <spec 条款> vs <plan/C 编号>`,不自行改契约
- 发现 plan 内部或跨任务不一致(类型、命名、顺序)→ 停下报 `PLAN_CONFLICT: <C 编号> vs <任务编号>`,不选一个继续
- 与契约无关的实现细节 → 按「允许局部适配」自己定,不报
- 发现 spec 缺一个影响正确性的决策 → 不自行拍板,报 `PLAN_CONFLICT: spec 缺 <决策>`,等回 dev-spec

## 关键风险与防跑偏约束

1. **类型换血必须一次落完**:T-1 的 12 个文件被 `tsc` 全项目编译绑在一起,拆成两个任务中间必然编译不过;T-1 结束必须 `npm run build` 通过。T-1 不要顺手做 T-2/T-3 的行为改动(重名提示、现认、重建跳过),否则会和后两个任务的契约、提交撞车。
2. **地址绝不能重新参与项目比较**:`sameIdentity` 只比 name;唯一按 origin 比较的地方是 C-6 的 K6,而且只跟本项目 `identity.json` 里的 `origins` 比。CR 时按验收第 10 条的 grep 检查。
3. **提示不得影响命令**:两个挂点都 try/catch;`--json` 的 stdout 不混提示;`dirs_checked` / `origins` 写失败只导致重复提示一次。
4. **重名判断必须在补录之后**:`postAction` 在 action 之后,不能用 `timeline_roots` 判断「这个目录判断过没有」(`timeline/cli.ts` 的 action 会先补录,新目录已经写进根,提示会永远不出);判过没判过只认 `dirs_checked`。
5. **重建跳过只针对「已记到别的项目且偏移 > 0」**:偏移 0 / 从没记过的照旧从头读,否则新项目第一次的历史补录会漏。
6. **不迁移本机旧目录**:`~/.cgraphx/projects/github.com-smdnkB-cgraphx` 不自动改名,按末尾手工步骤做;所有冒烟 / 测试用临时 HOME。
7. **不改 `dist/`、不新增依赖、不改 `vitest.config.ts` 的 TZ**;`sessions.db` 的建表仍是幂等 `IF NOT EXISTS`(开发版库直接升)。

## 待确认项

无。spec 的待确认项为空;拆解中冒出的内部细节已按上表钉死,不需要回 dev-spec 补决策。

## 本机迁移(合入并装上新版后手工做,不进代码)

spec「迁移与兼容」:不写迁移代码(版本 1 的按地址目录只有本机一份)。顺序:

1. 确认旧目录:`ls ~/.cgraphx/projects`,应为 `github.com-smdnkB-cgraphx`
2. `mv ~/.cgraphx/projects/github.com-smdnkB-cgraphx ~/.cgraphx/projects/cgraphx`
3. 把 `~/.cgraphx/projects/cgraphx/identity.json` 改成(保留原 `createdAt`):
   ```json
   {
     "version": 2,
     "name": "cgraphx",
     "origins": ["github.com/smdnkB/cgraphx"],
     "createdAt": "<原 createdAt,如 2026-11-05T17:31:50.693Z>"
   }
   ```
4. 在主目录 `/Users/smdnk/objects/ai/cgraphx` 跑 `git config --local cgraphx.projectName cgraphx`
5. 装上新版后在主目录跑 `cgraphx timeline recent` 与 `cgraphx project show`,确认数据还在、项目显示为 `cgraphx`、数据目录是 `~/.cgraphx/projects/cgraphx`

## 启动语

```
/dev-impl-subagent docs/features/2026-11-06-项目按名称认/plan/项目按名称认-index.md
```
