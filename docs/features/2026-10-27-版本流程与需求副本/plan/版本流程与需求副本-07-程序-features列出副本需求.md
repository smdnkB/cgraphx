# T-7: 程序——features 列出副本里的需求

> 产物: plan
> 依据: spec@16dc4b2

- 目标:主目录的 `cgraphx features list` / `features sync` 另外列出在用副本里登记的需求,标「在副本 <副本目录名>」;副本里只列副本自己的目录树;没有副本的项目输出不变
- 对应 spec 编号:F8(「主目录的 cgraphx features list 也列出副本里在做的需求」)、D30
- 强制引用:`docs/guides/coding-standards.md`、`docs/guides/interface-standards.md`
- 涉及范围:
  - `src/core/features/index.ts`
  - `src/core/features/types.ts`
  - `src/core/features/scanner.ts`
  - `src/core/features/cli.ts`
  - `src/core/features/sync.ts`
- 必须严格执行:
  - 按 C-10(可选字段 `replica`、表格「目录」列写法、my-features.md 链接写法)
  - 按 C-1:用 `resolveDataDir(projectRoot).state` 判断在不在副本里;按 C-4:只经 `from '../replica'` 用 `listReplicas`
  - `scanFeatures`、`readFeatureTask`、`readFeatureOwner`、`scanFeatureTasks`、`findMainSpecRel`、`listFeatureFiles` 的签名和结果不变(task 子系统在用)
- 允许局部适配:
  - scanner.ts 里新增「只解析一个需求目录」的内部函数及其命名(从 `scanFeatures` 的循环体抽出,`scanFeatures` 改为调用它,结果不变)
  - 注释措辞
- 具体要求:
  1. `types.ts`:`FeatureEntry` 加 `replica?: { name: string; path: string }`,注释写明:只在主目录列出的、来自副本的需求上有;主目录自己的条目不带。
  2. `scanner.ts`:抽出并导出 `scanFeature(projectRoot, featureId): FeatureEntry | null`(目录不存在或 feature-id 不合法 → null;字段算法与 `scanFeatures` 完全相同);`scanFeatures` 改为对每个目录调用它。门面 `index.ts` 不导出 `scanFeature`(只在 features 内部用)。
  3. `index.ts` 的 `listFeatures(projectRoot, filter)`:
     - `resolveDataDir(projectRoot).state` 不是 `own`(在副本里)→ 照旧 `filterFeatures(scanFeatures(projectRoot), filter)`
     - 是 `own`:先 `scanFeatures(projectRoot)`;再对 `listReplicas(projectRoot)` 里目录还在的每个副本,`scanFeature(副本.path, 副本.featureId)` 得到条目(为 null 跳过),加上 `replica: { name: 副本.name, path: 副本.path }`;主目录里有同一 featureId 的条目就替换它,没有就加进去;最后按 `scanFeatures` 同样的顺序(日期倒序、标题升序)排好,再 `filterFeatures`
  4. `cli.ts` 的表格渲染(`renderTable`):「目录」列,条目带 `replica` 时写 `${entry.path}(在副本 ${entry.replica.name})`;`--json` 原样输出条目(带 replica 的才有这个字段)。
  5. `sync.ts`:
     - 带 `replica` 的行:主 spec 用 `findMainSpecRel(entry.replica.path, entry.featureId)` 找;链接目标按 C-10 写 `<../../<副本目录名>/<主 spec 相对路径>>`,没有主 spec 链到 `<../../<副本目录名>/docs/features/<id>/>`;链接后加 `(在副本 <副本目录名>)`,「还没有 spec」的标注照旧
     - 不带 `replica` 的行:与现在逐字相同
- 完成条件:
  - 没有登记副本时,`features list`、`features list --json`、`features sync` 生成的 `my-features.md` 与改动前逐字相同
  - 在副本里执行 `features list`,只列副本自己的目录树,没有任何条目带 `replica`
  - 每个改动的文件 ≤ 600 行
- 提交点:
  1. `feat(features): 主目录列出副本里的需求——标「在副本」+ 我的需求索引链到副本`:`src/core/features/index.ts`、`types.ts`、`scanner.ts`、`cli.ts`、`sync.ts`
- 风险/注意事项:
  - features 依赖 replica、replica 不依赖 features(spec D1):不要从 replica 反向引用 features 的任何东西
  - `features show`、`features check` 不改:它们只看当前目录树
