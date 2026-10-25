# 规格说明: 我的需求索引直达 spec

> 产物: spec
> feature-id: 2026-10-25-我的需求索引直达spec
> 负责人: liulongfei
> 日期: 2026-10-25

## 功能方案

> 原样收录 clarify 终确认的功能方案;业务要变,回 clarify 改,再同步这一节。

**一句话**:my-features.md 现在每行只有目录路径,而且是纯文本,点不开。这次把每行的需求名改成直接链到这个需求的主 spec,在编辑器里点一下就能打开;生成时机和文件位置都不变。需求目录归档已撤回。

用户会这样用:

    跑完 /dev-spec、/dev-plan、/doc-backfill
    (或手动 cgraphx features sync)
              │
              ▼
    .cgraphx/my-features.md 重新生成
    (只列负责人是自己的需求,按日期从新到旧)
              │
              ▼
    在 IntelliJ 里打开 ──点需求名──→ 这个需求的主 spec
                        └─(还没有 spec)──→ 需求目录

| 编号 | 功能点 | 类别 | 行为链(已锁定) | 边界 | 落地依据 |
|---|---|---|---|---|---|
| F1 | my-features.md 点需求名直接打开 spec | 核心 | 表格改成三列:日期 / 阶段 / 需求。需求名是链接,点开就是这个需求的主 spec,原来的「目录」列去掉。头部说明加一句「点需求名打开 spec」 | ① 目录里还没有 spec(只有交接文件):需求名链到目录,后面标「（还没有 spec）」<br>② 目录里有几个 spec:只链主 spec,和 `cgraphx features show` 认的是同一个<br>③ 目录名带空格或括号:链接照样能点开<br>④ 名下没有需求:保持现在的提示「还没有以你为负责人的需求目录」 | 按 git 用户名筛出本人需求、认定主 spec,这两套规则都已有;hx 里 liulongfei 的 11 个需求都找得到主 spec |
| — | 没写负责人的需求按 git 第一次提交人补上 | 建议新增 ✂️ | 不做 | — | 用户决定不做。代价:同一个人的 git 用户名可能不统一,替别人补文档的人会被算成负责人 |
| — | 每次开会话都重新生成 | 建议新增 ✂️ | 不做,更新时机保持现状 | — | 用户决定不做。代价:每次开会话多花约半秒 |
| — | 终端输出、文件位置、其他文档的链接 | 边界外 | 不做:`features list --mine` 的输出不变;文件还在 `.cgraphx/` 下,不进 git;不给设计文档、收口档案等加链接 | — | 只改这一个文件的样子 |
| — | 需求目录归档 | 边界外 | 不做 | — | 收益不大,已撤回 |

**体验决策**:这次没有需要选的体验方案。生成时机和文件位置都不变,只改表格的样子。

## 怎么实现

### 细节方案:F1 my-features.md 点需求名直接打开 spec

| # | 决策 | 选择 | 没选的(为什么) | 理由(依据) | 影响面 |
|---|---|---|---|---|---|
| D1 | 链接目标写法 | 相对 my-features.md 所在位置写:`../` 加主 spec 的项目相对路径,整个目标放进尖括号,如 `[标题](<../docs/features/2026-08-23-订单报文诊断能力(skill)/订单报文诊断能力(skill)-spec.md>)`;目标里出现 `<`、`>`、`\` 时前面加反斜杠 | 百分号编码(`%20`、`%28`):中文和空格都变成编码,源码视图里读不出是哪个文件;不加尖括号:CommonMark 里不加尖括号的链接目标不能含空格,hx 有 3 个目录名带空格;写本机绝对路径:项目目录一挪,整个文件的链接全部失效 | CommonMark 链接目标规则;hx 实测 3 个目录名含空格、5 个含括号;用项目已有的 markdown-it 解析过,表格里带空格、括号、中文的尖括号目标都解析成正确路径;dev-spec 命名规则禁止 feature-id 含 `< > \ \|`,转义只给不经 dev-spec 建的目录兜底 | 只影响 my-features.md 的内容 |
| D2 | 主 spec 从哪取 | `syncMyFeatures` 对本人的每一行调 scanner 的 `findMainSpecRel(projectRoot, featureId)`;返回 null 时链接目标是目录本身 `../docs/features/<feature-id>/`(F1①) | 给 `FeatureEntry` 加主 spec 字段,让 `scanFeatures` 顺带带出:`features list --json` 会多一个字段,违反功能方案里「`features list --mine` 的输出不变」 | `findMainSpecRel` 已被 `scanFeatures`(读日期)、`features show`、`features check` 共用;sync.ts 与 scanner.ts 同属 features 子系统,直接 import,不经门面 | 本人的每个需求目录多列一次文件;hx 里是 11 个目录,耗时可忽略 |
| D3 | 链接文字转义 | 链接文字用 `FeatureEntry.title`(目录名去掉日期),只给 `\`、`[`、`]` 加反斜杠,这三个字符会截断链接文字;整个单元格照旧经 `mdCell` 转义 `\|`、压掉换行 | 转义全部 Markdown 标点(`*`、`_`、反引号等):源码视图里标题夹满反斜杠,而这些字符在单元格里最多改变粗体斜体显示,不影响链接能不能点开 | CommonMark 链接文字规则;hx 291 个目录名里没有 ASCII 方括号和反引号 | 只影响 my-features.md 的内容 |

数据格式(`.cgraphx/my-features.md`,每次全量重写;前两行取 hx 的实际数据,第三行是只有交接文件的目录的示例):

```markdown
# 我的需求索引(自动生成,勿手改)

> 负责人:liulongfei · 共 3 个需求 · 点需求名打开 spec · 重新生成:`cgraphx features sync`

| 日期 | 阶段 | 需求 |
|---|---|---|
| 2026-10-21 | 已规格 | [bug60923-免签审批查询审批列表的号码超过1000时被过滤](<../docs/features/2026-10-21-bug60923-免签审批查询审批列表的号码超过1000时被过滤/bug60923-免签审批查询审批列表的号码超过1000时被过滤-spec.md>) |
| 2026-08-23 | 已规划 | [订单报文诊断能力(skill)](<../docs/features/2026-08-23-订单报文诊断能力(skill)/订单报文诊断能力(skill)-spec.md>) |
| 2026-10-24 | - | [交接中的需求](<../docs/features/2026-10-24-交接中的需求/>)（还没有 spec） |
```

- 头部说明只在「共 N 个需求」后面插入「点需求名打开 spec」;第一行标题、行顺序(日期倒序,同日按标题)、日期或阶段为空时写 `-`、空态文案都沿用现状。
- 「（还没有 spec）」用全角括号,紧跟在链接后面。

### 全局约束

- `features list`(含 `--mine`、`--json`)、`features show`、`features check` 的输出不变;`FeatureEntry` 不加字段。
- `syncMyFeatures` 的返回值(`SyncResult`:file / count / owner)、`features sync` 的终端输出、文件位置、`.cgraphx/.gitignore` 兜底都不变,仍是每次全量重写。
- 主 spec 只用 `findMainSpecRel` 认定,不另写规则。
- 不新增依赖。

## 设计验收

| # | 对应 | 验收点 | 怎么验 |
|---|---|---|---|
| 1 | D1 | 目录名含空格、括号、中文时,用 markdown-it 解析生成的 my-features.md,每个需求链接的 href 解码后等于 `../docs/features/<feature-id>/<主 spec 文件名>` | 单元测试 |
| 2 | D2 | 同一目录有 `<前缀>-spec.md`、`<前缀>-单元测试-spec.md`、`<前缀>-接口测试-spec.md` 时,链接指向 `<前缀>-spec.md`,与 `findMainSpecRel` 的结果一致 | 单元测试 |
| 3 | D3 | 标题含 `[`、`]` 时,链接文字完整,链接仍指向主 spec | 单元测试 |
| 4 | 全局约束 | 改动前后,本库的 `features list --mine` 终端输出和 `--json` 逐字一致 | 本库实跑对比 |
| 5 | D1 | 在 IntelliJ 的 Markdown 预览里点需求名,能打开对应 spec,包括目录名带括号的 `订单报文诊断能力(skill)`;同时记下点「还没有 spec」那行时 IntelliJ 怎么处理目录链接,点不开就回 clarify 定 F1① 怎么改 | 手工验证,结果写进实现汇报 |

## 待确认项

- 无
