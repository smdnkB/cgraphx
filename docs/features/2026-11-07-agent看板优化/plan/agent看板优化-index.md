# 实现计划: agent看板优化

> 产物: plan
> 依据: spec@67abbc8

## 设计预览

原来看板只按最近活动列任务,看不出任务属于哪个版本。这次 release 子系统新增一个只读文件 `versions.ts`,用 git 读出各版本分支自己那一段的合入、哪些版本打了 tag,以及需求分支的末端;看板新增一个纯函数文件 `versions.ts`,把这些事实和副本登记对上,给每个任务算出版本;装配时把本机没挂会话、但有版本的任务另放一组;页面加版本标签、版本下拉和过滤。全程只跑只读 git 命令,不写登记、不写库、不写 ref。

**难回头的决策落在哪**(决策已在 spec 确认,这里核对落点,其余可略读)

| spec 决策 | 落在 | 怎么守住 |
|---|---|---|
| D15 🔒 看板经 release 门面读版本历史,认版本在看板纯函数里 | T-1 `src/core/release/versions.ts`、`release/index.ts`;T-2 `src/core/board/versions.ts`、`board/compute.ts` | 版本相关的 git 命令只出现在 `release/versions.ts`(C-6);看板只 import release 门面的 C-1 函数与类型,`board/versions.ts` 不 import `node:child_process`(C-3) |

## 来源 spec 摘要

spec:`docs/features/2026-11-07-agent看板优化/agent看板优化-spec.md`。F5 按合入记录和副本登记现算任务版本(K15–K20,D15–D21);F6 在任务行和摘要卡显示版本(D22);F7 页头版本下拉,带任务数,按版本过滤,记住选择(K21–K25,D23、D24)。spec 编号接着 agent看板 spec(F1–F4、K1–K14、D1–D14)往后编。

## 范围

- 覆盖 F5、F6、F7;D15–D24 全部落进任务。
- 明确不包含(spec 功能清单的边界外):新增登记、手工给任务指定版本;改合入、发版流程(dev-merge 的合并说明、release-review 打 tag 照旧);按版本统计工作量、出报表。
- 也不包含:改 `server.ts` 的路由与安全校验、改 `cli.ts`、改认任务 `match.ts` 的规则、改 skill 模板。

## 任务清单

| 任务 | 文件 | 对应 spec | 涉及范围 |
|---|---|---|---|
| T-1 release 读版本历史 | `plan/agent看板优化-01-release读版本历史.md` | D15、D16、D17、D18 | `src/core/release/versions.ts`(新)、`release/types.ts`、`release/constants.ts`、`release/index.ts` |
| T-2 看板认版本与装配 | `plan/agent看板优化-02-看板认版本与装配.md` | F5、D15、D18、D19、D20、D21 | `src/core/board/versions.ts`(新)、`board/types.ts`、`board/compute.ts`、`board/index.ts` |
| T-3 页面显示与过滤 | `plan/agent看板优化-03-页面显示与过滤.md` | F6、F7、D22、D23、D24 | `src/core/board/page.html` |
| T-4 文档同步 | `plan/agent看板优化-04-文档同步.md` | D15、全部 | `CLAUDE.md`、`CHANGELOG.md` |

## 执行顺序

1. 第一步:T-1、T-3、T-4,三个可以同时跑(文件不重叠;T-3 只依赖 C-2 的数据形状,T-4 只依赖 spec)。
2. 第二步:T-2(要用 T-1 产出的 C-1 函数)。
3. 全部做完跑「统一验证」。

## 必须严格执行的契约

**C-1 release 门面新增(T-1 产出,T-2 消费)**

`src/core/release/types.ts` 新增并经 `release/index.ts` 导出:

```ts
/** 一个版本分支自己的那一段(K15) */
export interface VersionSegment {
  /** 版本号,如 '2.0.14'(分支名去掉 'dev/') */
  version: string;
  /** 分支名,如 'dev/2.0.14' */
  branch: string;
  /** 这一段第一父链上的提交(完整 hash) */
  firstParent: ReadonlySet<string>;
  /** 这一段的全部提交:git rev-list dev/x.y.z ^B */
  commits: ReadonlySet<string>;
  /** 这一段第一父链上「合入需求：」合并说明里取出的标题,去掉「(第 N 次)」后去重 */
  mergedTitles: readonly string[];
}

export interface VersionHistory {
  segments: readonly VersionSegment[];
  /** 有 tag `v<版本号>` 的版本号,如 ['2.0.10', …, '2.0.14'] */
  releasedVersions: readonly string[];
}
```

`release/index.ts` 新增导出函数(实现在 `release/versions.ts`):

- `readVersionHistory(dir: string): VersionHistory` —— 按 D16、D17 读;不是 git 仓库、没有 main 也没有 master、任一 git 命令失败 → 返回 `{ segments: [], releasedVersions: [] }`,不抛错。
- `resolveBranchTips(dir: string, branches: readonly string[]): Map<string, string>` —— 分支名 → 末端完整 hash;本地没有的分支不放进结果;git 失败返回空 Map,不抛错。

**C-2 看板数据形状(T-2 产出,T-3 消费)**

`src/core/board/types.ts`:

```ts
/** 任务挂的一个版本(D19) */
export interface TaskVersion {
  version: string;   // '2.0.14'
  released: boolean; // 有 tag v<version>
  merged: boolean;   // true 合入过这个版本分支;false 是计划版本
}
```

- `BoardTask` 加 `versions: TaskVersion[]`:版本号逐段按数字倒序;空数组 = 无版本;计划版本最多一个且只在一个合入都没有时出现。
- `BoardProject` 加 `noSession: BoardTask[]`:本机没挂上会话、`versions` 不为空的任务,按标题 `localeCompare(…, 'zh')` 升序;这些任务的 `fixedCount`、`maybeCount` 为 0,`agents`、`fixed`、`maybe` 为空数组,`lastActiveAt` 为 null。
- `tasks`、`older`、`unsorted` 的内容与排序和改前一致(只是每个任务多了 `versions`)。
- `ReplicaRef` 加 `baseBranch: string`、`createdAt: string`(和 `ReplicaEntry` 同名同义)。

**C-3 认版本纯函数(T-2 内部,写死签名供复核)**

`src/core/board/versions.ts` 导出:

```ts
export function assignTaskVersions(input: {
  tasks: ReadonlyArray<{ featureId: string; title: string }>;
  replicas: readonly ReplicaRef[];
  history: VersionHistory;
  branchTips: ReadonlyMap<string, string>;
}): Map<string, TaskVersion[]>
```

规则(D17、D18、D19):对每个任务、每个 segment —— `segment.mergedTitles` 含任务标题(全等);或这个任务的某份副本登记的 `branch` 在 `branchTips` 里,末端 T 满足 `segment.commits.has(T) && !segment.firstParent.has(T)` —— 满足一条就是合入了这个 `segment.version`。合入过的版本去重、倒序;一个都没有时取这个 `featureId` 的副本登记里 `createdAt` 最大的那份,`baseBranch` 过 `VERSION_BRANCH_PATTERN`(release 门面已导出)就给 `{ version: baseBranch 去掉 'dev/', merged: false }`;`released` 一律按 `history.releasedVersions` 判。文件不 import `node:child_process`,不读文件系统。

**C-4 页面文案与存储(T-3)**

- 版本标签(D22):`merged && released` →「2.0.14」;`merged && !released` →「2.0.15 未发」;`!merged && !released` →「计划 2.0.15」;`!merged && released` →「计划 2.0.14 · 没赶上」;多个用「、」连。
- 摘要卡格名「版本」,空数组显示「无版本」。
- 下拉选项文案:「全部版本」(不带数);版本项 =「<版本号>」或「<版本号> 未发」,后接「(N)」;最后「无版本(N)」。一个版本有任务就看它的 `released`:取挂到它的任意一个 `TaskVersion.released`。
- 下拉的 `value` 与 `localStorage` 存值:`''`(全部版本)、`v:<版本号>`、`none`;键 `cgraphx-board-version`。
- `noSession` 任务的会话区空态文案「本机没有挂上的会话」。

**C-5 版本号比较**

版本号按 `.` 切成三段数字逐段比,大的在前(`2.0.10` 在 `2.0.9` 前)。T-2(TS)与 T-3(页面 JS)各写一份,规则同此。

**C-6 只读 git 命令**

只允许 `rev-parse`、`rev-list`、`for-each-ref`(spec 全局约束);读合并说明也用 `rev-list --format`,不用 `git log`;不 `fetch`、不写 ref、不改工作区。git 调用全部在 `release/versions.ts` 里,照 `release/guard.ts` 的 `runGit` 写法(`execFileSync`,`encoding: 'utf8'`,`stdio: ['ignore', 'pipe', 'ignore']`,出错返回 null),另加 `maxBuffer`(全部提交列表可能上万行)。`maxBuffer` 的值、「合入需求：」正则、tag 正则放进 `release/constants.ts`,不在 `versions.ts` 里写字面量。

## 细节方案核对

| spec 决策 | 落进 |
|---|---|
| D15 🔒 模块边界 | T-1(release 侧)、T-2(看板侧、门面注释) |
| D16 版本分支那一段 | T-1 |
| D17 合入说明 | T-1(解析标题)、T-2(按标题全等认,C-3) |
| D18 需求分支并进来 | T-1(`resolveBranchTips`)、T-2(集合判断,C-3) |
| D19 认版本 | T-2 |
| D20 同一目录只读一次 | T-2 |
| D21 没挂会话的任务 | T-2 |
| D22 版本标签 | T-3 |
| D23 页面过滤 | T-3 |
| D24 记下选择、改选、空态 | T-3 |
| 文档表 | T-4(`CLAUDE.md`、`CHANGELOG.md`),T-2(看板门面头注释) |

spec 没有留给 plan 定的选型缺口;D20 的缓存键已在 spec 里回改成主目录 realpath(spec@67abbc8)。

## 适用规范

- `docs/guides/coding-standards.md`:「边界与结构」(门面硬约定、分层)、「选型(偏离社区默认)」(`node:` 前缀、中文注释、单文件超 600 行必须拆分)、「错误与日志」。
- 不涉及 schema、不改 CLI 命令面:`data-standards.md`、`interface-standards.md` 不适用。

## 提交规范

从 `docs/guides/git-standards.md` 结晶:

- 格式 `type(scope): 中文描述`;type 用 feat / refactor / fix / docs;补充说明用「——」,并列用「+」。
- 非琐碎提交写 body:背景一行 +「-」列要点;标题和 body 之间空一行。
- 无票据关联,需求追踪走 `docs/features/`。
- 末尾带 `Co-Authored-By` 行。
- 提交前检查点(对 `git diff --cached` 逐项看):与 TS 同放的运行时资产未登记 `scripts/copy-assets.cjs`;`src/core` 出现对 `src/cli` / `src/web` 的 import;`schema.sql` 丢 `IF NOT EXISTS`;timeline hook 链路未 await 的 DB 写入;`vitest.config.ts` 的 `TZ: 'UTC'` 被改;被注释掉的命令注册;写死的魔法值(绝对路径、密钥、阈值、版本号);新增 TODO / FIXME。
- 开工前先单独提交需求文档:`docs(features): agent看板优化——任务挂版本的功能方案、spec 与计划`(讨论稿 v1、v2、spec、plan 目录)。

## 统一验证

1. 副本里没装依赖时先 `npm ci`。
2. `npm run build` 通过(`tsc` 无错误,`dist/core/board/page.html` 在)。
3. `npm test` 全部通过;`__tests__/core/board/` 现有测试不改断言。
4. 本机手工:`node -e` 调 `require('./dist/core/release').readVersionHistory('/Users/smdnk/objects/ai/cgraphx')`,看 `dev/2.0.11`–`dev/2.0.15` 各段 `mergedTitles` 的个数是 4、3、1、10(agent看板 两次去重成一个)、3,`releasedVersions` 含 2.0.10–2.0.14、不含 2.0.15(spec 设计验收 4)。dev/2.0.15 还在合入新需求,个数以验证当时 `git rev-list --first-parent --merges dev/2.0.15 ^d17a1b2` 数出的去重标题为准。耗时(spec 设计验收 6):`node -e "const r=require('./dist/core/release');console.time('v');r.readVersionHistory('/Users/smdnk/objects/ai/cgraphx');console.timeEnd('v')"` 低于 1 秒。
5. 本机手工:`node dist/cli/index.js board`,页面里切到「2.0.14」,项目 `cgraphx` 那一组列出 11 个任务(10 个合入 + dev-del丢弃副本 显示「计划 2.0.14 · 没赶上」;本机 `github.com-smdnkB-cgraphx` 组和它是同一个目录,也会列出同样的任务,下拉里的数是两组相加),切到「全部版本」和改前一样;刷新后选择保留。
   spec 设计验收 1–3(造仓库的单元测试)不进本 plan,由实现后的 `/unit-spec` → `/unit-code` 承接。
6. `wc -l src/core/board/page.html` 不超过 600。

## 允许局部适配的范围

- 文件内部的函数拆分、局部命名、私有辅助函数。
- `release/versions.ts` 里 git 输出的解析方式(分隔符、逐行解析)。
- 页面 CSS 的具体颜色和间距(沿用现有色块写法)、`<select>` 的样式。
- 除此之外,C-1–C-6 的签名、字段名、文案、存储键、排序规则一律固定。

## Plan 冲突上报规则

执行中发现 plan 与 spec 冲突、契约做不到(例:`page.html` 塞不进 600 行)、或需要改不在「涉及范围」里的文件 → 停下,回报 `PLAN_CONFLICT: <任务> <冲突点> <建议>`,不自行扩范围、不改契约。

## 关键风险与防跑偏约束

- **page.html 行数**:现在 497 行,T-3 加完要不超过 600(规范硬线)。spec 旧 D3 定的是单文件页面;塞不下就按 PLAN_CONFLICT 上报,不自行拆文件(拆文件要改服务和 `copy-assets.cjs`)。
- **改了 K2 现有行为**:没会话的任务只能进 `noSession`,不得进 `tasks` / `older`;「全部版本」时页面不得显示 `noSession`。
- **git 输出量**:`rev-list --first-parent main` 与各段 `rev-list` 可能上万行,`execFileSync` 默认 `maxBuffer` 1MB 可能不够,按 C-6 调大。
- **全角冒号**:合入说明是「合入需求：」(全角),正则不能写成半角。
- **测试里的 `ReplicaRef` 字面量**:`__tests__/core/board/match.test.ts` 第 28 行的 `REPLICA_REF` 少了新字段;测试不进 `tsc`(`tsconfig.json` 排除了 `__tests__`),vitest 不做类型检查,不会变红;不为此改测试。

## 待确认项

- 无

## 执行方式

预估改 10 个文件,只跨 release 和看板两块且看板依赖 release,按小需求在一个会话里跑 `/dev-impl`,按执行顺序做。
