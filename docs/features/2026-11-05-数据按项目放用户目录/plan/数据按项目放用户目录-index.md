# 实现计划: 数据按项目放用户目录

> 产物: plan
> 依据: spec@4d4bf55

## 设计预览

原来 timeline、task、sync 的数据记在每个目录自己的 `.cgraphx/cgraphx.db` 里,只有 /dev-start 开的副本经 `.cgraphx/shared` 链接记回主目录;每条事件按它当时的 cwd 找库,换个 clone、worktree 干活,或者会话在附加目录里改文件,数据就分了家。这次基础层新增项目定位:会话按开始的目录、提交按工作区根认出项目根,再按规整后的 origin 或项目名称认出项目,数据落到 `~/.cgraphx/projects/<目录名>/`;会话开始时认一次写进 `~/.cgraphx/sessions/`,之后的 hook 只读登记、不跑 git。timeline 新增 `timeline_roots` 表记下项目在本机出现过的根,task、sync、统计按它换算路径;一个仓库装了几个项目时,一次提交按改到的文件分给各项目;sync 改按接入时存下的 origin 上报。新增 `project` 子系统:`cgraphx project show / name / list / remove`,以及 install 时先备份、再把本地旧库分两段并进用户目录(去重、换算进度)。uninstall 只卸这个目录,项目数据留着,同一仓库还有装着的目录时 git 钩子不删。知识库索引、「我的需求」、副本登记和 shared 链接照旧留在本地 `.cgraphx/`;升级后还没在这里跑过 install 的目录,照旧记在本地旧库。

**难回头的决策落在哪**(决策已在 spec 确认,这里核对落点,其余可略读)

| spec 决策 | 落在 | 怎么守住 |
|---|---|---|
| D1 🔒 认项目、布局、会话登记、数据位置放基础层不建表;新增 `project` 子系统;replica 依赖不变 | T-1 `src/core/project-identity.ts` 等 6 个基础层文件;T-9 `src/core/project/`;T-4 `replica/roots.ts` 收外部传入的根 | 基础层契约 C-1~C-6 不 import 任何子系统;project 只 import 各门面(C-12);统一验证 3 查 import |
| D3 🔒 名字存本地 git 配置(`cgraphx.projectName`、`[cgraphx "<子目录>"] projectName`),不在 git 里存 `.cgraphx/project.json` | T-1 `project-identity.ts` 的 `writeProjectName`、`identityOfRoot`;T-9 `name.ts`;T-10 install 问名字 | 读写只经 C-1;格式按 C-15;uninstall 不删名字;统一验证 4 场景 E |
| D10 🔒 `timeline_roots` 表,只加表、不升 timeline 版本号 | T-2 `timeline/schema.sql`、`recorder.ts`(同一事务 upsert);T-3 `timeline/roots.ts`(读) | DDL 照 C-15 原文;`TIMELINE_SCHEMA_VERSION` 不动;读的一方容忍表不在 |
| D13 🔒 上报地址 = `sync connect` 时的 origin 原样,存进 `sync_state.connection.remoteUrl` | T-7 `sync/connection.ts`、`runner.ts`、`store.ts`、`types.ts`;T-8 `sync/payload.ts` | 上报、探测、类型表、两种会话 id 只用 C-11 的 remoteUrl;`src/core/sync/` 里 `getOriginUrl` 只剩 connect 与补存两处(统一验证 3) |
| D17 🔒 新命令组 `cgraphx project show / name / list / remove` | T-9 `project/cli.ts`;T-10 `src/cli/index.ts` 注册 | 参数、输出、退出码按 C-13 |
| D20 🔒 用户目录布局;`~/.cgraphx/` 根下不放 `cgraphx.db` | T-1 `user-data-dir.ts` | 路径只经 C-3 取;统一验证 4 每个场景后查 `$HOME/.cgraphx/cgraphx.db` 不在 |
| D21 🔒 项目目录名按标识取,撞名加 `-2`,先写 identity.json 再改名到位 | T-1 `user-data-dir.ts` 的 `ensureProjectDir` | 唯一的建目录入口(C-3);读的一方只用 `findProjectDir`;统一验证 4 场景 D |
| D22 🔒 本地 `.cgraphx/` 只留知识库、我的需求、副本登记、shared 链接,新增 `project.json` | T-1 `data-location.ts`;T-4 `replica/registry.ts` 改读本地;T-9 并完只留 `markdown_*` | `project.json` 读写只经 C-5;副本登记目录用 `getCodeGraphDir`(C-9) |
| D23 🔒 `projects/` 和项目目录 0700,配置与日志 0600 | T-1 `ensureProjectDir`;T-9 并过来的文件 chmod;T-5、T-6 写配置 | 权限照 C-3、C-12;统一验证 4 场景 A |
| D31 🔒 卸载只卸这个目录;同钩子目录还有装着的就留 git 钩子;`--purge` 不再删数据 | T-3 `timeline/installer.ts`、`cli.ts`;T-10 `installer/index.ts`、`agent-steps.ts` | 「还有别的装着的」只经 C-2 `listOtherInstalledDirs`;提示 M11~M14;统一验证 4 场景 C |

## 来源 spec

`docs/features/2026-11-05-数据按项目放用户目录/数据按项目放用户目录-spec.md`(spec@4d4bf55):同一项目在本机各个目录(clone、worktree、副本、手动复制)干活,会话和提交都记进 `~/.cgraphx/projects/<项目>/` 下同一份数据;install 时把目录原来的旧库并过去;可以查、改项目名称,列出、删除项目数据;卸载只卸这个目录。spec 在写 plan 时补了一条你定的:还有没并过的旧数据的目录里不许改名(D19、接口契约表)。

## 范围

覆盖 F1~F5;spec 决策 D1~D33 全部落进任务(见「细节方案核对」);设计验收 12 项中能在命令行验到的,落进「统一验证」。

## 明确不包含

- 功能方案的不做项:跨机器合并数据、平台按规整后的地址认项目、拆掉版本流程、Claude Code 自己按路径存的会话和记忆
- 改名后改回按 origin 认的命令(spec 待确认项:本期不给,删掉本地 git 配置里的名字即可)
- 新写测试:设计验收 12 项的单元测试由全部任务完成后的 `/unit-spec` → `/unit-code` 补;本 plan 只要求既有测试不被弄红,并给全部测试套上临时 HOME(T-1)
- 本仓库根目录 `.claude/`(部署出来的运行环境)不手改
- `docs/knowledge/` 知识条目(交付后按收尾提示走 `/knowledge-write`)
- 版本号与发版(发版时另走 `npm version`)
- 这台机器上真实数据的迁移:统一验证全部在临时 HOME 下跑;要迁本机各项目的数据,交付后由人在各目录跑 `cgraphx install`

## 任务清单

| 任务 | 文件 | 对应 spec | 涉及范围 |
|---|---|---|---|
| T-1 程序:基础层——项目定位与数据位置 | `plan/数据按项目放用户目录-01-程序-基础层.md` | D1~D8、D20~D24;K1、K2、K3、K7、K8 | 新增 `src/core/project-identity.ts`、`src/core/repo-projects.ts`、`src/core/user-data-dir.ts`、`src/core/session-registry.ts`、`src/core/data-location.ts`、`src/core/root-match.ts`;改 `src/core/directory.ts`、`src/core/db/index.ts`、`src/core/db/migrate.ts`;测试基建 `vitest.config.ts`、`__tests__/setup-home.ts`(新);既有测试 `__tests__/core/db/migrate.test.ts` |
| T-2 程序:timeline 写入侧 | `plan/数据按项目放用户目录-02-程序-timeline写入侧.md` | D5~D7、D9、D10;K3、K8、K17、K18 | `src/core/timeline/schema.sql`、`schema-bootstrap.ts`、`recorder.ts`、`hook-runner.ts`、`hooks.ts`、`git-commit.ts`(新)、`turn-state.ts`、`constants.ts`;既有测试 `__tests__/core/timeline/` 下 turn-id、stop-event、duration、auto-message、git-commit-numstat |
| T-3 程序:timeline 读取、并旧事件与卸载 | `plan/数据按项目放用户目录-03-程序-timeline读取与并旧事件.md` | D10~D12、D15、D16、D19(计数)、D28、D31(timeline 部分)、D32、D33(计数) | `src/core/timeline/store.ts`、`stats.ts`(新)、`roots.ts`(新)、`merge.ts`(新)、`indexer.ts`、`index.ts`、`types.ts`、`installer.ts`、`cli.ts`;既有测试 `__tests__/core/timeline/` 下 store、store.timezone、installer、cli-format |
| T-4 程序:replica 与 features | `plan/数据按项目放用户目录-04-程序-replica与features.md` | D8、D11、D22;全局约束(版本流程不变) | `src/core/replica/main-dir.ts`(新)、`roots.ts`、`registry.ts`、`create.ts`、`remove.ts`、`index.ts`、`types.ts`;`src/core/features/index.ts`;既有测试 `__tests__/core/features/scanner.test.ts` |
| T-5 程序:db-query | `plan/数据按项目放用户目录-05-程序-db-query.md` | D8、D23;F3 迁移与兼容 | `src/core/dbquery/config.ts`、`init.ts`、`logging.ts`、`cli.ts`;既有测试 `__tests__/core/dbquery/` 下 config、init、logging、cli |
| T-6 程序:task | `plan/数据按项目放用户目录-06-程序-task.md` | D11、D14、D15、D28、D29(task 表);K12 | `src/core/task/schema-bootstrap.ts`、`source.ts`、`binding.ts`、`cli.ts`、`hooks.ts`、`auto-binding.ts`、`artifacts.ts`、`feature-task.ts`、`feature-link.ts`、`report.ts`、`resolve.ts`、`index.ts`、`roots.ts`(新)、`merge.ts`(新) |
| T-7 程序:sync 运行侧 | `plan/数据按项目放用户目录-07-程序-sync运行侧.md` | D13、D14、D29(sync 表、平台连接);K5、K12;全局约束 3(读不建) | `src/core/sync/schema-bootstrap.ts`、`lock.ts`、`hooks.ts`、`runner.ts`、`connection.ts`、`cli.ts`、`status.ts`、`platform-spec.ts`、`types.ts`、`store.ts`、`index.ts`、`merge.ts`(新);既有测试 `__tests__/core/sync/protocol-version.test.ts` |
| T-8 程序:sync 上报内容 | `plan/数据按项目放用户目录-08-程序-sync上报内容.md` | D11、D13(会话 id);K4 | `src/core/sync/payload.ts`、`artifacts.ts`、`paths.ts`、`references.ts`、`git.ts` |
| T-9 程序:project 子系统 | `plan/数据按项目放用户目录-09-程序-project子系统.md` | D1、D17~D19、D25~D30、D32、D33;F2、F4、F5 | `src/core/project/` 下新文件 `index.ts`、`cli.ts`、`errors.ts`、`types.ts`、`constants.ts`、`show.ts`、`name.ts`、`list.ts`、`remove.ts`、`merge.ts`、`merge-files.ts` |
| T-10 程序:CLI 入口、安装器与 web | `plan/数据按项目放用户目录-10-程序-CLI入口安装器与web.md` | D8(删提示)、D16、D17(注册)、D25、D31;K2 | `src/cli/index.ts`、`src/cli/installer/index.ts`、`src/cli/installer/agent-steps.ts`、`src/web/bootstrap.ts`、`src/web/pages-timeline.ts`、`src/web/pages-tasks.ts`;既有测试 `__tests__/cli/installer/` 下的,`__tests__/web/server.test.ts`、`knowledge-overview.test.ts`、`knowledge-detail.test.ts` |
| T-11 文档:skill 模板与流程图 | `plan/数据按项目放用户目录-11-文档-skill与说明.md` | 全局约束末条 | `assets/claude-template/skills/` 下 `db-query/SKILL.md`、`db-query/agent-prompt.md`、`doc-report/SKILL.md`、`dev-start/SKILL.md`、`dev-merge/SKILL.md`、`release-review/SKILL.md`、`init-ddl/SKILL.md`、`cgraphx-guide/SKILL.md`、`cgraphx-guide/how-to-use.md`、`cgraphx-guide/how-to-use.html`、`cgraphx-guide/skills.html`;`assets/claude-template/FLOW-MAP.md` |
| T-12 文档:本仓库说明与规范 | `plan/数据按项目放用户目录-12-文档-本仓库说明与规范.md` | 全局约束末条 | 本仓库 `CLAUDE.md`、`CHANGELOG.md`、`docs/guides/data-standards.md`、`docs/guides/interface-standards.md` |

既有测试:各任务只修自己涉及范围里的代码弄红的既有测试,上表「既有测试」列的文件算进该任务的涉及范围;一个测试同时被两个任务的改动弄红时,由后一步的任务修。

## 执行顺序

- **第 0 步(主会话,开工前)**:
  1. 分支:当前在副本 `cgraphx@数据按项目放用户目录` 的 `feat/数据按项目放用户目录` 上(从 2d921b4 拉出),直接在这条分支上做。`git status --short` 应只列本需求目录。
  2. 提交本需求的文档:`docs: 数据按项目放用户目录——spec + plan`(`docs/features/2026-11-05-数据按项目放用户目录/` 下全部文件)。
  3. 构建一份旧版,供统一验证 4 模拟「升级前的旧库」:

  ```bash
  B=.cgraphx/baseline/数据按项目
  mkdir -p "$B/old"
  git rev-parse HEAD > "$B/base-commit"
  git archive HEAD | tar -x -C "$B/old"
  ln -s "$PWD/node_modules" "$B/old/node_modules"
  (cd "$B/old" && npm run build > /dev/null)
  node "$B/old/dist/cli/index.js" --version    # 期望 2.0.13
  ```

- **第 1 步**:T-1、T-11、T-12 **同时跑**——改的文件不重叠;T-11、T-12 只写文档,用到的命令、路径、文案都在下方契约里定死,不等程序。
- **第 2 步**:T-2、T-3、T-4、T-5 **同时跑**——都只用 T-1 已提交的 C-1~C-6,彼此改的文件不重叠;T-3 用 T-2 同一步实现的 C-7(`openTimelineDbForRead`、`TURNS_DIRNAME`、`timeline_roots` 表),签名和 DDL 在本 index 定死,照着调用、不等 T-2。
- **第 3 步**:T-6、T-7、T-8 **同时跑**——都只用第 2 步已提交的 C-7、C-8、C-9;T-7、T-8 用 T-6 同一步实现的 C-10 `collectProjectRoots`,T-7 用 T-8 同一步实现的 `createSyncContext` 新参数(C-11),签名都在本 index 定死,照着调用、不等对方。
- **第 4 步**:T-9、T-10 **同时跑**——T-9 只用已提交的各门面;T-10 用 T-9 同一步实现的 C-12、C-13,签名在本 index 定死,照着调用、不等 T-9。
- **第 5 步(主会话)**:每一步收齐回报就按各任务的提交点提交(子 agent 只改文件,不构建、不测试、不提交;中间的提交不保证能构建);全部提交后跑「统一验证」。有不通过的项 → 修好后单独提交 `fix(<scope>): …`,再从头跑一遍统一验证。

## 必须严格执行的契约

基础层没有门面:调用方按下面写明的文件 import(`from '../project-identity'` 这类);基础层文件之间可以互相 import,但不得 import 任何子系统(timeline、task、sync、replica、project、markdown、dbquery、features、agents 等)、`src/cli/`、`src/web/`。

- **C-1 项目根与项目标识**(T-1 实现 `src/core/project-identity.ts`;其余任务只用不改)

  ```ts
  /** spec D3:按 origin 认 → name 为 null;按名字认 → origin 为 null;子目录项目两项都有(没有 origin 时只有 name)。两项都相同才算同一个标识。 */
  export interface ProjectIdentity { origin: string | null; name: string | null }
  export type IdentityKind = 'origin' | 'name' | 'origin+name';
  export interface RootIdentity {
    root: string;
    /** null = 没有标识(D3 表最后一行:没有 origin、没记名字、也没装过) */
    identity: ProjectIdentity | null;
    /** 根所在的 git 工作区根(从根往上第一个有 .git 的目录,目录或文件都算);不在 git 里为 null */
    workTreeRoot: string | null;
    /** 根相对工作区根的 POSIX 路径;根就是工作区根、或不在 git 里为 null */
    subdir: string | null;
    /** 这个根按名字认:没有 origin 的工作区根、子目录项目、不在 git 里的目录 */
    needsName: boolean;
    /** 名字从哪来:'recorded' 记下的;'default' 按默认名字认、没写回;不按名字认为 null */
    nameSource: 'recorded' | 'default' | null;
  }
  export function normalizeOrigin(raw: string): string;                       // D4
  export function identityOfRoot(root: string): RootIdentity | 'git-error';   // D5
  export function rememberRootIdentity(root: string, identity: ProjectIdentity | null): void;  // D8
  export function identityKind(id: ProjectIdentity): IdentityKind;
  export function projectDisplayName(id: ProjectIdentity): string;            // D18
  export function sameIdentity(a: ProjectIdentity, b: ProjectIdentity): boolean;
  export function defaultProjectName(info: RootIdentity): string;             // 目录名;子目录项目取子目录最后一段
  export function validateProjectName(raw: string): { ok: true; name: string } | { ok: false; reason: string };  // D19
  export function writeProjectName(root: string, name: string): void;         // D3、D19
  ```

  - `normalizeOrigin`(D4):scp 写法(`[用户@]主机:路径`,冒号前没有 `/`)和 URL 写法(`ssh://`、`git://`、`http://`、`https://`、`git+ssh://`、`ssh+git://`)拆成主机和路径;去掉用户名、密码、端口;主机转小写;路径去掉开头的 `/`、`~` 和末尾的 `/`、`.git`;结果是 `主机/路径`。其余(本地路径、`file://`)只去末尾的 `/`、`.git` 后原样返回。例:`git@github.com:smdnkB/cgraphx.git`、`https://github.com/smdnkB/cgraphx/`、`ssh://git@github.com:22/smdnkB/cgraphx.git` 都是 `github.com/smdnkB/cgraphx`
  - `identityOfRoot`(D3、D5):根在 git 工作区里时,在根下跑且只跑一次 `git config -z --get-regexp '^(remote\.origin\.url|url\..*\.insteadof|cgraphx\..*)$'`(读各级配置);退出码 1(没有匹配项)按空结果处理,其余非零、git 跑不起来 → 返回 `'git-error'`,不进记忆。origin 先套最长匹配的 `url.<base>.insteadOf` 再 `normalizeOrigin`。名字:根是工作区根取 `cgraphx.projectname`,子目录项目取 `cgraphx.<subdir>.projectname`(git 把节名、键名转小写,子节名原样);不在 git 里不跑 git,取本地 `.cgraphx/project.json` 的 `name`(C-5)。标识按 spec「项目标识」表:工作区根有 origin 没记名字 → `{origin, name: null}`;工作区根记了名字 → `{origin: null, name}`;子目录项目 → `{origin(可为 null), name}`;不在 git 里 → `{origin: null, name}`;该有名字却没记而根装过(`isInitialized`)→ 用 `defaultProjectName`,`nameSource: 'default'`,不写回;没有 origin、没记名字、也没装过 → `identity: null`。同一进程按 `path.resolve(root)` 记住结果(git 出错的不记)
  - `rememberRootIdentity`:把标识填进同一份进程内记忆,之后 `identityOfRoot(root)` 不跑 git(其余字段从文件系统现算)
  - `projectDisplayName`(D18):按 origin → `github.com/smdnkB/cgraphx`;按 origin 加名字 → `github.com/org/platform#server`;按名字 → 名字本身
  - `validateProjectName`(D19):去掉首尾空白;空 → `项目名称不能为空`;含换行或控制字符(`\u0000-\u001f`、`\u007f`)→ `项目名称不能有换行和控制字符`;超过 100 个字(按码点数)→ `项目名称不能超过 100 个字`
  - `writeProjectName`:根在 git 工作区里 → 工作区根写 `git config --local cgraphx.projectName <名字>`,子目录项目写 `git config --local cgraphx.<subdir>.projectName <名字>`;不在 git 里且装过 → 写本地 `.cgraphx/project.json` 的 `name`(C-5 `updateLocalProjectJson`);不在 git 里也没装过 → 抛 `Error('<根> 没装过 cgraphx,也不在 git 仓库里,记不下项目名称;先在这里运行 cgraphx install')`。写完清掉这个根的进程内记忆
- **C-2 仓库里的项目**(T-1 实现 `src/core/repo-projects.ts`)

  ```ts
  export interface RepoProject { root: string; identity: ProjectIdentity; subdir: string | null }
  /** D9:工作区根 T 的项目——T 按 D2 认的根(有标识时)+ 本地 git 配置里记了名字的子目录项目;只跑一次 C-1 的配置读取,读完把各根的标识填进进程内记忆 */
  export function listRepoProjects(workTreeRoot: string): RepoProject[] | 'git-error';
  /** D19:受影响的根——这个根,加上同一仓库各个工作区(git worktree list --porcelain)里同一相对位置的根;不在 git 里只有它自己 */
  export function listSiblingRoots(root: string): string[];
  /** D31:同一仓库各个工作区里,工作区根或配置里记了名字的子目录有 .cgraphx/cgraphx.db 的目录,不含 root 本身;不在 git 里为 [] */
  export function listOtherInstalledDirs(root: string): string[];
  ```

- **C-3 用户目录与项目目录**(T-1 实现 `src/core/user-data-dir.ts`)

  ```ts
  export const IDENTITY_FILENAME = 'identity.json';
  export const BACKUPS_DIRNAME = 'backups';
  export function userDataRoot(): string;   // path.join(os.homedir(), '.cgraphx'),每次现取(测试改 HOME)
  export function projectsRoot(): string;   // <userDataRoot>/projects
  export function sessionsRoot(): string;   // <userDataRoot>/sessions
  export function projectDirBaseName(id: ProjectIdentity): string;    // D21,不含 -2 后缀
  export function readIdentityFile(dir: string): ProjectIdentity | null;  // 读不出、格式不对 → null
  export function findProjectDir(id: ProjectIdentity): { dir: string; name: string } | null;   // 只读,不建
  export function ensureProjectDir(id: ProjectIdentity): { dir: string; name: string };        // 唯一的建目录入口
  export interface ProjectDirEntry { name: string; dir: string; identity: ProjectIdentity | null }
  export function listProjectDirs(): ProjectDirEntry[];   // projects/ 下每个一级目录,不含 . 开头的;按名字排序
  ```

  - `projectDirBaseName`(D21):按 origin(含 origin 加名字)→ 规整后的 origin 按 `/` 拆段、去掉空段、用 `-` 连,有名字再接 `-名字`;按名字 → 名字。`/ \ : * ? " < > |` 和控制字符换成 `-`,去掉首尾的 `.` 和空格,超过 120 个字(按码点)截断
  - `findProjectDir`:在 `projects/` 下找名字是 `<基础名>` 或 `<基础名>-<n>`(n ≥ 2)的目录,`readIdentityFile` 与 id `sameIdentity` 的那个;不跳过中间缺号(删掉 `<基础名>` 以后 `<基础名>-2` 照样找得到)
  - `ensureProjectDir`:先 `findProjectDir`,有就返回;没有就建:`projects/` 不在先建(0700,`~/.cgraphx/` 不在一并建,权限照默认);顺手删掉 `projects/` 下 mtime 超过 1 小时、`.` 开头的临时目录;在 `projects/` 下建 `.` 开头的临时目录(0700),写好 `identity.json`(C-15),再改名到第一个空着的 `<基础名>`、`<基础名>-2`、`<基础名>-3`…;改名时目标已在 → 重新 `findProjectDir`,还没有就试下一个名字。Windows 上不设权限。返回目录绝对路径和目录名
  - 只有 C-5 的 `ensureDataDir`、T-9 的并旧数据(C-12)调 `ensureProjectDir`;其余任何地方不建 `projects/` 下的目录,读、写轮次记录、锁、触发文件、日志的,目录不在就不写(全局约束 3)
  - `~/.cgraphx/` 根下任何代码都不写 `cgraphx.db`
- **C-4 会话登记**(T-1 实现 `src/core/session-registry.ts`)

  ```ts
  export interface SessionRegistration {
    sessionId: string | null;   // null:payload 没给会话 id,这份登记不落盘
    root: string | null;        // D2 的根;没有根为 null
    origin: string | null;
    name: string | null;
    project: string | null;     // 已建的项目目录名;没有标识、还没建为 null(只作加速,读的一方以标识为准)
    writtenAt: string;
  }
  export function safeSessionName(sessionId: string | null): string;   // 规则同现在 turn-state 的 safeSessionName
  export function readSessionRegistration(sessionId: string): SessionRegistration | null;
  /** D6:读得到就原样返回(resume、compact 不重写);读不到以 start 为起点认根(C-5 findProjectRoot)和标识(C-1)、写登记再返回;git 出错不写、返回 null;sessionId 为 null 时不读不写,现认后返回。读到或认好后调 rememberRootIdentity */
  export function sessionRootOf(sessionId: string | null, start: string): SessionRegistration | null;
  /** D19:root 落在 roots 里的登记,改写 origin、name、project,返回改写了几份 */
  export function rewriteSessionRegistrations(roots: readonly string[], identity: ProjectIdentity, project: string | null): number;
  /** D6:删 sessions/ 下 mtime 超过 7 天的登记 */
  export function cleanupSessionRegistrations(): void;
  ```

  - 文件 `~/.cgraphx/sessions/<safeSessionName>.json`,格式照 C-15;同目录临时文件 + rename;`sessions/` 不在时建出来
  - 起点由调用方定:会话开始 hook 用 payload.cwd;其余 hook 用 agent 描述的 `projectDirEnv` 环境变量,没有再用 payload.cwd
- **C-5 数据位置**(T-1 实现 `src/core/data-location.ts`,并改 `src/core/db/index.ts`)

  ```ts
  export type DataUnavailable = 'no-root' | 'no-identity' | 'git-error' | 'not-created';
  export interface DataLocation {
    start: string;
    root: string | null;                 // D2;起点往上没有装过的目录也没有 .git → null
    installed: boolean;                  // 根装过(isInitialized)
    identity: ProjectIdentity | null;
    mode: 'legacy' | 'project';          // 根装过、没并过记号、本地库有 timeline_*/task_*/sync_* 任一张表 → legacy
    dataDir: string | null;              // legacy:本地 .cgraphx/;project:已建的项目目录;没有 → null
    projectDirName: string | null;       // project 模式下已建的项目目录名
    unavailable: DataUnavailable | null; // dataDir 为 null 的原因
  }
  export interface LocalProjectJson { mergedAt: string | null; mergedInto: string | null; name: string | null }
  export function findProjectRoot(start: string): string | null;   // D2
  export function locateData(start: string): DataLocation;         // 只读:不写记号、不建目录;= 按 D2 认根后 locateDataAtRoot
  export function locateDataAtRoot(root: string): DataLocation;    // 已知根:直接把 path.resolve(root) 当根,不再往上找
  export function getDataDir(start: string): string | null;        // = locateData(start).dataDir
  export function ensureDataDir(start: string): string | null;     // 写数据的入口(D7);= 按 D2 认根后 ensureDataDirAtRoot
  export function ensureDataDirAtRoot(root: string): string | null;  // 已知根版
  export function hasLegacyTables(root: string): boolean;
  export function readLocalProjectJson(root: string): LocalProjectJson | null;
  export function updateLocalProjectJson(root: string, patch: Partial<LocalProjectJson>): void;  // 不认识的字段原样保留;临时文件 + rename
  export function missingDataMessage(loc: DataLocation): string;
  // src/core/db/index.ts
  export function getDatabasePath(start: string): string | null;   // getDataDir 有值时 path.join(它, 'cgraphx.db')
  export function getLocalDatabasePath(projectRoot: string): string;  // 不变
  ```

  - 不带 `AtRoot` 的参数都是「起点」:先按 D2 认根(从起点往上第一个 `isInitialized` 的目录;一直没有,再往上第一个有 `.git` 的目录;都没有 → null),D2 认出的根再传进来结果相同,调用方传 `resolveProjectRoot(cwd)`、cwd 或这样的根都行
  - 带 `AtRoot` 的给「已知根」用:git 钩子分到的子目录项目根(C-2,可能没装过,按起点传会被 D2 认成工作区根)、会话登记里的根。timeline 记事件、写轮次记录一律用 `AtRoot` 版
  - `locateData` 的判定(D7):根装过 → 本地 `.cgraphx/project.json` 有 `mergedAt` → project;没有 → `hasLegacyTables(root)` 为真 → legacy,假 → project。根没装过 → project。project 模式下 identity 按 `identityOfRoot`,`'git-error'` → `unavailable: 'git-error'`;identity 为 null → `'no-identity'`;`findProjectDir(identity)` 为 null → `'not-created'`。legacy 模式 dataDir = `getCodeGraphDir(root)`,identity 照样算(给显示用),git 出错时 identity 为 null 但 dataDir 照给
  - `ensureDataDirAtRoot`(D7、全局约束 3):legacy → 本地 `.cgraphx/`;根装过的 project 模式 → 没有 `mergedAt` 先写(`updateLocalProjectJson(root, { mergedAt: 现在, mergedInto: 目录名 })`),项目目录不在就 `ensureProjectDir`;根没装过 → 项目目录已在才返回,不在 → null;没有根、没有标识、git 出错 → null
  - `hasLegacyTables`:只读查本地库 `sqlite_master`(经 `db/sqlite-adapter`,不经 `db/index.ts`,免得循环 import);本地库不在 → false;打开或查询失败 → true(不写记号,宁可留在旧库)。同一进程按根记住结果;`mergedAt` 每次现读
  - `missingDataMessage`:`no-root` → `<start> 不在装过 cgraphx 的目录里,也不在 git 仓库里;到项目目录里运行,或先在项目根运行 cgraphx install`;`no-identity` → `认不出 <root> 是哪个项目(没有 origin,也没装过 cgraphx);在项目根运行 cgraphx install`;`git-error` → `认不出 <root> 是哪个项目:git 跑不起来;装好 git 后重试`;`not-created` → `项目 <显示名> 在本机还没有数据;在装过 cgraphx 的目录里干活后会记起来(没装过就先在项目根运行 cgraphx install)`
  - 走数据位置的(D8):timeline、task、sync 的库和文件(轮次记录、`task-source.json`、锁、存活标记、触发文件),db-query 的项目级 `db-profiles.json` 与 `db-query.log`。固定走本地 `.cgraphx/` 的:知识库(`getLocalDatabasePath`)、1.x 遗留表清理、`my-features.md`、副本登记 `replicas/`、shared 链接、`project.json`
- **C-6 根匹配**(T-1 实现 `src/core/root-match.ts`;T-3 用,T-4 可以用)

  ```ts
  export interface RootMatch { root: string; rel: string }   // rel 为 POSIX 分隔;等于根本身时为 ''
  export interface RootMatcher { match(absPath: string, opts?: { allowSelf?: boolean }): RootMatch | null }
  /** 取包含 absPath 的最长的根:先按原样路径逐级往上查根表,对不上再取 absPath 所在目录的 realpath(带缓存,目录不在取最近一级在的上级)逐级查根的 realpath 表;allowSelf 为假时 absPath 等于根不算 */
  export function createRootMatcher(roots: readonly string[]): RootMatcher;
  ```

- **C-7 timeline 库的打开与记事件**(T-2 实现;T-3、T-9 只用)

  ```ts
  // src/core/timeline/schema-bootstrap.ts
  export function openTimelineDb(start: string): DatabaseConnection;         // 写:C-5 ensureDataDir 定位置、应用 schema;拿不到位置 → 抛 TimelineSchemaError(missingDataMessage)
  export function openTimelineDbForRead(start: string): DatabaseConnection;  // 读:C-5 getDatabasePath,库文件不在 → 抛 TimelineSchemaError(missingDataMessage);不应用 schema、不建目录
  export function ensureTimelineSchema(db: SqliteDatabase): void;           // 不变
  // src/core/timeline/recorder.ts
  export async function recordEvent(root: string, event: TimelineEventInput, enricher?: EventEnricher): Promise<number | null>;  // root 是已知根;null = 按 D7 不记(静默,不写 stderr)
  // src/core/timeline/turn-state.ts
  export const TURNS_DIRNAME = 'turns';
  export { safeSessionName } from '../session-registry';   // 保留这个导出名
  // src/core/timeline/hooks.ts 继续导出 gitCommitHook、readGitCommitInfo(实现挪到 git-commit.ts)
  ```

  - 记事件(D7、D10):`ensureDataDirAtRoot(root)` 为 null → 返回 null;否则打开那个目录下的 `cgraphx.db` 并应用 schema,写事件与 `timeline_roots` upsert 在同一个 `BEGIN IMMEDIATE` 事务里;legacy 模式在写事务里再读一次 `mergedAt`,有了就回滚、关库,改写项目库(再调一次 `ensureDataDirAtRoot`)。legacy 模式下打开、补 schema 或写入出错(并旧数据刚删掉旧表时会碰上 no such table)时,同样再读一次 `mergedAt`:有了 → 关库、改写项目库;没有 → 照常抛出。upsert 的根取 `fs.realpathSync(root)`,失败用 `path.resolve(root)`
  - 轮次记录的目录 = `locateDataAtRoot(root).dataDir` 下的 `TURNS_DIRNAME`
  - `timeline_roots` 的 upsert:`INSERT INTO timeline_roots (root, first_ts, last_ts) VALUES (?, ?, ?) ON CONFLICT(root) DO UPDATE SET first_ts = min(first_ts, excluded.first_ts), last_ts = max(last_ts, excluded.last_ts)`,ts 用事件的 ts
- **C-8 timeline 读取、并旧事件与卸载**(T-3 实现,经 `src/core/timeline/index.ts` 导出;T-6、T-7、T-9、T-10 只用)

  ```ts
  export interface TimelineRoot { root: string; firstTs: string; lastTs: string }
  export function listTimelineRoots(start: string): TimelineRoot[];   // 同步;数据位置那份库的 timeline_roots,按 lastTs 降序;库或表不在 → []
  export async function listSessionEventMaxIdsFor(start: string, sessionIds: readonly string[]): Promise<Array<{ sessionId: string; maxId: number }>>;  // D15:WHERE session_id IN (…)
  export async function listSessionEventsByTs(start: string, sessionId: string): Promise<TimelineEvent[]>;   // D28:ts 升序,同 ts 按 id 升序
  export interface TimelineDataSummary { events: number; sessions: number; roots: TimelineRoot[] }
  export function readTimelineSummary(dataDir: string): TimelineDataSummary | null;   // 按目录只读打开 <dataDir>/cgraphx.db;库不在 → null;sessions 数非空 session_id 的不同值
  export function countEventsUnderRoots(dataDir: string, roots: readonly string[]): number;   // D19:会话按第一条事件(ts 最早)的 cwd、提交按 cwd,落在任一根下(含等于根)的事件数;库不在 → 0
  export function maxTimelineEventId(db: SqliteDatabase): number;   // 空表 0
  export interface EventIdMapping {
    get(oldId: number): number | undefined;             // 旧 id → 新 id(重复的取项目库已有那条的 id)
    mapProgress(sessionId: string, oldId: number): number;  // 旧值在表里取对应新 id;不在取这个会话里不大于它的最大旧 id 对应的新 id;都没有 → 0;这个会话在旧库里没有事件(终端会话、副本会话这类 sync 自己的会话 id)→ get(oldId) ?? 0
    projectMaxIdBefore(sessionId: string): number | null;   // 并之前这个会话在项目库里的最大 id;项目库没有这个会话 → null
  }
  export interface TimelineMergeStats { events: number; sessions: number; duplicates: number }  // events 旧库处理过的事件数(含重复);sessions 旧库非空 session_id 的不同值;duplicates 重复的条数
  export interface TimelineMerger {
    readonly mapping: EventIdMapping;
    mergeEventsUpTo(upToId: number): void;                                   // D27 ①:不加锁,id ≤ upToId 分批写进项目库
    mergeTail(afterId: number, attributionRoots: readonly string[]): void;   // D27 ②:由调用方在旧库写事务里调;并 id > afterId,再并 timeline_roots
    stats(): TimelineMergeStats;
  }
  export function createTimelineMerger(oldDb: SqliteDatabase, projectDb: SqliteDatabase): TimelineMerger;
  export { ensureTimelineSchema } from './schema-bootstrap';
  export { TURNS_DIRNAME } from './turn-state';
  // src/core/timeline/installer.ts(D31)
  export function uninstallTimelineHooks(projectRoot: string, opts?: { agent?: AgentId; keepGitHook?: boolean }): UninstallReport;
  // UninstallReport 去掉 dataDropped,加 gitHookKeptFor: string[](C-2 listOtherInstalledDirs 的结果;删了钩子时为 [])
  ```

  - `listTimelineRoots`、`readTimelineSummary().roots` 都按 `lastTs` 降序(`roots[0]` 就是最近活动的根)
  - 合并器写进项目库 `timeline_roots` 的根取 realpath(目录在时),失败用 `path.resolve`,和 C-7 记事件时的写法一致

  - 既有门面函数签名不变,打开库全部改用 `openTimelineDbForRead`:`queryEvents`、`getEventById`、`getEventStats`、`getMostRecentPre`、`getSessionStats`、`listSessionEventMaxIds`、`listSessionEventsAfter`、`listCommitEvents`
  - 读路径一律不应用 schema、不建目录、不写表;库在但没有 `timeline_events` 表 → 按没有事件返回(空数组、0、零统计、null);`timeline_roots` 表不在 → 按空
  - `createTimelineMerger` 建时先记下项目库里各会话的最大 id(只记旧库里出现的会话);不改旧库;调用方已对旧库跑过 `ensureTimelineSchema`
- **C-9 replica 门面**(T-4 实现;T-6、T-8 只用,一律 `from '../replica'`)

  ```ts
  export interface ProjectRoot { root: string; realRoot: string; replica: ReplicaEntry | null; lastActiveAt: string | null }
  /** D11:baseRoots(timeline 记下的根)+ currentRoot + 这些根上的副本登记(根自己的 .cgraphx/replicas/,根的 .cgraphx/shared 链接指向的目录下的 replicas/;在用、已删都算)。baseRoots / currentRoot 的路径(path.resolve 后)和某个登记的 path 相同时,不出 replica 为 null 的那条,只留登记那条(否则已删副本的路径会命中 null 那条,replicaOfCwd 认不出副本);lastActiveAt 按路径取 baseRoots 的;按 root 长度降序 */
  export function listProjectRoots(baseRoots: readonly { root: string; lastActiveAt: string | null }[], currentRoot: string): ProjectRoot[];
  /** D11:登记了这个需求的在用副本(createdAt 升序)→ currentRoot → 其余目录还在的根(lastActiveAt 降序,null 在后);取第一个有 docs/features/<featureId>/ 的;都没有 → null */
  export function locateFeatureRoot(roots: readonly ProjectRoot[], featureId: string, currentRoot: string): string | null;
  export type ReplicaLinkState = 'own' | 'replica' | 'main-missing';
  export interface ReplicaLink { state: ReplicaLinkState; mainRoot: string }   // own:mainRoot 是根本身
  export function replicaLinkOf(projectRoot: string): ReplicaLink;   // 原来基础层按 shared 链接找主目录的判定挪到这里,只给版本流程与 features 用
  // 签名、语义不变:matchProjectRoot、replicaOfCwd、listReplicas、resolveMainRoot、createReplica、listReplicaStatus、removeReplica、registerReplicaCommands
  ```

- **C-10 task 门面新增**(T-6 实现;T-7、T-8 只用)

  ```ts
  export interface ProjectRootSet { currentRoot: string; roots: ProjectRoot[] }
  /** D11:currentRoot = findProjectRoot(start) ?? path.resolve(start);roots = listProjectRoots(listTimelineRoots(start) 转成 {root, lastActiveAt: lastTs}, currentRoot) */
  export function collectProjectRoots(start: string): ProjectRootSet;
  /** D29 的 task 表部分;由 T-9 在旧库写事务里调用;旧库没有 task 表时什么都不做 */
  export function mergeTaskTables(oldDb: SqliteDatabase, projectDb: SqliteDatabase, mapping: EventIdMapping): void;
  ```

  - 其余 task 门面函数签名不变;语义变化只有一条:传入的项目根当「当前根」用,不再换成主目录
- **C-11 sync 上报地址与并 sync 表**(T-7、T-8)
  - `SyncConnection` 加 `remoteUrl: string | null`(`sync connect` 时 `git remote get-url origin` 的原样结果;旧值没有 → null),`setConnection` 写、`getConnection` 读(T-7)
  - `src/core/sync/payload.ts`(T-8 实现,T-7 的 runner、status 调用):

    ```ts
    export async function createSyncContext(
      start: string,
      opts: { remoteUrl: string; tier?: ServerTier; projectTypes?: readonly string[] | null },
    ): Promise<SyncContext>;   // 不再自己取 origin;remoteUrl 由调用方从连接里取
    ```

  - 上报地址的唯一来源:`sync_state.connection.remoteUrl`;为 null 时由 T-7 取当前根的 `getOriginUrl` 补存进连接,再用它;都没有 → 本轮按「当前仓库没有 origin 远程地址」失败(沿用现在的 SyncError 文案)
  - sync 门面新增(T-7 实现,T-9 调用):

    ```ts
    export interface SyncMergeInput {
      oldDb: SqliteDatabase; projectDb: SqliteDatabase; mapping: EventIdMapping;
      mergingRoot: string;     // 并的那个目录(连接里没有 remoteUrl 时取它的 origin 补上、比较)
      oldDataDir: string;      // 本地 .cgraphx/(旧的 task-source.json 在这里)
      projectDataDir: string;  // 项目目录
      dirName: string;         // 提示里的 <目录名>:并的那个目录的 basename
    }
    export function mergeSyncTables(input: SyncMergeInput): { notices: string[] };   // notices 用 C-14 的 M2
    ```

  - 并 sync 表时「接的是同一个平台」= 两边都有 `connection`,`serverUrl` 相同,且 `remoteUrl` 相同(旧的一边为 null 时拿 `getOriginUrl(mergingRoot)` 比);只换过 token(task-source.json 内容不同)不算换平台。平台连接的 M2 提示按 spec D29 的「一样」口径(task-source.json 逐字相同 + 平台地址、上报地址相同),上报进度并不并按「同一个平台」(spec D29 `sync_sessions` 行)

- **C-12 project 门面**(T-9 实现 `src/core/project/index.ts`;T-10 只用)

  ```ts
  export type ProjectKind = IdentityKind;
  export interface ProjectRef { dir: string | null; display: string; kind: ProjectKind | null; origin: string | null; name: string | null }
  export interface ProjectRootInfo { path: string; lastActiveAt: string | null; exists: boolean }
  export interface ProjectShowReport { project: ProjectRef; dataDir: string | null; mode: 'legacy' | 'project' | 'none'; roots: ProjectRootInfo[] }
  export function showProject(start: string): ProjectShowReport;            // 认不出(没有根、没有标识、git 出错)→ 抛 ProjectError('no_project')
  export interface RenameOutcome { lines: string[] }                        // 给人看的几行(M6~M9)
  export function renameProject(start: string, rawName: string): RenameOutcome;
  export interface ProjectListItem { project: ProjectRef; size: number; lastActiveAt: string | null; roots: ProjectRootInfo[]; backups: { count: number; size: number }; identityMissing: boolean }
  export function listProjects(): ProjectListItem[];
  export interface RemovalPlan { dirName: string; dir: string; display: string; backupsOnly: boolean; events: number; sessions: number; configs: string[]; backups: { count: number; size: number }; lines: string[] }
  export function planRemoval(dirName: string, opts: { backupsOnly: boolean }): RemovalPlan;
  export function executeRemoval(plan: RemovalPlan): { lines: string[] };
  export interface InstallNamePlan { needsName: boolean; defaultName: string | null; recorded: boolean }
  export function planInstallName(start: string): InstallNamePlan;
  export function applyInstallName(start: string, name: string): { notice: string | null };   // notice 为 M5;名字不合法 → ProjectError('invalid_name')
  export interface MergeOutcome {
    kind: 'merged' | 'already' | 'nothing' | 'failed';
    display: string; events: number; sessions: number; duplicates: number;
    notices: string[];          // M2
    mergedAt: string | null;    // already:记号里的时间
    reason: string | null;      // failed:原因
  }
  export function mergeLegacyData(start: string): MergeOutcome;   // 不抛:任何失败返回 failed
  export function hasUnmergedLegacyData(start: string): boolean;  // 根装过、没有 mergedAt、hasLegacyTables
  export { ProjectError, PROJECT_ERROR_CODES, exitCodeForError } from './errors';
  ```

  - `mergeLegacyData` 返回 `already`、`nothing` 时,也确保项目目录在、项目库的 timeline、task、sync 三套 schema 都在(项目数据被 `project remove` 删过的,重装时建回来;web 报 timeline schema 缺失时提示的 `cgraphx install` 因此修得好)
  - `registerProjectCommands(program: Command): void` 在 `src/core/project/cli.ts`,`src/cli/index.ts` 从 `'../core/project/cli'` import(同其他子系统)
  - `PROJECT_ERROR_CODES = ['no_project', 'invalid_name', 'cannot_record', 'legacy_data', 'not_found', 'needs_yes', 'unsafe_target'] as const`;退出码:`no_project`、`cannot_record`、`legacy_data` → 2,其余 → 1
- **C-13 project 命令**(T-9 实现;T-11 照它写文档)

  | 命令 | 输出 | 错误 |
  |---|---|---|
  | `cgraphx project show [--json]` | 文本:`项目:<显示名>(按 origin 认 / 按名字认 / 按 origin 加名字认)`;`数据:<数据目录,家目录写成 ~>`(mode 为 none 时写 `还没有数据`);`这个目录:旧库——<M15>`(mode 为 legacy),其余写 `这个目录:项目库`;`本机出现过的目录:` 下每行 `  <根>  <MM-DD HH:mm> 最后活动`,目录不在的接 `,目录已不在`,一个都没有时写 `  (还没有记录)`。`--json` 照 spec 接口契约 | 认不出项目 → 退出码 2,stderr `[project] <missingDataMessage>` |
  | `cgraphx project name <名称>` | M6~M9 | 名称不合法 → 1(`[project] <reason>`);记不下 → 2(`[project] <起点> 不在装过 cgraphx 的目录里,也不在 git 仓库里,记不下项目名称;到项目目录里运行,或先在项目根运行 cgraphx install`);这个目录还有没并过去的旧数据 → 2(M10) |
  | `cgraphx project list [--json]` | 每个项目一段:`<显示名>  <目录名>  <大小>  最近活动 <MM-DD HH:mm 或 —>  备份 <n> 份 <大小>`,下面每行一个根(目录不在的接 `(目录已不在)`);读不出标识的显示名写 `<目录名>(标识缺失)`;没有项目 → `用户目录里还没有项目数据`。`--json` 照 spec | — |
  | `cgraphx project remove <目录名> [--backups] [--yes]` | 先打预览:`将删除 <显示名>(~/.cgraphx/projects/<目录名>/):<N> 条事件、<M> 个会话、配置(<存在的文件名用、连,没有写 无>)、<B> 份备份`(`--backups` 时 `将删除 <显示名> 的 <B> 份备份`);交互终端问 `确认删除?输入 y 确认:`,输入 y 或 yes(不分大小写)才删;删完 M16 / M17(`--backups` 时 `已删除 <显示名> 的 <B> 份备份`);不确认 → M18,退出码 0 | 目标不是 `projects/` 下的一级真实目录(含 `/`、`..`、链接、不存在)→ 1;非交互终端又没给 `--yes` → 不删,1 |

- **C-14 提示文案**(逐字;`<…>` 是替换处,`\n` 是换行)

  | 编号 | 场合 | 文案 |
  |---|---|---|
  | M1 | install 并成功 | `已把 <N> 条事件、<M> 个会话并进项目 <显示名>`;有重复时另起一行 `其中 <K> 条之前已经并过,只留一份` |
  | M2 | 并时配置和项目里已有的不一样 | `<目录名> 的 db-query 连接配置和项目里已有的不一样,没并,在备份里` / `<目录名> 的平台连接和项目里已有的不一样,没并,在备份里` |
  | M3 | 并失败 | `并到用户目录没成功:<原因>` |
  | M4 | 已经并过 | `已经并过(<mergedAt 的本地时间 YYYY-MM-DD HH:mm>)` |
  | M5 | install 记名字时这个名字已有数据 | `<显示名> 已经有数据(在 <最近活动的根> 记的),这个目录也记进去` |
  | M6 | 改名后是新项目,原来按名字或 origin 加名字认 | `之后记到 <新显示名>\n之前记的 <N> 条还在 <旧显示名> 下` |
  | M7 | 改成的名字本机已有数据 | `<新显示名> 已经有数据(在 <最近活动的根> 记的)\n这个目录之后也记到 <新显示名>` |
  | M8 | 改名后是新项目,原来按 origin 认 | M6 两行 + `\n<旧 origin 最后一段> 的别的 clone 照旧记在那里` |
  | M9 | 改完标识没变 | `没有变化` |
  | M10 | 旧库里改名 | `这个目录还有没并过去的旧数据,先运行 cgraphx install 并过去再改名(install 时也能直接改名字)` |
  | M11 | uninstall 删本地 `.cgraphx/` 前确认 | `删除 <.cgraphx 路径>?(这个目录的知识库索引和「我的需求」;项目的数据留在 ~/.cgraphx/projects/<目录名>/)`;项目目录还没建时括号里只写 `这个目录的知识库索引和「我的需求」` |
  | M12 | uninstall 收尾,git 钩子删了 | `项目 <显示名> 的数据留在 ~/.cgraphx/projects/<目录名>/\n要删数据,用清理命令 cgraphx project remove <目录名>`;项目目录不在时不打 |
  | M13 | uninstall 收尾,git 钩子留着 | `<别的装着的目录,用、连> 还装着,提交照样记`;项目目录在时另起一行 `项目的数据留在 ~/.cgraphx/projects/<目录名>/` |
  | M14 | `timeline uninstall --purge`(打在 stderr,前缀 `[timeline] `;stdout 照旧只有 JSON 报告) | `项目的数据在 ~/.cgraphx/projects/<目录名>/,要删用 cgraphx project remove`;项目目录不在时 `项目的数据要删用 cgraphx project remove` |
  | M15 | `project show` 在旧库 | `这个目录还有没并过去的旧数据,运行 cgraphx install 并过去` |
  | M16 | `project remove` 删完,没有还装着的目录 | `已删除 <显示名> 的数据\n<N> 条事件、<M> 个会话、配置和备份` |
  | M17 | `project remove` 删完,还有装着的目录 | `已删除 <显示名> 的数据\n这 <n> 个目录还装着 cgraphx,之后再干活会重新记` 后每行一个路径 |
  | M18 | `project remove` 不确认 | `没有删除` |
  | M19 | `sync connect` 已接入、这个目录的 origin 和存的不同 | `已接入,按接入时的地址 <remoteUrl> 上报;要换成这个目录的 origin(<当前 origin>),加 --force 重新接入(会清空上报进度、全部重报)` |

- **C-15 文件格式**
  - `~/.cgraphx/projects/<目录名>/identity.json`:`{ "version": 1, "origin": <规整后或 null>, "name": <名字或 null>, "createdAt": <ISO> }`,两空格缩进 + 换行
  - 本地 `.cgraphx/project.json`:`{ "mergedAt": <ISO 或 null>, "mergedInto": <项目目录名或 null>, "name": <名字或 null> }`;`mergedInto` 只作记录,改名后不跟着改;`name` 只给不在 git 仓库里的目录用
  - 会话登记 `~/.cgraphx/sessions/<安全会话名>.json`:字段顺序照 C-4 `SessionRegistration`(`sessionId` 落盘时一定非 null)
  - 本地 git 配置里的名字:`[cgraphx] projectName = <名字>`;子目录项目 `[cgraphx "<子目录相对工作区根的 POSIX 路径>"] projectName = <名字>`
  - `timeline_roots`:照 spec 原文追加到 `src/core/timeline/schema.sql` 末尾(含两行注释):

    ```sql
    -- 项目在本机出现过的根(K4)和各自最近一次活动(K16):hook 每记一条事件 upsert 一次。
    -- 只加表、不升版本号:旧库模式下新版也会给旧库建这张表,退回旧版时旧库仍要能打开。
    CREATE TABLE IF NOT EXISTS timeline_roots (
      root TEXT PRIMARY KEY,   -- 装过的目录或工作区根的绝对路径,不放会话 cd 进去的子目录
      first_ts TEXT NOT NULL,
      last_ts TEXT NOT NULL
    );
    ```

  - 备份目录:`~/.cgraphx/projects/<目录名>/backups/<new Date().toISOString() 里的 : 和 . 换成 ->-<并的那个目录的 basename>/`,里面照原名放 `cgraphx.db`、`cgraphx.db-wal`、`cgraphx.db-shm`、`task-source.json`、`db-profiles.json`、`db-query.log`、`turns/`(在的才放)
  - 并旧数据的锁:`~/.cgraphx/projects/<目录名>/merge.lock`,内容 `{"pid":…,"startedAt":…}`,`wx` 独占创建;pid 不存活或 mtime 超过 2 小时算陈旧,删掉后接管(规则同 `sync.lock`)

## 细节方案核对

| spec 决策 | 落进 | 备注 |
|---|---|---|
| D1 模块边界 | T-1(基础层 6 个文件)、T-9(project 子系统)、T-4(replica 收外部传入的根)、T-6(根汇总) | C-1~C-6、C-9、C-10、C-12。根匹配(C-6)是 D11、D12 共用的纯函数,timeline 不能依赖 replica,所以放基础层;不建表、不改 D1 的依赖方向 |
| D2 项目根 | T-1 `findProjectRoot` | C-5 |
| D3 标识与名字存哪 | T-1 `identityOfRoot`、`writeProjectName`;T-9 改名;T-10 install 问名字 | C-1、C-15 |
| D4 origin 规整 | T-1 `normalizeOrigin` | C-1 |
| D5 什么时候跑 git | T-1 进程内记忆;T-2 会话开始、git 钩子;CLI 第一次用到某个根时(T-1 自动) | C-1、C-4 |
| D6 会话登记 | T-1 `session-registry.ts`;T-2 会话开始写、其余 hook 读;T-6、T-7 的 hook 读 | C-4 |
| D7 每条事件记到哪 | T-1 `locateData`、`ensureDataDir`;T-2 `recordEvent` 写事务里再看记号 | C-5、C-7 |
| D8 数据位置统一入口 | T-1;T-2、T-5、T-6、T-7 换调用;T-4 把副本判断挪进 replica;T-10 删 `warnIfMainRootMissing`;T-12 改本仓库 `docs/guides/` 里讲库位置、轮次文件位置的两句 | C-5、C-9 |
| D9 提交记到哪 | T-1 `listRepoProjects`;T-2 `git-commit.ts` | C-2;子目录项目根按已知根记(C-5 `ensureDataDirAtRoot`),没装过的 worktree 里的子目录项目也记得进(统一验证 4 场景 D) |
| D10 `timeline_roots` | T-2 建表与 upsert;T-3 读 | C-7、C-8、C-15 |
| D11 根汇总与路径换算 | T-4 `listProjectRoots`、`locateFeatureRoot`;T-6 `collectProjectRoots` 与 task 各处;T-8 sync 各处 | C-9、C-10 |
| D12 统计的文件排行 | T-3 `stats.ts` | 用 C-6 |
| D13 上报地址与 worker | T-7(连接、runner、锁在项目目录、status 显示);T-8(两种会话 id) | C-11 |
| D14 按会话办的命令 | T-6 `task use / current / clear`;T-7 `recordReferenceHit` | C-4 |
| D15 Stop hook 只刷本会话 | T-3 `listSessionEventMaxIdsFor`;T-6 `auto-binding.ts` | C-8 |
| D16 web 读哪个库 | T-10 `web/bootstrap.ts`、页面空态;T-3 读路径不写库 | C-7 `openTimelineDbForRead` |
| D17 命令 | T-9;T-10 注册 | C-13 |
| D18 显示名 | T-1 `projectDisplayName` | C-1 |
| D19 改名 | T-9 `name.ts`(含 spec 补的「旧库里不许改名」);T-1 `writeProjectName`、`rewriteSessionRegistrations`;T-3 `countEventsUnderRoots` | M6~M10。「本机正在跑的会话」= `~/.cgraphx/sessions/` 里 root 落在受影响的根上的全部登记(会话结束不删登记、7 天清理,登记里的就是可能还在跑的;会话不记 pid,判不出更多) |
| D20 用户目录布局 | T-1 `user-data-dir.ts` | C-3 |
| D21 项目目录名 | T-1 `projectDirBaseName`、`ensureProjectDir` | C-3;临时目录过期按 1 小时算 |
| D22 本地 `.cgraphx/` | T-1 `project.json`;T-4 副本登记读本地;T-9 并完只留 `markdown_*` | C-5、C-15 |
| D23 权限与敏感信息 | T-1(0700);T-9(并过来的 0600);T-5、T-6(照现在 0600) | C-3 |
| D24 `CGRAPHX_DIR` | T-1:只影响 `getCodeGraphDir`,`userDataRoot` 不看它 | C-3 |
| D25 什么时候并 | T-10 install、uninstall 调 C-12 | C-12 |
| D26 有没有旧数据、只并一次、备份 | T-9 `merge.ts`、`merge-files.ts` | C-15 锁与备份 |
| D27 两段并 | T-9 编排;T-3 `TimelineMerger` 两个方法 | C-8 |
| D28 去重与 id 换算 | T-3 `merge.ts`;T-6、T-7 用 `EventIdMapping` 换算进度;T-6 派生按 ts 读 | C-8 |
| D29 各表各文件怎么并 | T-3 timeline 表;T-6 task 表;T-7 sync 表与平台连接;T-9 `db-profiles.json`、`db-query.log`、`turns/` | C-8、C-10、C-11;每类文件、连接「旧目录本来就没有」时什么都不做、不提示 |
| D30 结果与失败 | T-9 返回 `MergeOutcome`;T-10 打 M1~M4 | C-12、C-14 |
| D31 卸载 | T-3 timeline 卸载规则与 `--purge`;T-10 uninstall 流程、版本分支提交拦截 | C-2、C-8、M11~M14 |
| D32 列出 | T-9 `list.ts`;T-3 `readTimelineSummary` | C-13 |
| D33 删除 | T-9 `remove.ts`;T-3 `readTimelineSummary` | C-13 |

## 适用规范

- `docs/guides/coding-standards.md`:「边界与结构」「选型(偏离社区默认)」「错误与日志」——全部程序任务
- `docs/guides/interface-standards.md`:「命令注册」「输出」「退出码」「Hook 子命令契约(timeline-*-hook ×7)」——T-2、T-3、T-5、T-6、T-7、T-9、T-10
- `docs/guides/data-standards.md`:「模型层」「DDL 层」——T-2、T-3、T-6、T-7、T-9;「Schema 变更约定」那节写明只约束目标项目业务库,本仓库包内表不建需求 `sql/` 增量文件
- 例外(spec 赢):data-standards「表结构变更 = schema.sql 追加 + 加版本号」与 D10「只加表、不升 timeline 版本号」冲突,按 D10;先例是 `timeline_meta`
- `docs/guides/git-standards.md`:结晶进下方「提交规范」
- 本需求改完以后,`data-standards.md` 开头讲库位置的一句、「DDL 层」表命名空间那句,`interface-standards.md`「Hook 子命令契约」里轮次文件的路径会过时,由 T-12 一并改(只改这几句的事实,不动规范条目和节标题)

## 提交规范

- 格式:`type(scope): 中文描述`;type 用 feat / refactor / fix / docs;scope 用子系统名(core、timeline、task、sync、replica、db-query、project、installer、web、skills),仓库级改动省 scope
- 补充说明用「——」,并列用「+」,数值对比用「→」;正例 `feat(timeline): 记事件按会话的根定位置——旧库模式写事务里再看记号`;反例 `update code`、`feat: 修复bug并优化性能`
- 不写票据编号;非琐碎提交写 body:背景一行 + 「-」列要点;最后一行 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 提交前检查点(`git diff --cached` 逐项看,命中先改):
  - 与 TS 同放的运行时资产未登记 `scripts/copy-assets.cjs`(本需求只改已登记的 `timeline/schema.sql`,不新增资产)
  - `src/core` 出现对 `src/cli` / `src/web` 的 import
  - `schema.sql` 丢失 `IF NOT EXISTS`
  - timeline hook 链路出现未 await 的 DB 写入 / 抛错不吞
  - `vitest.config.ts` 的 `TZ: 'UTC'` 钉死被改
  - 被注释掉的命令注册 / hook 接入项
  - 写死的魔法值:绝对路径、密钥、阈值、版本号写进源码
  - 新增 TODO / FIXME

## 统一验证

全部任务提交后,在本仓库根目录按顺序跑。4 以后全部在临时 HOME 下,不在本仓库、不在真实家目录跑 dist 的 install、hook、project 命令(本仓库是副本,在这里跑会把真实数据迁进 `~/.cgraphx/`)。

1. 构建:`npm run build`——无报错
2. 测试:`ls ~/.cgraphx/projects ~/.cgraphx/sessions 2>&1 | head -2`(开工时两者都不在)→ `npm test` 全部通过 → 再跑一次 `ls`,仍然不在(测试没碰真实家目录)
3. 静态检查(每条期望无输出,除非写明):

   ```bash
   BASE="$(cat .cgraphx/baseline/数据按项目/base-commit)"
   grep -rn "resolveDataDir\|warnIfMainRootMissing\|DataDirInfo" src
   grep -rn "main-missing" src --exclude-dir=replica                                          # replica 的 ReplicaLinkState 保留这个值,别处不再出现
   grep -rn "resolveMainRoot" src/core/task src/core/sync
   grep -n "from '\./\(timeline\|task\|sync\|replica\|project\|markdown\|dbquery\|features\|agents\|release\|report\|skill-version\|artifact-registry\)" src/core/project-identity.ts src/core/repo-projects.ts src/core/user-data-dir.ts src/core/session-registry.ts src/core/data-location.ts src/core/root-match.ts
   grep -rn "from '\.\./\(timeline\|task\|sync\|replica\)/" src/core/project
   grep -rn "from '\.\./\.\./\(cli\|web\)\|from '\.\./\(cli\|web\)" src/core
   grep -rln "getOriginUrl" src/core/sync --include='*.ts' | grep -v "^src/core/sync/git.ts$"   # 期望只列出 connection.ts(接入)、runner.ts(补存上报地址)、merge.ts(并旧连接时补上报地址)
   git diff "$BASE" -- src/core/timeline/constants.ts | grep "TIMELINE_SCHEMA_VERSION"        # 期望无输出(版本号没动)
   for f in $(git diff --name-only "$BASE" -- 'src/*.ts'); do [ -f "$f" ] || continue; n=$(wc -l < "$f" | tr -d ' '); [ "$n" -gt 600 ] && echo "$f $n"; done   # 期望无输出
   ```

4. 端到端(临时 HOME;每段跑完都确认 `test ! -e "$HOME/.cgraphx/cgraphx.db"`):

   ```bash
   REPO="$PWD"; OLD="node $REPO/.cgraphx/baseline/数据按项目/old/dist/cli/index.js"; NEW="node $REPO/dist/cli/index.js"
   T="$(cd "$(mktemp -d)" && pwd -P)"; export HOME="$T/home" USERPROFILE="$T/home"; mkdir -p "$HOME" "$T/bin" "$T/w"
   export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
   printf '#!/bin/sh\nexec node "%s/dist/cli/index.js" "$@"\n' "$REPO" > "$T/bin/cgraphx"; chmod +x "$T/bin/cgraphx"; export PATH="$T/bin:$PATH"
   count() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).length))"; }
   ```

   - **A 升级前的旧库、K8、F4、D23**:

     ```bash
     cd "$T/w" && git init -q app && cd app && git remote add origin git@github.com:demo/app.git && git commit -q --allow-empty -m init
     $OLD install -y > /dev/null 2>&1
     printf '{"session_id":"s-old","cwd":"%s","prompt":"旧版提问"}' "$PWD" | $OLD timeline-user-prompt-hook
     printf '{"session_id":"s-k8","cwd":"%s","source":"startup"}' "$PWD" | $NEW timeline-session-start-hook
     $NEW timeline query | count                                   # 期望 2(新版没 install 前照旧记本地库)
     $NEW project show --json                                      # 期望 "mode": "legacy"
     ls "$HOME/.cgraphx/projects" 2>/dev/null | wc -l              # 期望 0
     $NEW install -y 2>&1 | tee "$T/i1.txt" > /dev/null
     grep -c '已把 2 条事件、2 个会话并进项目 github.com/demo/app' "$T/i1.txt"   # 期望 1
     P="$HOME/.cgraphx/projects/github.com-demo-app"; ls "$P/identity.json" "$P/cgraphx.db" "$P"/backups/*/cgraphx.db
     node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('.cgraphx/cgraphx.db');console.log(d.prepare(\"select count(*) c from sqlite_master where type='table' and (name like 'timeline_%' or name like 'task_%' or name like 'sync_%')\").get().c)"   # 期望 0
     cat .cgraphx/project.json                                     # 期望 mergedAt 有值、mergedInto 为 github.com-demo-app
     $NEW install -y 2>&1 | grep -c '已经并过'                      # 期望 1
     node -e "const fs=require('fs');for(const p of process.argv.slice(1))console.log((fs.statSync(p).mode&0o777).toString(8))" "$HOME/.cgraphx/projects" "$P"   # 期望 700 两行
     ```

   - **B 别的 clone、K1、K3、K17**:

     ```bash
     cd "$T/w" && mkdir app2 && cd app2 && git init -q && git remote add origin https://github.com/demo/app/
     printf '{"session_id":"s-app2","cwd":"%s","source":"startup"}' "$PWD" | $NEW timeline-session-start-hook
     cd "$T/w" && mkdir other && cd other && git init -q && git remote add origin git@github.com:demo/other.git
     cd "$T/w/app"
     printf '{"session_id":"s-a","cwd":"%s","source":"startup"}' "$PWD" | $NEW timeline-session-start-hook
     printf '{"session_id":"s-a","cwd":"%s","tool_name":"Read","tool_input":{"file_path":"%s/README.md"},"tool_response":{}}' "$T/w/other" "$T/w/other" | $NEW timeline-post-tool-use-hook
     $NEW timeline query --session s-a | count                     # 期望 2(会话在 app 开,cd 到别的项目 other 里的工具调用照样记在这里)
     $NEW timeline query --session s-app2 | count                  # 期望 1(https 写法的另一份 clone 没装过,项目库在就记)
     $NEW project show --json                                      # 期望 roots 含 $T/w/app 和 $T/w/app2,不含 $T/w/other
     ls "$HOME/.cgraphx/projects"                                  # 期望只有 github.com-demo-app
     ```

   - **C worktree 的提交、D31 卸载**:

     ```bash
     cd "$T/w/app" && git worktree add -q ../app-wt && cd ../app-wt
     echo x > f.txt && git add f.txt && git -c core.hooksPath=/dev/null commit -q -m 'wt 提交' && $NEW timeline-git-commit-hook
     $NEW timeline query --type git_commit | grep -c 'wt 提交'      # 期望 1(没装过的 worktree 也记到 github.com/demo/app)
     $NEW install -y > /dev/null 2>&1
     $NEW uninstall -y 2>&1 | tee "$T/u1.txt" > /dev/null
     grep -c '还装着,提交照样记' "$T/u1.txt"                       # 期望 1
     grep -c 'cgraphx-timeline-hook' "$(git rev-parse --git-path hooks)/post-commit"   # 期望 ≥1(主目录还装着,钩子留着)
     cd "$T/w/app" && $NEW uninstall -y 2>&1 | tee "$T/u2.txt" > /dev/null
     grep -c '要删数据,用清理命令' "$T/u2.txt"                     # 期望 1
     grep -c 'cgraphx-timeline-hook' "$(git rev-parse --git-path hooks)/post-commit" 2>/dev/null   # 期望 0 或文件不在
     ls "$P/cgraphx.db"                                            # 期望在(项目数据留着)
     ```

   - **D 一个仓库几个项目、D9、D21**:

     ```bash
     cd "$T/w" && git init -q plat && cd plat && git remote add origin git@github.com:demo/platform.git
     mkdir server web && echo a > server/a.txt && echo b > web/b.txt && echo r > README.md && git add . && git -c core.hooksPath=/dev/null commit -q -m init
     (cd server && $NEW install -y > /dev/null 2>&1); (cd web && $NEW install -y > /dev/null 2>&1)
     git config --local --get cgraphx.server.projectName                                  # 期望 server
     echo a2 >> server/a.txt && echo b2 >> web/b.txt && git -c core.hooksPath=/dev/null commit -qam '两个都改' && $NEW timeline-git-commit-hook
     echo r2 >> README.md && git -c core.hooksPath=/dev/null commit -qam '只改根目录' && $NEW timeline-git-commit-hook
     (cd server && $NEW timeline query --type git_commit)          # 期望只有「两个都改」一条,commit_files 只有 server/a.txt
     (cd web && $NEW timeline query --type git_commit)             # 期望只有「两个都改」一条,commit_files 只有 web/b.txt
     ls "$HOME/.cgraphx/projects"                                  # 期望含 github.com-demo-platform-server、github.com-demo-platform-web,没有 github.com-demo-platform
     git worktree add -q ../plat-wt && cd ../plat-wt               # worktree 里 server/ 没装过
     echo a3 >> server/a.txt && git -c core.hooksPath=/dev/null commit -qam 'wt 改 server' && $NEW timeline-git-commit-hook
     (cd "$T/w/plat/server" && $NEW timeline query --type git_commit | grep -c 'wt 改 server')   # 期望 1(没装过的子目录项目根照样记进 github.com-demo-platform-server)
     cd "$T/w" && git init -q platform-server && cd platform-server && git remote add origin git@github.com:demo/platform-server.git && git commit -q --allow-empty -m init && $NEW install -y > /dev/null 2>&1
     cat "$HOME/.cgraphx/projects/github.com-demo-platform-server-2/identity.json"       # 期望 origin 为 github.com/demo/platform-server、name 为 null
     ```

   - **E 改名、旧库里改名、列出、删除**:

     ```bash
     cd "$T/w" && git init -q wf && cd wf && git commit -q --allow-empty -m init && $NEW install -y > /dev/null 2>&1
     git config --local --get cgraphx.projectName                  # 期望 wf
     printf '{"session_id":"s-wf","cwd":"%s","source":"startup"}' "$PWD" | $NEW timeline-session-start-hook
     $NEW project name wf2                                         # 期望两行:之后记到 wf2 / 之前记的 1 条还在 wf 下
     $NEW project name wf2                                         # 期望 没有变化
     $NEW project name '   '; echo "exit=$?"                       # 期望 exit=1
     cd "$T/w" && git init -q legacy && cd legacy && git commit -q --allow-empty -m init && $OLD install -y > /dev/null 2>&1
     $NEW project name zzz; echo "exit=$?"                         # 期望 M10,exit=2
     $NEW project list --json | count                              # 期望 5(github.com-demo-app、platform 的 server 与 web、platform-server-2、wf;wf2 还没记过事件,目录没建)
     $NEW project remove /etc --yes; echo "exit=$?"                # 期望 exit=1
     ln -s "$T" "$HOME/.cgraphx/projects/evil"; $NEW project remove evil --yes; echo "exit=$?"; rm "$HOME/.cgraphx/projects/evil"   # 期望 exit=1,$T 下什么都没删
     $NEW project remove wf < /dev/null; echo "exit=$?"            # 期望不删,exit=1(非交互没给 --yes)
     $NEW project remove wf --yes                                  # 期望 M17,列出 $T/w/wf
     ls "$HOME/.cgraphx/projects/wf" 2>/dev/null | wc -l           # 期望 0
     ```

   - **F web 只读、D16**:

     ```bash
     cd "$T/w/plat/server"; S="$HOME/.cgraphx/projects/github.com-demo-platform-server"
     lsnow() { ls -R "$S" | grep -v -- '-wal$' | grep -v -- '-shm$'; }   # SQLite 打开 WAL 库自带的 -wal、-shm 不算
     lsnow > "$T/before.txt"; node -e "console.log(require('fs').statSync(process.argv[1]).mtimeMs)" "$S/cgraphx.db" > "$T/m1.txt"
     $NEW web -p 47123 > /dev/null 2>&1 & WEB=$!
     for i in $(seq 1 20); do curl -s -o /dev/null http://127.0.0.1:47123/ && break; node -e 'setTimeout(()=>{},250)'; done
     for u in / /timeline /tasks; do curl -s -o /dev/null -w "%{http_code} $u\n" "http://127.0.0.1:47123$u"; done   # 期望三行 200
     kill $WEB
     lsnow > "$T/after.txt"; diff "$T/before.txt" "$T/after.txt" && echo same                   # 期望 same
     node -e "console.log(require('fs').statSync(process.argv[1]).mtimeMs)" "$S/cgraphx.db" | diff - "$T/m1.txt" && echo same   # 期望 same
     rm -rf "$HOME/.cgraphx/projects/github.com-demo-platform-web"; cd "$T/w/plat/web"
     $NEW web -p 47124 > /dev/null 2>&1 & WEB=$!
     for i in $(seq 1 20); do curl -s -o /dev/null http://127.0.0.1:47124/ && break; node -e 'setTimeout(()=>{},250)'; done
     for u in /timeline /tasks; do curl -s -o /dev/null -w "%{http_code} $u\n" "http://127.0.0.1:47124$u"; done   # 期望两行 200(项目库不在,按没有数据显示)
     kill $WEB; ls "$HOME/.cgraphx/projects/github.com-demo-platform-web" 2>/dev/null | wc -l    # 期望 0(web 没建目录)
     ```

5. 收尾:`ls ~/.cgraphx/projects ~/.cgraphx/sessions 2>&1 | head -2` 仍然不在;`rm -rf "$T"`;`cgraphx features sync`

## 允许局部适配的范围

- 基础层、各子系统内部的函数拆分、私有函数命名、文件内组织;单文件超 600 行时在同一任务的涉及范围内再拆(新文件名写进回报)
- 进程内记忆的具体结构、缓存上限;`hasLegacyTables` 的记忆键
- 并旧事件的分批大小、去重查询的写法(结果符合 C-8)
- 大小的显示格式(K / M / G 怎么取整);JSON 里一律给字节数
- `sessions/` 目录可以同样建成 0700
- replica 的 `matchProjectRoot` 可以改用 C-6 的 `createRootMatcher`,行为不变
- 日志前缀、stderr 里的补充说明(C-14 的文案本身不改)

## Plan 冲突上报规则

- 子 agent 发现任务和 index 契约冲突、或契约没覆盖到会让行为分叉的地方:不自行补全,回报 `PLAN_CONFLICT` 写明冲突的契约编号和场景;主会话停下问用户
- 权威链:任务 ← plan ← spec;spec 原文和本 plan 对不上时以 spec 为准,并上报
- 要改的文件超出任务的「涉及范围」:停下,回报「卡住」

## 关键风险与防跑偏约束

- **真实家目录**:任何代码、测试、验证都不写真实 `~/.cgraphx/projects`、`~/.cgraphx/sessions`;测试一律经 T-1 的 `__tests__/setup-home.ts` 用临时 HOME;统一验证 2、5 核对
- **hook 预算与不丢事件**:除会话开始、git 钩子、补登记那一次,hook 不跑 git;hook 不发网络请求;写事件一律 await;任何异常吞掉只写 stderr,不阻塞宿主(interface-standards「Hook 子命令契约」)
- **项目目录被半个复活**:只有 C-3 的 `ensureProjectDir` 建目录,只在根装过的写入时经 C-5 `ensureDataDir` 调;写轮次记录、锁、触发文件、日志的地方目录不在就不写
- **旧库并的那一刻**:D27 两段;第 ② 段持旧库写锁的时间只含尾巴、task、sync 表与几个文件;记号必须在旧库 COMMIT 之前写好(等写锁的 hook 拿到锁后看得到),COMMIT 失败先删记号再报 M3
- **版本流程不变**:副本的开、列、删、合入、发版审核行为不变;副本登记位置不变;数据侧不再看 shared 链接
- **兼容旧库**:旧库模式下新版只给旧库补建 `timeline_roots`,其余表和版本号不动,退回旧版仍能打开
- **循环 import**:基础层 `data-location.ts` 不 import `db/index.ts`;`directory.ts` 不 import 新基础层文件
- **旧名字别留在注释里**:`resolveDataDir`、`warnIfMainRootMissing`、`DataDirInfo` 删掉后,代码注释里也不写这几个名字(统一验证 3 按名字 grep `src`,注释也会命中)
- **已知根和起点别混用**:git 钩子分到的子目录项目根可能没装过,只能传给 `AtRoot` 版(C-5);传给按起点认根的函数会被认成工作区根,提交就记丢了
- **web 只读的边界**:SQLite 打开 WAL 库会自带 `-wal`、`-shm`(只读打开也会建),不算写数据;D16 与设计验收 12 按「除这两个外项目目录不新增文件、库文件 mtime 不变、不建项目目录」核(统一验证 4 场景 F)

## 待确认项

- spec 待确认项「改名以后改回按 origin 认」:本期不给命令,不影响本 plan
- 无其他

## 启动语

`/dev-impl-subagent docs/features/2026-11-05-数据按项目放用户目录/plan/数据按项目放用户目录-index.md`
