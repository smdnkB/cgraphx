# 实现计划(后端): 产物注册表与头部规范

> 产物: plan
> 依据: spec@b2dd47f
> feature-id: 2026-10-18-产物注册表与头部规范
> 负责人: liulongfei
> 日期: 2026-10-18

全部任务的总览、依赖、批次、提交规范与冲突上报规则见同目录 `产物注册表与头部规范-index.md`。每个任务自包含:跨任务契约在用到它的任务里逐字重复;有疑义读 spec 原文对应条款。路径一律相对仓库根(本仓库即项目根)。

---

### T-1: 新建产物注册表模块 `src/core/artifact-registry/`

- 目标:把「文件 → 产物类型」的全部口径集中到一个只依赖 node 内置模块的共享模块:内置类型表、路径规则、头部解析、识别、本地阶段里程碑、首屏标题、按档位的类型集合、spec 指纹。
- 对应 spec 条款:§3.1、§3.2、§3.3、§4.1、§4.2、§6.1、§7(首屏登记)、§10(里程碑)、§11.1(类型集合)
- 强制引用:`docs/guides/coding-standards.md`
- 依赖:无
- 涉及范围:新建 `src/core/artifact-registry/index.ts`、`types.ts`、`constants.ts`、`registry.ts`、`header.ts`、`identify.ts`、`fingerprint.ts`;不改任何既有文件。
- 必须严格执行:
  - 门面 `index.ts` 只导出下列名字,签名一字不改(契约 C-1 原文):

    ```ts
    // 常量
    export const FEATURES_DIR_POSIX = 'docs/features';
    export const SEDIMENT_TYPE_ROOTS: Readonly<{
      knowledge: 'docs/knowledge/';
      schema_knowledge: 'docs/schema-knowledge/';
      code_map: 'docs/code-map/';
      design_map: 'docs/design-map/';
    }>;
    export const SEDIMENT_DIR_PREFIXES: readonly ['docs/knowledge/', 'docs/schema-knowledge/', 'docs/code-map/', 'docs/design-map/'];
    export const ARTIFACT_TYPE_KEY_PATTERN: RegExp; // /^[a-z0-9_]{1,64}$/
    export const BASIS_PATTERN: RegExp;             // /^spec@([0-9a-fA-F]{7,40})$/
    export const TASK_VALUE_PATTERN: RegExp;        // /^T-\d+$/
    export const HEADER_SCAN_LINES = 30;
    export const ARTIFACT_MAPPING_VERSION = 2;      // 路径规则或识别口径变化时 +1
    export const OWNER_SOURCE_TYPES: readonly ['spec', 'handoff'];

    // 类型
    export type ArtifactPhase = 'design' | 'plan' | 'test' | 'release' | 'knowledge' | 'delivery';
    export type ReportTier = '1.0' | '1.2' | '1.3';
    export type StageMilestone = 'spec_like' | 'plan_index' | 'report';
    export interface BuiltinArtifactType {
      key: string;
      name: string;
      defaultPhase: ArtifactPhase | null;   // handoff 为 null
      minTier: ReportTier | null;           // handoff 为 null:本地专用,不上报
      requiresBasis: boolean;
      firstScreen: { heading: string; planIndexOnly: boolean } | null;
    }
    export interface ArtifactHeader {
      typeRaw: string | null;  // `> 产物:` 去首尾空白后的原值;没有该行为 null;空值为 ''
      owner: string | null;    // 空值记 null,下同
      task: string | null;
      basis: string | null;
    }
    export interface ArtifactIdentity {
      type: string;
      via: 'header' | 'path';
      builtin: boolean;
      localOnly: boolean;
      featureId: string | null;
      header: ArtifactHeader | null;
    }

    // 函数
    export const BUILTIN_ARTIFACT_TYPES: readonly BuiltinArtifactType[];
    export function getBuiltinArtifactType(key: string): BuiltinArtifactType | undefined;
    export function isValidArtifactTypeKey(key: string): boolean;
    export function featureIdOf(projectRelPath: string): string | null;
    export function isTopLevelFeatureFile(projectRelPath: string): boolean;
    export function isPlanIndexPath(projectRelPath: string): boolean;
    export function classifyArtifactByPath(projectRelPath: string): string | null;
    export function readArtifactHeader(absPath: string): ArtifactHeader | null;   // 只认 .md / .html;读不了或扩展名不对返回 null
    export function readFirstH2Heading(absPath: string): string | null;
    export function identifyArtifact(projectRoot: string, projectRelPath: string): ArtifactIdentity | null;
    export function stageMilestoneOf(identity: ArtifactIdentity, projectRelPath: string): StageMilestone | null;
    export function firstScreenHeadingOf(identity: ArtifactIdentity, projectRelPath: string): string | null;
    export function reportableTypeKeys(tier: ReportTier): ReadonlySet<string>;
    export function specFingerprint(projectRoot: string, projectRelPath: string): string | null; // 40 位小写十六进制
    export function parseBasis(value: string): string | null;                     // 合法返回小写十六进制前缀
    export function basisMatches(prefix: string, fullHash: string): boolean;
    ```

    `projectRelPath` / `rel` 一律是项目相对 POSIX 路径(`/` 分隔,不以 `./` 开头)。
  - 模块只 import `node:` 内置模块,不得 import `src/core` 下的其他目录、`src/cli`、`src/web`。
  - 内置类型表与路径规则逐条照下文「具体要求」1、2,不增不减、不改顺序。
- 允许局部适配:
  - 内部辅助函数的命名与拆分;正则可以等价改写(每条规则匹配的集合不变)。
  - html 注释的提取方式。
- 具体要求:
  1. `BUILTIN_ARTIFACT_TYPES`(20 条,顺序即本表):

     | key | name | defaultPhase | minTier | requiresBasis | firstScreen |
     |---|---|---|---|---|---|
     | `spec` | 规格说明 | `design` | `'1.0'` | false | `{ heading: '一图看懂', planIndexOnly: false }` |
     | `wireframe` | 线框 | `design` | `'1.0'` | false | null |
     | `prd` | 需求文档 | `design` | `'1.2'` | true | null |
     | `design_doc` | 设计文档 | `design` | `'1.2'` | true | null |
     | `plan` | 实现计划 | `plan` | `'1.0'` | true | `{ heading: '设计预览', planIndexOnly: true }` |
     | `api_test_spec` | 接口测试规格 | `test` | `'1.0'` | true | null |
     | `api_test_report` | 接口测试报告 | `test` | `'1.0'` | true | null |
     | `unit_test_spec` | 单元测试规格 | `test` | `'1.0'` | true | null |
     | `unit_test_report` | 单元测试报告 | `test` | `'1.0'` | true | null |
     | `ui_test_spec` | UI 测试用例规格 | `test` | `'1.0'` | true | null |
     | `ui_test_report` | UI 测试报告 | `test` | `'1.0'` | true | null |
     | `release_record` | 发布记录 | `release` | `'1.3'` | false | null |
     | `knowledge` | 知识库 | `knowledge` | `'1.0'` | false | null |
     | `code_map` | 代码地图 | `knowledge` | `'1.0'` | false | null |
     | `design_map` | 设计地图 | `knowledge` | `'1.0'` | false | null |
     | `schema_knowledge` | 表结构知识 | `knowledge` | `'1.0'` | false | null |
     | `delivery_brief` | 交付讲解 | `delivery` | `'1.2'` | true | null |
     | `closure_record` | 收口档案 | `delivery` | `'1.2'` | true | null |
     | `api_doc` | 接口文档 | `delivery` | `'1.2'` | true | null |
     | `handoff` | 交接文件 | null | null | false | null |

  2. 路径规则,按序匹配、先命中先用(JS 正则字面量写法):

     ```text
     #   类型               正则
     1   ui_test_spec       /^docs\/features\/[^/]+\/ui功能测试\/[^/]*-ui功能测试-spec\.md$/
     2   ui_test_report     /^docs\/features\/[^/]+\/ui功能测试\/[^/]*-ui功能测试报告\.xlsx$/
     3   ui_test_report     /^docs\/features\/[^/]+\/ui功能测试\/[^/]*-ui功能测试报告\.md$/
     4   ui_test_report     /^docs\/features\/[^/]+\/ui功能测试\/[^/]*-ui功能测试结果\.json$/
     5   api_test_spec      /^docs\/features\/[^/]+\/[^/]*-接口测试-spec\.md$/
     6   api_test_spec      /^docs\/features\/[^/]+\/[^/]*-api-spec\.md$/
     7   api_test_report    /^docs\/features\/[^/]+\/[^/]*-接口测试报告\.md$/
     8   api_test_report    /^docs\/features\/[^/]+\/[^/]*-测试报告\.md$/
     9   api_test_report    /^docs\/features\/[^/]+\/[^/]*-接口测试验证\.jsonl$/
     10  unit_test_spec     /^docs\/features\/[^/]+\/[^/]*-单元测试-spec\.md$/
     11  unit_test_report   /^docs\/features\/[^/]+\/[^/]*-单元测试报告\.md$/
     12  spec               /^docs\/features\/[^/]+\/[^/]*-spec\.md$/
     13  spec               /^docs\/features\/[^/]+\/spec\.md$/
     14  plan               /^docs\/features\/[^/]+\/plan\/.+$/
     15  wireframe          /^docs\/features\/[^/]+\/[^/]*-线框-v\d+\.html$/
     16  prd                /^docs\/features\/[^/]+\/[^/]*-需求文档\.md$/
     17  design_doc         /^docs\/features\/[^/]+\/[^/]*-设计文档\.md$/
     18  design_doc         /^docs\/features\/[^/]+\/[^/]*-设计文档\.html$/
     19  api_doc            /^docs\/features\/[^/]+\/[^/]*-接口文档\.html$/
     20  delivery_brief     /^docs\/features\/[^/]+\/[^/]*-交付讲解\.md$/
     21  closure_record     /^docs\/features\/[^/]+\/[^/]*-收口档案\.md$/
     22  release_record     /^docs\/features\/[^/]+\/[^/]*-发布记录\.md$/
     23  handoff            /^docs\/features\/[^/]+\/[^/]*-交接提示词\.md$/
     24  knowledge          /^docs\/knowledge\/.+$/
     25  code_map           /^docs\/code-map\/.+$/
     26  design_map         /^docs\/design-map\/.+$/
     27  schema_knowledge   /^docs\/schema-knowledge\/.+$/
     ```

     `classifyArtifactByPath(rel)`:按上表顺序取第一条命中的类型,都不命中返回 null。`ui功能测试/` 下的截图不命中任何规则。
  3. 路径辅助函数:
     - `featureIdOf(rel)`:匹配 `/^docs\/features\/([^/]+)\/.+$/` 返回第 1 组,否则 null。
     - `isTopLevelFeatureFile(rel)`:匹配 `/^docs\/features\/[^/]+\/[^/]+$/`。
     - `isPlanIndexPath(rel)`:匹配 `/^docs\/features\/[^/]+\/plan\/(?:[^/]*-index|index)\.md$/`。
     - `isValidArtifactTypeKey(key)` = `ARTIFACT_TYPE_KEY_PATTERN.test(key)`。
  4. `readArtifactHeader(absPath)`:
     - 字段正则 `/^>\s*(产物|负责人|任务|依据)\s*[:：]\s*(.*?)\s*$/`;同一字段只取第一条;`产物` 的值去首尾空白后存 `typeRaw`(空值存 `''`);其余三项空值存 null。
     - `.md`(扩展名不区分大小写):读 UTF-8,去 BOM,按 `\r?\n` 分行。首行是 `---` 时跳过到下一个 `---` 行之后(找不到就不跳)。在接下来的 `HEADER_SCAN_LINES` 行内找第一个一级标题行(匹配 `/^#\s+\S/`,`##` 开头的不算);找不到 → 返回四个字段全为 null 的对象。找到后从下一行起逐行处理,最多再看 `HEADER_SCAN_LINES` 行:空行跳过;以 `>` 开头的行按字段正则解析;遇到其他行就停止。
     - `.html`:取文件前 `HEADER_SCAN_LINES` 行,找其中第一个在这些行内闭合、且注释内至少有一行能按字段正则解析的 `<!-- … -->` 注释;注释内每行去掉行首空白后解析。没有这样的注释 → 四个字段全为 null。
     - 其他扩展名、文件不存在或读取失败 → 返回 null。
  5. `readFirstH2Heading(absPath)`:只处理 `.md`;跳过开头的 frontmatter(同上);跳过 ``` 围起的代码块;返回第一行匹配 `/^##\s+(.+?)\s*#*\s*$/` 的第 1 组(`###` 不算,因为 `##` 后要紧跟空白);没有或读取失败 → null。
  6. `identifyArtifact(projectRoot, rel)`:

     ```text
     featureId = featureIdOf(rel)
     header = null
     若 featureId 非 null 且扩展名为 .md 或 .html:
       header = readArtifactHeader(path.join(projectRoot, ...rel.split('/')))
       若 header 非 null 且 header.typeRaw 非 null 且 isValidArtifactTypeKey(header.typeRaw):
         返回 { type: header.typeRaw, via: 'header', builtin, localOnly, featureId, header }
     type = classifyArtifactByPath(rel);type 为 null → 返回 null
     返回 { type, via: 'path', builtin, localOnly, featureId, header }
     其中 builtin = getBuiltinArtifactType(type) 存在;localOnly = builtin 且该类型 minTier 为 null
     ```

     按路径识别时也带上读到的 `header`(可能为 null,或 `typeRaw` 不合法),供校验使用。
  7. `stageMilestoneOf(identity, rel)`:
     - 类型为 `api_test_report`、`unit_test_report`、`ui_test_report` 之一,且扩展名为 `.md` 或 `.xlsx` → `'report'`(json、jsonl 不算)。
     - 类型为 `plan` 且 `isPlanIndexPath(rel)` → `'plan_index'`。
     - 类型为 `spec`、`api_test_spec`、`unit_test_spec` 之一,且 `isTopLevelFeatureFile(rel)` → `'spec_like'`。
     - 其他 → null。
  8. `firstScreenHeadingOf(identity, rel)`:取 `getBuiltinArtifactType(identity.type)?.firstScreen`;为 null → null;`planIndexOnly` 为 true 且 `!isPlanIndexPath(rel)` → null;否则返回 `heading`。
  9. `reportableTypeKeys(tier)`:`minTier` 非 null 且档位序号 ≤ `tier` 的类型集合,序号 `'1.0'`→0、`'1.2'`→1、`'1.3'`→2。结果数量:`'1.0'` 13 个、`'1.2'` 18 个、`'1.3'` 19 个。
  10. `specFingerprint(projectRoot, rel)`:文件不存在或不是普通文件 → null。先执行 `execFileSync('git', ['hash-object', '--', <rel 转本地分隔符>], { cwd: projectRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 })`,输出去空白后匹配 `/^[0-9a-f]{40}$/` 即返回;git 不存在、报错或超时 → 进程内计算 `sha1(Buffer.concat([Buffer.from('blob ' + 字节数 + '\0'), 文件内容]))` 的小写十六进制。
  11. `parseBasis(value)`:`BASIS_PATTERN.exec(value.trim())` 的第 1 组转小写,不匹配 → null。`basisMatches(prefix, fullHash)` = `fullHash.toLowerCase().startsWith(prefix.toLowerCase())`。
  12. 常量:`SEDIMENT_DIR_PREFIXES` 的顺序与 `SEDIMENT_TYPE_ROOTS` 一致(knowledge、schema-knowledge、code-map、design-map);`OWNER_SOURCE_TYPES` 用 `as const`;`ARTIFACT_MAPPING_VERSION = 2`。
  13. 文件划分:`types.ts` 放类型;`constants.ts` 放常量;`registry.ts` 放类型表、路径规则及要求 2、3、7、8、9;`header.ts` 放要求 4、5;`identify.ts` 放要求 6;`fingerprint.ts` 放要求 10、11;`index.ts` 只做 re-export。注释用中文,内置模块用 `node:` 前缀。
- 完成条件:
  - `npx tsc --noEmit` 通过;`npm test` 全绿。
  - `grep -rn "from '\.\./" src/core/artifact-registry/` 无输出。
  - 下文「验证方式」的三条命令都输出 `true`(第二条按说明核对)。
- 验证方式:
  - 先 `npm run build`。
  - 路径规则与集合:

    ```bash
    node -e "
    const r = require('./dist/core/artifact-registry');
    const c = r.classifyArtifactByPath;
    const ok = [
      c('docs/features/x/a-接口测试-spec.md') === 'api_test_spec',
      c('docs/features/x/a-api-spec.md') === 'api_test_spec',
      c('docs/features/x/a-spec.md') === 'spec',
      c('docs/features/x/spec.md') === 'spec',
      c('docs/features/x/a-测试报告.md') === 'api_test_report',
      c('docs/features/x/a-单元测试报告.md') === 'unit_test_report',
      c('docs/features/x/ui功能测试/a-ui功能测试报告.xlsx') === 'ui_test_report',
      c('docs/features/x/ui功能测试/01.png') === null,
      c('docs/features/x/a-交接提示词.md') === 'handoff',
      c('docs/features/x/plan/a-02-backend.md') === 'plan',
      r.isPlanIndexPath('docs/features/x/plan/a-index.md') === true,
      r.reportableTypeKeys('1.0').size === 13,
      r.reportableTypeKeys('1.2').size === 18,
      r.reportableTypeKeys('1.3').size === 19,
      r.parseBasis('spec@B1D787C') === 'b1d787c',
    ];
    console.log(ok.every(Boolean), ok);"
    ```

  - 用本需求的真实产物核对头部识别:

    ```bash
    node -e "
    const r = require('./dist/core/artifact-registry');
    const p = 'docs/features/2026-10-18-产物注册表与头部规范/';
    console.log(r.identifyArtifact(process.cwd(), p + '产物注册表与头部规范-spec.md'));
    console.log(r.identifyArtifact(process.cwd(), p + 'plan/产物注册表与头部规范-index.md'));
    console.log(r.readFirstH2Heading(p + 'plan/产物注册表与头部规范-index.md'));"
    ```

    期望:spec 为 `type: 'spec'`、`via: 'header'`、`header.owner: 'liulongfei'`;plan index 为 `type: 'plan'`、`via: 'header'`、`header.basis: 'spec@b2dd47f'`;首个二级标题为 `设计预览`。
  - 指纹与 git 一致:

    ```bash
    node -e "
    const r = require('./dist/core/artifact-registry');
    const f = 'docs/features/2026-10-18-产物注册表与头部规范/产物注册表与头部规范-spec.md';
    const git = require('node:child_process').execFileSync('git', ['hash-object', f]).toString().trim();
    console.log(r.specFingerprint(process.cwd(), f) === git);"
    ```

- 独立提交:是。完成后仓库可编译、测试不红,注册表暂无调用方。提交主题 `feat(artifact-registry): 产物注册表——内置类型、路径规则、头部解析与 spec 指纹`。
- 风险/注意事项:
  - 测试规格规则必须排在 `spec` 之前;`-接口测试报告.md` 与旧名 `-测试报告.md` 都要认。
  - 只认一级标题之后紧接的引用行,正文代码块里的示例头部不会被读成头部。
  - 行尾可能是 `\r\n`,分行时一并处理。

---

### T-2: 本地口径改读注册表(features 阶段派生、主 spec 与负责人、task 产出分组)

- 目标:features 的阶段派生、主 spec 认定、负责人与任务读取,以及 web 开发任务页的产出分组,都改为经注册表识别产物;负责人口径收为「主 spec → 交接文件」。
- 对应 spec 条款:§3.4、§4.1(字段读取范围)、§5、§10、§13(`features list`、web 开发任务页)
- 强制引用:`docs/guides/coding-standards.md`
- 依赖:T-1
- 涉及范围:`src/core/features/scanner.ts`、`src/core/features/index.ts`(只在必要时调整导出,不新增)、`src/core/task/artifacts.ts`、`__tests__/core/features/scanner.test.ts`(只改具体要求 8 指定的一条用例)。
- 必须严格执行:
  - 使用注册表门面的以下导出(契约 C-1 原文节选),从 `../artifact-registry` 引入:

    ```ts
    export const FEATURES_DIR_POSIX = 'docs/features';
    export const SEDIMENT_TYPE_ROOTS: Readonly<{
      knowledge: 'docs/knowledge/';
      schema_knowledge: 'docs/schema-knowledge/';
      code_map: 'docs/code-map/';
      design_map: 'docs/design-map/';
    }>;
    export const OWNER_SOURCE_TYPES: readonly ['spec', 'handoff'];
    export type StageMilestone = 'spec_like' | 'plan_index' | 'report';
    export interface ArtifactHeader {
      typeRaw: string | null;  // `> 产物:` 去首尾空白后的原值;没有该行为 null;空值为 ''
      owner: string | null;    // 空值记 null,下同
      task: string | null;
      basis: string | null;
    }
    export interface ArtifactIdentity {
      type: string;
      via: 'header' | 'path';
      builtin: boolean;
      localOnly: boolean;
      featureId: string | null;
      header: ArtifactHeader | null;
    }
    export function isTopLevelFeatureFile(projectRelPath: string): boolean;
    export function readArtifactHeader(absPath: string): ArtifactHeader | null;   // 只认 .md / .html;读不了或扩展名不对返回 null
    export function identifyArtifact(projectRoot: string, projectRelPath: string): ArtifactIdentity | null;
    export function stageMilestoneOf(identity: ArtifactIdentity, projectRelPath: string): StageMilestone | null;
    ```

  - 在 `scanner.ts` 导出以下函数,签名一字不改(契约 C-2 原文):

    ```ts
    export function listFeatureFiles(projectRoot: string, featureId: string): string[];      // 目录下全部普通文件,项目相对 POSIX 路径,递归,升序;目录不存在 → []
    export function findMainSpecRel(projectRoot: string, featureId: string): string | null;  // spec §5 主 spec 认定,返回项目相对 POSIX 路径
    export function deriveFeatureStage(projectRoot: string, featureId: string): FeatureStage | null;
    export function readFeatureOwner(projectRoot: string, featureId: string): string | null; // 签名不变,口径改为 spec §5
    export function readFeatureTask(projectRoot: string, featureId: string): string | null;  // 签名不变
    ```

  - 头部没有 `> 产物:` 行的旧文件,负责人、日期、任务的读取沿用现有 `readHeaderMeta` 与任务行读取逻辑,行为一字不改(现状:负责人、日期取前 30 行内最后一条,任务取第一条;这就是 spec §4.1 说的「取值规则不变」,照旧即可,不算 PLAN_CONFLICT)。
  - `classifyArtifactPath` 对任何输入的返回值与改前一致。
- 允许局部适配:
  - 辅助函数命名;同一次扫描内缓存识别结果。
- 具体要求:
  1. `listFeatureFiles`:沿用 `isPlainFeatureId` 防护;递归列出 `docs/features/<featureId>/` 下全部普通文件(不跟随符号链接),返回项目相对 POSIX 路径,升序。
  2. 新增内部函数:
     - `ownerOf(projectRoot, rel)`:`header = readArtifactHeader(绝对路径)`;`header` 非 null 且 `header.typeRaw` 非 null → 返回 `header.owner`;否则返回 `readHeaderMeta(绝对路径).owner`。
     - `taskOf(projectRoot, rel)`:同理,有 `> 产物:` 时取 `header.task`;否则走现有逻辑(前 30 行内第一条 `> 任务:` 行,空值视为 null)。
  3. `findMainSpecRel`:候选 = `listFeatureFiles` 中满足 `isTopLevelFeatureFile` 且 `identifyArtifact(...)?.type === 'spec'` 的文件;按文件名用现有 `compareSpecCandidates` 排序;返回第一个 `ownerOf` 非 null 的;都为 null 返回第一个;没有候选返回 null。
  4. `readFeatureOwner`:负责人来源的先后取自 `OWNER_SOURCE_TYPES`(`spec` → `handoff`),不另写顺序。主 spec 存在且 `ownerOf` 非 null → 返回它;否则取顶层类型为 `handoff` 的文件,按 `compareSpecCandidates` 排序取第一个,返回其 `ownerOf`(可以是 null);没有交接文件 → null。
  5. `readFeatureTask`:主 spec 的 `taskOf`;没有主 spec → null。
  6. `deriveFeatureStage`:对 `listFeatureFiles` 的每个文件取 `identifyArtifact` 与 `stageMilestoneOf`;有 `report` → `'已验证'`;否则有 `plan_index` → `'已规划'`;否则有 `spec_like` → `'已规格'`;都没有 → null。
  7. `scanFeatures`:
     - 负责人 = `readFeatureOwner(projectRoot, name)`,去掉现在的 `?? meta.owner` 兜底。
     - 日期 = 元数据文件的 `readHeaderMeta(...).date ?? dateFromName`;元数据文件改为「`findMainSpecRel` 的结果 → plan 目录下的 index 文件(沿用现有选取规则)」,日期读取逻辑不变。
     - 阶段 = `deriveFeatureStage`。
     - 删除不再使用的 `hasPlanIndex`、`hasUiTestReport`、`deriveStage`、`findMainSpec`(以目录为参数的旧版)。
     - `FEATURES_DIR` 保留导出,值改为 `path.join(...FEATURES_DIR_POSIX.split('/'))`。
     - 文件头注释改写为新口径(负责人只认主 spec → 交接文件;产物识别经注册表)。
  8. `__tests__/core/features/scanner.test.ts`:用例 `falls back to plan index header when no spec exists (stage 已规划)` 改为:标题 `owner is null when only plan index declares it (stage 已规划)`,断言 `owner: null`、`stage: '已规划'`。其余用例不改。
  9. `src/core/task/artifacts.ts` 的 `classifyArtifactPath`,判定顺序与返回值不变,只把目录字面量换成注册表常量:
     - `relPath.startsWith(FEATURES_DIR_POSIX + '/')` → `'feature-doc'`
     - `relPath.startsWith(SEDIMENT_TYPE_ROOTS.knowledge)` → `'knowledge'`
     - `relPath.startsWith(SEDIMENT_TYPE_ROOTS.schema_knowledge)` 或以 `.sql` 结尾 → `'schema'`
     - `relPath.startsWith(SEDIMENT_TYPE_ROOTS.code_map)` 或 `startsWith(SEDIMENT_TYPE_ROOTS.design_map)` → `'diagram'`
     - `relPath.startsWith('docs/bruno/')` → `'api-test'`(保持原样)
     - 其余 → `'code'`
- 完成条件:
  - `npx tsc --noEmit` 通过;`npm test` 全绿(含改过的那条用例)。
  - 本仓库 `features list` 的输出与改前一致(见验证方式)。
- 验证方式:
  - 改代码前:`npm run build && node dist/cli/index.js features list --json > /tmp/features-before.json && node dist/cli/index.js features list --mine > /tmp/features-mine-before.txt`。
  - 改完后:`npm run build && node dist/cli/index.js features list --json > /tmp/features-after.json && node dist/cli/index.js features list --mine > /tmp/features-mine-after.txt`。
  - `diff /tmp/features-before.json /tmp/features-after.json` 与 `diff /tmp/features-mine-before.txt /tmp/features-mine-after.txt` 都无输出。
- 独立提交:是。完成后 features 与 task 只经注册表认产物,仓库可编译、测试不红。提交主题 `feat(features): 阶段派生与负责人口径改读产物注册表`。
- 风险/注意事项:
  - 其他接入项目里只有 plan、没有主 spec 和交接文件的目录,负责人会变成 `-`(spec §5 已定)。
  - 递归扫描后,头部声明为测试报告的 md 放在子目录里也会计入「已验证」(spec §10 允许)。

---

### T-3: 上报内容构造改读注册表(档位、可上报集合、任务键、未上报产出)

- 目标:平台上报的产出类型改为经注册表识别;按服务端档位只发送可上报类型,集合外的记为未上报;1.2 起产出带任务键;建立本项目类型表缓存的读写,供 T-4、T-5 使用。
- 对应 spec 条款:§3.2(上报列)、§3.3、§11.1、§11.2、§11.5、§11.7
- 强制引用:`docs/guides/coding-standards.md`、`docs/guides/data-standards.md`
- 依赖:T-1
- 涉及范围:修改 `src/core/sync/types.ts`、`version.ts`、`artifacts.ts`、`payload.ts`、`constants.ts`、`store.ts`、`schema.sql`(只改注释)、`runner.ts` 与 `status.ts`(只改构造上下文的调用处)、`index.ts`;新建 `src/core/sync/platform-spec.ts`。
- 必须严格执行:
  - 使用注册表门面的以下导出(契约 C-1 原文节选),从 `../artifact-registry` 引入:

    ```ts
    export const SEDIMENT_DIR_PREFIXES: readonly ['docs/knowledge/', 'docs/schema-knowledge/', 'docs/code-map/', 'docs/design-map/'];
    export type ArtifactPhase = 'design' | 'plan' | 'test' | 'release' | 'knowledge' | 'delivery';
    export type ReportTier = '1.0' | '1.2' | '1.3';
    export interface BuiltinArtifactType {
      key: string;
      name: string;
      defaultPhase: ArtifactPhase | null;   // handoff 为 null
      minTier: ReportTier | null;           // handoff 为 null:本地专用,不上报
      requiresBasis: boolean;
      firstScreen: { heading: string; planIndexOnly: boolean } | null;
    }
    export interface ArtifactHeader {
      typeRaw: string | null;  // `> 产物:` 去首尾空白后的原值;没有该行为 null;空值为 ''
      owner: string | null;    // 空值记 null,下同
      task: string | null;
      basis: string | null;
    }
    export interface ArtifactIdentity {
      type: string;
      via: 'header' | 'path';
      builtin: boolean;
      localOnly: boolean;
      featureId: string | null;
      header: ArtifactHeader | null;
    }
    export function getBuiltinArtifactType(key: string): BuiltinArtifactType | undefined;
    export function identifyArtifact(projectRoot: string, projectRelPath: string): ArtifactIdentity | null;
    export function reportableTypeKeys(tier: ReportTier): ReadonlySet<string>;
    ```

    `reportableTypesFor` 判断本地专用类型用 `getBuiltinArtifactType(key)?.minTier === null`。
  - 产出以下契约,签名一字不改(契约 C-3 原文):

    ```ts
    // src/core/sync/version.ts
    export type ServerTier = '1.0' | '1.1' | '1.2' | '1.3';
    export function serverTier(version: string | null): ServerTier;
    // protocolAtLeast(v,'1.3') → '1.3';≥ '1.2' → '1.2';≥ '1.1' → '1.1';其余(含 null、不合法)→ '1.0'

    // src/core/sync/types.ts
    export const ARTIFACT_TASK_KEY_PROTOCOL_VERSION = '1.2';
    export const PROJECT_SPEC_PROTOCOL_VERSION = '1.3';
    export type ArtifactType = string;
    export interface IngestArtifact {
      type: string; path: string; action: 'create' | 'modify';
      commitHash: string | null; branch: string | null; ts: string;
      taskKey?: string;
    }
    // IngestWarning 联合类型新增:{ kind: 'artifact_type_unknown'; path: string; type: string }
    export interface UnreportedArtifact { type: string; path: string } // path 为仓库相对路径

    // src/core/sync/artifacts.ts
    export function reportableTypesFor(tier: ServerTier, projectTypes: readonly string[] | null): ReadonlySet<string>;
    // '1.0' | '1.1' → reportableTypeKeys('1.0');'1.2' → reportableTypeKeys('1.2');
    // '1.3' → projectTypes !== null ? new Set(projectTypes) 去掉本地专用类型 : reportableTypeKeys('1.3')

    // src/core/sync/payload.ts
    export interface SyncContext {
      /* 既有字段不变,另有: */
      tier: ServerTier;
      supportsTaskKey: boolean;              // tier !== '1.0'
      allowedTypes: ReadonlySet<string>;     // reportableTypesFor(tier, projectTypes)
      reevaluateAll: boolean;                // createSyncContext 恒置 false,由 runner 改写
    }
    export async function createSyncContext(
      projectRoot: string,
      opts?: { tier?: ServerTier; projectTypes?: readonly string[] | null },  // 缺省 tier '1.0'、projectTypes null
    ): Promise<SyncContext>;
    export interface BuiltSession { /* 既有字段不变,另有: */ unreported: UnreportedArtifact[] }
    ```

  - 产出以下契约,签名一字不改(契约 C-4 原文):

    ```ts
    // src/core/sync/types.ts
    export interface PlatformSpecCache {
      fetchedAt: string;
      artifactTypes: Array<{ key: string; name: string; phase: string }>;
    }
    // src/core/sync/store.ts —— sync_state 键 'platform_spec'
    export function getPlatformSpec(db: SqliteDatabase): PlatformSpecCache | null;
    export function setPlatformSpec(db: SqliteDatabase, cache: PlatformSpecCache, now: string): void;
    // src/core/sync/platform-spec.ts,并由 src/core/sync/index.ts 导出
    export function readCachedProjectArtifactTypes(projectRoot: string): string[] | null; // 未初始化 / 无缓存 / 任何异常 → null,绝不抛
    ```

  - 档位 `'1.0'`、`'1.1'` 的可上报集合只能是 13 个基础类型;本地专用类型(`identity.localOnly`)在任何档位都不进可上报集合,也不记为未上报。
  - 上报对象仍逐字段正向构造;新增上报字段只有 `taskKey`。
  - 不改候选判定、哈希、任务声明、批次与失败处理逻辑(那些归 T-5 或保持不变)。
- 允许局部适配:
  - 同一轮内按路径缓存 `identifyArtifact` 的结果;内部辅助函数。
- 具体要求:
  1. `types.ts`:`ArtifactType` 改为 `string` 别名;删除 `ARTIFACT_TYPES` 常量;`IngestArtifact` 加可选 `taskKey`;`IngestWarning` 加 `artifact_type_unknown` 一支;新增 `ARTIFACT_TASK_KEY_PROTOCOL_VERSION`、`PROJECT_SPEC_PROTOCOL_VERSION`、`UnreportedArtifact`、`PlatformSpecCache`;文件头「镜像契约 v1」的说明补一句「产出 type 放宽为字符串(服务端自契约 0.3.0 起按字符串接收)」。
  2. `version.ts`:新增 `ServerTier` 与 `serverTier`,用已有的 `protocolAtLeast` 与 `TASK_KEY_PROTOCOL_VERSION` 及上面两个新常量比较。
  3. `artifacts.ts`:
     - 删除 `ARTIFACT_RULES` 与 `classifyArtifactType`;文件头注释改为「类型识别经产物注册表」,删去「与 `src/core/task/artifacts.ts` 相互独立,不得互相引用」一句。
     - 新增 `reportableTypesFor`(契约见上)。
     - `collectSessionArtifacts` 返回 `{ artifacts: IngestArtifact[]; outputPaths: Set<string>; unreported: UnreportedArtifact[] }`。对每个候选(收集方式与 `outputPaths` 口径不变):
       a. `identity = identifyArtifact(ctx.projectRoot, projectRel)`;为 null 或 `identity.localOnly` → 跳过。
       b. 按现有逻辑匹配 commit;没有 commit 且文件已不存在 → 跳过(现行规则)。
       c. `identity.type` 不在 `ctx.allowedTypes` → 追加 `{ type: identity.type, path: repoRel }` 到 `unreported`,不进 `artifacts`。
       d. 否则按现有字段构造 `IngestArtifact`,`type = identity.type`;`ctx.tier` 为 `'1.2'` 或 `'1.3'` 且 `identity.featureId` 非 null 时加 `taskKey: identity.featureId`。
  4. `payload.ts`:`SyncContext` 加 `tier`、`allowedTypes`、`reevaluateAll`,`supportsTaskKey` 改由 `tier !== '1.0'` 得出;`createSyncContext` 换成新签名;`BuiltSession` 加 `unreported`;`buildSessionPayload`、`buildTerminalPayload` 把 `collectSessionArtifacts` 返回的 `unreported` 放进结果(`finish` 相应加参)。`bindingsHashOf`、`extrasHashOf`、`taskDeclarationsFor` 不改。
  5. `constants.ts`:`SEDIMENT_DIRS` 改为 `export const SEDIMENT_DIRS = SEDIMENT_DIR_PREFIXES;`(值与顺序不变,门面导出名不变)。
  6. `store.ts`:`StateKey` 加 `'platform_spec'`;新增 `getPlatformSpec` / `setPlatformSpec`。读出的 JSON 不是对象或 `artifactTypes` 不是数组 → null;缺 `key` 的项丢弃。`schema.sql` 中 `sync_state` 的注释改为「允许 connection / status / platform_spec / warnings / basis 五个键」,只改注释,不改 DDL。
  7. `platform-spec.ts`(新建):`readCachedProjectArtifactTypes(projectRoot)`:`isInitialized(projectRoot)` 为 false → null;开库 → `getPlatformSpec` → 关库;返回各项 `key`;任何异常 → null。
  8. `runner.ts`:只改构造上下文那一处:`const tier = serverTier(status.serverProtocolVersion);`,`ctx = await createSyncContext(projectRoot, { tier, projectTypes: null });`;删掉不再使用的局部变量与 import。其余逻辑不动。
  9. `status.ts`:同样改为 `createSyncContext(projectRoot, { tier, projectTypes: null })`;构造失败时的兜底判定对象中 `supportsTaskKey` 改为 `tier !== '1.0'`。
  10. `index.ts`:删除 `ARTIFACT_TYPES` 导出;新增导出 `serverTier`、`readCachedProjectArtifactTypes`、`ARTIFACT_TASK_KEY_PROTOCOL_VERSION`、`PROJECT_SPEC_PROTOCOL_VERSION`,类型 `ServerTier`、`UnreportedArtifact`、`PlatformSpecCache`。
- 完成条件:
  - `npx tsc --noEmit` 通过;`npm test` 全绿(含 `__tests__/core/sync/protocol-version.test.ts`)。
  - `grep -rnwE "ARTIFACT_RULES|classifyArtifactType|ARTIFACT_TYPES" src/core/sync/` 无输出(整词匹配,只查 sync;注册表的 `BUILTIN_ARTIFACT_TYPES` 不受影响)。
  - 「验证方式」的命令输出 `true`;`node dist/cli/index.js sync status` 在本仓库正常输出(不联网)。
- 验证方式:

  ```bash
  npm run build && node -e "
  const a = require('./dist/core/sync/artifacts');
  const ok = [
    a.reportableTypesFor('1.1', null).size === 13,
    a.reportableTypesFor('1.2', null).size === 18,
    a.reportableTypesFor('1.3', null).size === 19,
    a.reportableTypesFor('1.3', ['spec', 'review_record']).has('review_record'),
    !a.reportableTypesFor('1.3', ['spec', 'handoff']).has('handoff'),
  ];
  console.log(ok.every(Boolean), ok);"
  ```

- 独立提交:是。完成后上报已按档位过滤并带任务键,仓库可编译、测试不红。提交主题 `feat(sync): 上报产物改读注册表——按服务端档位过滤类型 + 产出带任务键`。
- 风险/注意事项:
  - 本任务提交后、T-5 完成前,没有新事件的已上报会话不会按新映射重新评估,属预期;不要为此在本任务里改候选判定。
  - 1.1 档绝不能放出新类型,否则整批 `validation_failed`、会话被隔离。

---

### T-4: 新命令 `features show` / `features check` 与组合根注入

- 目标:新增 `cgraphx features show <feature-id>`(一个产出目录的全貌)与 `cgraphx features check [目标...]`(新产物头部与首屏校验);组合根把本项目类型表的读取注入 features 命令。
- 对应 spec 条款:§6.2、§6.3、§7、§8、§9、§14(show / check 相关行)
- 强制引用:`docs/guides/coding-standards.md`、`docs/guides/interface-standards.md`
- 依赖:T-1、T-2、T-3
- 涉及范围:新建 `src/core/features/show.ts`、`check.ts`、`errors.ts`;修改 `src/core/features/cli.ts`、`types.ts`、`index.ts`;`src/cli/index.ts` 只改 `registerFeaturesCommands(program)` 这一行与对应 import。
- 必须严格执行:
  - 使用注册表门面的以下导出(契约 C-1 原文节选),从 `../artifact-registry` 引入:

    ```ts
    export const FEATURES_DIR_POSIX = 'docs/features';
    export const TASK_VALUE_PATTERN: RegExp;        // /^T-\d+$/
    export type ArtifactPhase = 'design' | 'plan' | 'test' | 'release' | 'knowledge' | 'delivery';
    export type ReportTier = '1.0' | '1.2' | '1.3';
    export interface BuiltinArtifactType {
      key: string;
      name: string;
      defaultPhase: ArtifactPhase | null;   // handoff 为 null
      minTier: ReportTier | null;           // handoff 为 null:本地专用,不上报
      requiresBasis: boolean;
      firstScreen: { heading: string; planIndexOnly: boolean } | null;
    }
    export interface ArtifactHeader {
      typeRaw: string | null;  // `> 产物:` 去首尾空白后的原值;没有该行为 null;空值为 ''
      owner: string | null;    // 空值记 null,下同
      task: string | null;
      basis: string | null;
    }
    export interface ArtifactIdentity {
      type: string;
      via: 'header' | 'path';
      builtin: boolean;
      localOnly: boolean;
      featureId: string | null;
      header: ArtifactHeader | null;
    }
    export function getBuiltinArtifactType(key: string): BuiltinArtifactType | undefined;
    export function isValidArtifactTypeKey(key: string): boolean;
    export function classifyArtifactByPath(projectRelPath: string): string | null;
    export function readArtifactHeader(absPath: string): ArtifactHeader | null;   // 只认 .md / .html;读不了或扩展名不对返回 null
    export function readFirstH2Heading(absPath: string): string | null;
    export function identifyArtifact(projectRoot: string, projectRelPath: string): ArtifactIdentity | null;
    export function firstScreenHeadingOf(identity: ArtifactIdentity, projectRelPath: string): string | null;
    export function specFingerprint(projectRoot: string, projectRelPath: string): string | null; // 40 位小写十六进制
    export function parseBasis(value: string): string | null;                     // 合法返回小写十六进制前缀
    export function basisMatches(prefix: string, fullHash: string): boolean;
    ```

  - 使用 `src/core/features/scanner.ts` 的以下函数(契约 C-2 原文):

    ```ts
    export function listFeatureFiles(projectRoot: string, featureId: string): string[];      // 目录下全部普通文件,项目相对 POSIX 路径,递归,升序;目录不存在 → []
    export function findMainSpecRel(projectRoot: string, featureId: string): string | null;  // spec §5 主 spec 认定,返回项目相对 POSIX 路径
    export function deriveFeatureStage(projectRoot: string, featureId: string): FeatureStage | null;
    export function readFeatureOwner(projectRoot: string, featureId: string): string | null; // 签名不变,口径改为 spec §5
    export function readFeatureTask(projectRoot: string, featureId: string): string | null;  // 签名不变
    ```

  - 使用 sync 门面的(契约 C-4 原文节选):

    ```ts
    export function readCachedProjectArtifactTypes(projectRoot: string): string[] | null; // 未初始化 / 无缓存 / 任何异常 → null,绝不抛
    ```

  - 产出(契约 C-5 原文):

    ```ts
    // src/core/features/cli.ts
    export interface FeaturesCommandDeps {
      readProjectArtifactTypes?: (projectRoot: string) => readonly string[] | null;
    }
    export function registerFeaturesCommands(program: Command, deps?: FeaturesCommandDeps): void;
    // src/cli/index.ts
    registerFeaturesCommands(program, { readProjectArtifactTypes: readCachedProjectArtifactTypes });
    ```

  - 产出 `features check --json` 结构(契约 C-7 原文):

    ```ts
    type CheckCode =
      | 'missing_type' | 'invalid_type' | 'missing_owner' | 'missing_basis' | 'invalid_basis'
      | 'invalid_task' | 'first_screen' | 'stale' | 'unknown_type' | 'type_path_mismatch';
    interface CheckFinding { level: 'fail' | 'warn'; path: string; code: CheckCode; message: string; fix: string | null } // path 为项目相对 POSIX 路径
    interface CheckReport { ok: boolean; checkedFiles: number; failures: number; warnings: number; findings: CheckFinding[] }
    ```

    退出码:有失败 1;只有警告或全部通过 0;目标指向的目录或文件不存在 2。
  - `features show` 找不到需求目录或命中多个时退出码 2。错误类到退出码的映射走 `exitCodeForError`,check 结果走 `exitCodeForCheckReport`,不在 action 里散写数字。
  - stderr 消息带 `[features]` 前缀;show、check 只读不写任何文件。
- 允许局部适配:
  - `cli.ts` 超过 600 行时把渲染函数拆到 `src/core/features/render.ts`。
  - 按目录缓存主 spec 与指纹;git 调用的封装方式。
- 具体要求:
  1. `types.ts` 新增(`CheckCode`、`CheckFinding`、`CheckReport` 按 C-7 原文导出):

     ```ts
     export type BasisState =
       | { kind: 'fresh' }
       | { kind: 'stale'; recorded: string; current: string }  // 各取前 7 位
       | { kind: 'no_main_spec' }
       | { kind: 'invalid' }
       | { kind: 'none' };
     export interface FeatureArtifactRow { path: string; type: string; typeName: string | null; via: 'header' | 'path'; basis: BasisState } // path 为产出目录内相对路径
     export type FeaturePhase = 'design' | 'plan' | 'test' | 'release' | 'delivery';
     export interface FeaturePhaseRow { phase: FeaturePhase; name: string; paths: string[]; required: boolean }
     export interface FeatureDetail {
       featureId: string;
       path: string;                    // docs/features/<featureId>
       owner: string | null;
       task: string | null;
       stage: FeatureStage | null;
       mainSpec: string | null;         // 产出目录内相对路径
       specFingerprint: string | null;  // 前 7 位
       artifacts: FeatureArtifactRow[];
       phases: FeaturePhaseRow[];
       customTypes: Array<{ type: string; paths: string[] }>;
       otherFiles: string[];            // 产出目录内相对路径
     }
     ```

  2. `errors.ts`:`FeaturesError`(继承 `Error`);`FeatureNotFoundError`(消息 `找不到需求目录「<query>」,用 cgraphx features list --q <关键词> 查找`);`FeatureAmbiguousError`(带 `candidates: string[]`,消息列出全部候选);`CheckTargetNotFoundError`(消息 `目标不存在:<target>;请传 feature-id,或 docs/features/ 下的文件、目录路径`)。`exitCodeForError(err)`:以上三类 → 2,其他 → 1。`exitCodeForCheckReport(report)`:`report.failures > 0 ? 1 : 0`。
  3. `show.ts`:
     - `resolveFeatureId(projectRoot, query)`:列出 `docs/features/` 下的子目录名;有与 `query` 相等的 → 它;否则取名字包含 `query` 的:唯一 → 它;没有 → `FeatureNotFoundError`;多个 → `FeatureAmbiguousError`(候选升序)。
     - `showFeature(projectRoot, query): FeatureDetail`:
       a. `id = resolveFeatureId(...)`;`files = listFeatureFiles`;`mainSpec = findMainSpecRel`;`fp = mainSpec 非 null ? specFingerprint(projectRoot, mainSpec) : null`。
       b. 每个文件 `identifyArtifact`:null → 进 `otherFiles`;否则生成产物行:`typeName` 取内置类型的 `name`(非内置为 null);依据状态:头部没有 `> 产物:`(`header?.typeRaw` 为 null,即旧产物,spec §4.3 不参与过期判定)或 `header.basis` 为 null → `none`;`parseBasis` 为 null → `invalid`;`fp` 为 null → `no_main_spec`;`basisMatches` → `fresh`;否则 `stale`(`recorded` 取前缀前 7 位,`current` 取 `fp` 前 7 位)。
       c. `phases` 固定 5 行,依次为 design 设计、plan 规划、test 测试、release 发布、delivery 交付文档;`paths` 为内置、非本地专用、`defaultPhase` 等于该环节的产物路径;`required` 在 design、test 两行为 true。`defaultPhase` 为 knowledge 的产物只出现在产物列表里。
       d. `customTypes`:非内置类型的产物按类型分组。
       e. `owner = readFeatureOwner`;`task = readFeatureTask`;`stage = deriveFeatureStage`。
  4. `check.ts`:`checkFeatures(projectRoot: string, targets: string[], opts: { projectTypes?: readonly string[] | null } = {}): CheckReport`
     a. 确定文件集:`targets` 为空 → 全部产出目录的全部文件。每个目标:`docs/features/<目标>` 是目录 → 该目录全部文件;否则按路径解析(相对路径基于 `process.cwd()`,再换算成项目相对 POSIX 路径):是 `docs/features/<id>/` 内的文件 → 该文件;是 `docs/features/` 内的目录 → 其下全部文件;路径存在但在产出目录外(文件或目录)→ 忽略,不报错;路径不存在 → `CheckTargetNotFoundError`。
     b. HEAD 文件集:在项目根执行 `git rev-parse --is-inside-work-tree`,失败 → `headSet = null`(不在 git 仓库);否则执行 `git ls-tree -r -z --name-only HEAD -- docs/features`(cwd 为项目根,输出即项目相对路径,按 `\0` 切分),该命令失败(如还没有任何提交)→ `headSet` 为空集。
     c. 只看 `.md`、`.html` 文件:`identity = identifyArtifact(...)`;`header = identity?.header ?? readArtifactHeader(绝对路径)`;`typeRaw = header?.typeRaw ?? null`;`isNew = headSet !== null && !headSet.has(rel)`。以下情况整体跳过,不计入 `checkedFiles`、不出任何结果:`identity` 为 null 且 `typeRaw` 为 null(不是产物);`!isNew` 且 `typeRaw` 为 null(HEAD 里已有的旧产物,spec §9「不查」;不在 git 仓库时同样适用)。其余计入 `checkedFiles`。
     d. `mainSpec` = 该目录的 `findMainSpecRel`;`isMain = rel === mainSpec`;`fp7` = 主 spec 指纹前 7 位。
     e. 新产物(`isNew`)的失败项:
        - `typeRaw` 为 null → `missing_type`,改法「补 `> 产物: <identity.type>`」(走到这里 `identity` 必然非 null)。
        - `typeRaw` 非 null 但不合法 → `invalid_type`,改法:`classifyArtifactByPath(rel)` 非 null 时「改为 `> 产物: <它>`」,否则「改为由小写字母、数字、下划线组成的类型标识」。
        - (`isMain` 或 `identity?.type === 'handoff'`)且 `header.owner` 为 null → `missing_owner`,改法「补 `> 负责人: <git config user.name 的值>`」(取不到写 `<你的 git user.name>`)。
        - `identity` 为内置类型且 `requiresBasis` 为 true,且 `mainSpec` 非 null:`header.basis` 为 null → `missing_basis`,改法「补 `> 依据: spec@<fp7>`」;`parseBasis` 为 null → `invalid_basis`,改法「依据改为 `spec@<fp7>`」。
        - `isMain` 且 `header.task` 非 null 且不匹配 `TASK_VALUE_PATTERN` → `invalid_task`,改法「改为平台任务编号 `T-<n>`;不关联平台任务就删掉这一行」。
        - `heading = firstScreenHeadingOf(identity, rel)` 非 null 且 `readFirstH2Heading(绝对路径) !== heading` → `first_screen`,改法「首个二级标题改为「<heading>」」。
     f. HEAD 里已有、且 `typeRaw` 非 null 的文件的失败项:`typeRaw` 不合法 → `invalid_type`;`header.basis` 非 null 且 `parseBasis` 为 null → `invalid_basis`;`isMain` 且 `task` 非 null 且不合法 → `invalid_task`。
     g. 警告:对进入校验、且 `typeRaw` 非 null 的文件判定(新产物与 HEAD 里已有的都查);不在 git 仓库(`headSet === null`)时 spec §9 只查字段格式,不出警告。
        - `header.basis` 合法、`mainSpec` 非 null、且 `!basisMatches` → `stale`,消息「过期:spec 已变(<记录前 7 位> → <fp7>)」,改法「复核后依据改为 `spec@<fp7>`」。
        - `identity.via === 'header'` 且 `!identity.builtin`,且 `opts.projectTypes` 为 null 或不含该类型 → `unknown_type`,消息「未知类型 <type>:不是内置类型」,`projectTypes` 非 null 时再加「,也不在本项目类型表」;改法「改用内置类型标识;确需自定义类型,请项目管理员在平台配置 `<type>`」。
        - `identity.via === 'header'` 且 `classifyArtifactByPath(rel)` 非 null 且与 `identity.type` 不同 → `type_path_mismatch`,消息「头部类型 <type> 与文件名规则(<路径类型>)不一致」;改法「确认类型;应为 `<路径类型>` 时改为 `> 产物: <路径类型>`」。
        - 每条结果都给出改法(spec §9);`fix` 的类型保留 `string | null` 只为兼容 C-7,本需求不产生 null。
     h. 各失败项的消息:`missing_type`「缺少 `> 产物:`」;`invalid_type`「`> 产物:` 的值不合法:<typeRaw>」;`missing_owner`「缺少 `> 负责人:`」;`missing_basis`「缺少 `> 依据:`」;`invalid_basis`「`> 依据:` 格式不对:<basis>」;`invalid_task`「`> 任务:` 不是平台任务编号:<task>」;`first_screen`「首个二级标题不是「<heading>」」。
     i. `findings` 按 `path` 升序,同一路径失败在前;`ok = failures === 0`。
  5. `cli.ts`:
     - `registerFeaturesCommands(program, deps: FeaturesCommandDeps = {})`;`list`、`sync` 不变。
     - `features show <feature-id> [project-path]`,选项 `--json`:项目根 = `project-path` 或 `resolveProjectRoot(process.cwd())`;`--json` 输出 `FeatureDetail`;文本格式见下;异常 → stderr `[features] <消息>`,`process.exitCode = exitCodeForError(err)`。
     - `features check [targets...]`,选项 `--json`:项目根 = `resolveProjectRoot(process.cwd())`;`projectTypes = deps.readProjectArtifactTypes?.(projectRoot) ?? null`;`--json` 输出 `CheckReport`;文本格式见下;`process.exitCode = exitCodeForCheckReport(report)`;异常同 show。
     - show 文本(对齐沿用 `cli.ts` 已有的 `displayWidth` / `padEnd`;没有任务时不输出「任务」行;阶段为 null 显示 `-`;没有主 spec 时指纹位置显示「无主 spec」;没有自定义类型时省略「项目自定义类型」一行;四段始终输出,产物或其他文件为空时该段下写一行 `无`):

       ```text
       feature-id  2026-10-18-积分发放
       负责人      liulongfei
       任务        T-12
       阶段        已规划
       spec 指纹   8d0e4b1

       产物
         规格说明 spec      积分发放-spec.md          路径   —
         实现计划 plan      plan/积分发放-index.md    头部   过期:spec 已变(3f9a1c2 → 8d0e4b1)
         review_record      积分-评审记录.md          头部   —

       平台环节(按默认类型表;任务类型按「需求开发」估)
         设计      ✓  积分发放-spec.md
         规划      ✓  plan/积分发放-index.md
         测试      ✗  缺(必需)
         发布      —
         交付文档  —
         实现、知识经验:由 commit 和会话承载,以平台为准
         项目自定义类型(环节以平台配置为准):review_record

       其他文件
         实测/a.json
       ```

       依据状态文案:`fresh`「未过期」· `stale`「过期:spec 已变(<recorded> → <current>)」· `no_main_spec`「无主 spec」· `invalid`「依据格式不对」· `none`「—」。
     - check 文本(每条结果都带「改法」行):

       ```text
       失败  docs/features/2026-10-18-积分发放/积分发放-spec.md  缺少 `> 产物:`
             改法:补 `> 产物: spec`
       警告  docs/features/2026-10-18-积分发放/plan/积分发放-index.md  过期:spec 已变(3f9a1c2 → 8d0e4b1)
             改法:复核后依据改为 `spec@8d0e4b1`
       共检查 12 个文件:1 处失败,1 处警告
       ```

       全部通过时只输出 `共检查 <N> 个文件:全部通过`。
  6. `index.ts`:导出 `showFeature`、`resolveFeatureId`、`checkFeatures`、`FeaturesError`、`FeatureNotFoundError`、`FeatureAmbiguousError`、`CheckTargetNotFoundError`、`exitCodeForError`、`exitCodeForCheckReport`,以及新增类型。
  7. `src/cli/index.ts`:`import { readCachedProjectArtifactTypes } from '../core/sync';`,注册改为 `registerFeaturesCommands(program, { readProjectArtifactTypes: readCachedProjectArtifactTypes });`。
- 完成条件:
  - `npx tsc --noEmit` 通过;`npm test` 全绿;改动文件都不超过 600 行。
  - 「验证方式」各条结果符合预期;临时仓库已删除,本仓库没有新增任何临时文件。
- 验证方式(先 `npm run build`):
  - `node dist/cli/index.js features show 2026-10-18-产物注册表与头部规范`:输出四段;spec、两个 plan 文件识别方式为「头部」;交接文件类型为 handoff;plan 的依据状态与 spec 是否改过一致(未改为「未过期」)。
  - `node dist/cli/index.js features show 产物注册表` 命中同一目录;`node dist/cli/index.js features show 不存在的需求; echo $?` 末行为 `2`。
  - `node dist/cli/index.js features check 2026-10-18-产物注册表与头部规范; echo $?`:没有失败,末行为 `0`。
  - 用系统临时目录里的独立 git 仓库验证新产物校验,不在本仓库建文件:本仓库已接入平台,后台同步会把会话里用编辑工具写出的文件当作产出上报,平台上删不掉。临时文件一律用 shell 写入,不用 Write / Edit 工具:

    ```bash
    REPO=$(pwd)
    TMP=$(mktemp -d)
    git -C "$TMP" init -q
    D="$TMP/docs/features/2099-01-01-check自检"
    mkdir -p "$D/plan"
    printf '# 规格说明: check自检\n\n正文\n' > "$D/check自检-spec.md"
    printf '# 回归记录\n\n> 产物: unit_test_report\n> 依据: spec@0000000\n' > "$D/check自检-回归记录.md"
    printf '# 实现计划: check自检\n\n> 产物: plan\n> 依据: spec@0000000\n\n## 目标与范围\n' > "$D/plan/check自检-index.md"
    node "$REPO/dist/cli/index.js" features show 2099-01-01-check自检 "$TMP"
    (cd "$TMP" && node "$REPO/dist/cli/index.js" features check 2099-01-01-check自检; echo $?)
    (cd "$TMP" && node "$REPO/dist/cli/index.js" features check 2099-01-01-check自检 --json)
    rm -rf "$TMP"
    ```

    期望:
    - show:回归记录一行识别方式为「头部」、类型为单元测试报告、依据「过期」;阶段为 `已验证`;四段齐全,「其他文件」段写 `无`。
    - check:失败 4 条(spec 的 `missing_type`、`missing_owner`、`first_screen`,plan index 的 `first_screen`),警告 2 条(两个 `stale`),每条都带「改法」,末行为 `1`。
    - `--json`:符合 C-7,`ok` 为 false,`failures` 为 4,`warnings` 为 2。
  - `node dist/cli/index.js features check 不存在的目标; echo $?` 末行为 `2`;`node dist/cli/index.js features check src; echo $?`(存在但在产出目录外)末行为 `0`,输出 `共检查 0 个文件:全部通过`。
- 独立提交:是。提交主题 `feat(features): 新增 features show / check——产出目录全貌与新产物校验`。
- 风险/注意事项:
  - `git ls-tree` 不加 `-z` 时中文路径被转义,所有文件都会被误判为新产物。
  - 注入的读取函数返回 null 时只按内置类型判断未知类型。

---

### T-5: 同步执行:拉取 `/spec`、重新评估补报、告警与未上报产出可见

- 目标:档位 1.3 时拉取并缓存本项目类型表;档位、类型表或映射变化后自动重新评估、补报;告警与未上报产出持久化并在 `sync status` / `sync now` 里可见;`runner.ts` 拆到 600 行以内。
- 对应 spec 条款:§11.1(`/spec` 刷新时机)、§11.3、§11.4、§11.6、§13(本地库)、§14(sync 相关行)
- 强制引用:`docs/guides/coding-standards.md`、`docs/guides/data-standards.md`、`docs/guides/interface-standards.md`
- 依赖:T-3
- 涉及范围:修改 `src/core/sync/client.ts`、`runner.ts`、`status.ts`、`cli.ts`、`store.ts`、`schema.sql`、`connection.ts`、`types.ts`、`payload.ts`、`platform-spec.ts`、`index.ts`;新建 `src/core/sync/batching.ts`、`src/core/sync/warnings.ts`。
- 必须严格执行:
  - 使用注册表门面的以下导出(契约 C-1 原文节选),从 `../artifact-registry` 引入:

    ```ts
    export const ARTIFACT_MAPPING_VERSION = 2;      // 路径规则或识别口径变化时 +1
    export function isValidArtifactTypeKey(key: string): boolean;
    ```

  - 使用的上下文契约(契约 C-3 原文节选):

    ```ts
    // src/core/sync/version.ts
    export type ServerTier = '1.0' | '1.1' | '1.2' | '1.3';
    export function serverTier(version: string | null): ServerTier;
    // src/core/sync/types.ts
    export interface UnreportedArtifact { type: string; path: string } // path 为仓库相对路径
    // src/core/sync/payload.ts
    export interface SyncContext {
      /* 既有字段不变,另有: */
      tier: ServerTier;
      supportsTaskKey: boolean;              // tier !== '1.0'
      allowedTypes: ReadonlySet<string>;     // reportableTypesFor(tier, projectTypes)
      reevaluateAll: boolean;                // createSyncContext 恒置 false,由 runner 改写
    }
    export async function createSyncContext(
      projectRoot: string,
      opts?: { tier?: ServerTier; projectTypes?: readonly string[] | null },  // 缺省 tier '1.0'、projectTypes null
    ): Promise<SyncContext>;
    export interface BuiltSession { /* 既有字段不变,另有: */ unreported: UnreportedArtifact[] }
    ```

  - 使用的缓存契约(契约 C-4 原文):

    ```ts
    // src/core/sync/types.ts
    export interface PlatformSpecCache {
      fetchedAt: string;
      artifactTypes: Array<{ key: string; name: string; phase: string }>;
    }
    // src/core/sync/store.ts —— sync_state 键 'platform_spec'
    export function getPlatformSpec(db: SqliteDatabase): PlatformSpecCache | null;
    export function setPlatformSpec(db: SqliteDatabase, cache: PlatformSpecCache, now: string): void;
    // src/core/sync/platform-spec.ts,并由 src/core/sync/index.ts 导出
    export function readCachedProjectArtifactTypes(projectRoot: string): string[] | null; // 未初始化 / 无缓存 / 任何异常 → null,绝不抛
    ```

  - 产出(契约 C-6 原文):
    - `sync_state` 新键:`platform_spec`(C-4)、`warnings` = `{ at: string; items: IngestWarning[] }`、`basis` = string。
    - 新表,追加进 `src/core/sync/schema.sql`,**不升 `SYNC_SCHEMA_VERSION`**:

      ```sql
      CREATE TABLE IF NOT EXISTS sync_unreported_artifacts (
        client_session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        path TEXT NOT NULL,
        PRIMARY KEY (client_session_id, type, path)
      );
      ```

    - `basisOf(ctx)` = `sha256(stableStringify({ mapping: ARTIFACT_MAPPING_VERSION, tier: ctx.tier, allowed: [...ctx.allowedTypes].sort() }))`。
  - 不升 `SYNC_SCHEMA_VERSION`(规范例外,理由见 index「适用规范」)。
  - `/spec` 的任何失败都不暂停、不计为同步失败,不改 `failingSince` / `lastError`。
  - 基准只在整轮成功(没有 stop)后写入。
  - 未上报产出的提示在所有档位统一为「请联系项目管理员配置该产物类型」(spec §11.4 原文)。
- 允许局部适配:
  - `renderStatus` 中新增内容的位置(在既有行之后追加即可)。
  - 搬移函数时的文件内顺序。
- 具体要求:
  1. `client.ts` 新增 `getSpec(serverUrl: string, token: string, remoteUrl: string): Promise<{ protocolVersion?: string; artifactTypes: Array<{ key: string; name: string; phase: string }> }>`:`GET /spec?remoteUrl=<encodeURIComponent(remoteUrl)>`;顶层不是对象,或 `artifactTypes` 不是数组 → `invalidResponse`;逐项保留 `key` 为字符串且 `isValidArtifactTypeKey(key)` 的项(该函数从 `../artifact-registry` 引入),`name` 不是字符串时用 `key`,`phase` 不是字符串时用 `''`。
  2. `platform-spec.ts` 新增 `refreshPlatformSpec(db: SqliteDatabase, serverUrl: string, token: string, remoteUrl: string, now: string): Promise<string[] | null>`:`getSpec` 成功 → `setPlatformSpec(db, { fetchedAt: now, artifactTypes }, now)`,返回各项 `key`;任何异常 → 写 stderr `[sync] 拉取本项目产物类型表失败,本轮按默认类型表上报:<消息>`,返回 null,缓存不动。
  3. `types.ts`:
     - 新增 `export interface WarningsRecord { at: string; items: IngestWarning[] }`。
     - `SyncRunResult` 加 `warningItems: IngestWarning[]`(本轮收到的告警,按到达顺序)。
     - `SyncStatusReport` 加 `tier: ServerTier`、`platformSpec: { typeCount: number; fetchedAt: string } | null`(档位 1.3 且有缓存时非 null)、`lastWarnings: WarningsRecord | null`、`unreported: Array<{ type: string; count: number; samplePath: string }>`。
  4. `store.ts`:`StateKey` 加 `'warnings' | 'basis'`;新增:

     ```ts
     export function getLastWarnings(db: SqliteDatabase): WarningsRecord | null;   // 键 'warnings';结构不合法 → null
     export function setLastWarnings(db: SqliteDatabase, record: WarningsRecord, now: string): void;
     export function getBasis(db: SqliteDatabase): string | null;                  // 键 'basis'
     export function setBasis(db: SqliteDatabase, basis: string, now: string): void;
     export function clearPlatformState(db: SqliteDatabase): void;                 // 删 platform_spec / warnings / basis 三键
     export function replaceUnreported(db: SqliteDatabase, sessionId: string, items: UnreportedArtifact[]): void; // 先删该会话全部行再插入
     export function summarizeUnreported(db: SqliteDatabase): Array<{ type: string; count: number; samplePath: string }>; // 按 type 分组,count 为行数,samplePath 取 MIN(path),按 type 升序
     export function clearUnreported(db: SqliteDatabase): void;
     ```

     `setStatus` 持久化 `lastResult` 时不写 `warningItems`;`getStatus` 读出的 `lastResult.warningItems` 恒为 `[]`。
  5. `schema.sql`:追加上面的建表语句;文件头注释「回滚:删除 sync_* 四张表」改为「五张表」;不改 `sync_schema_versions` 的插入语句。
  6. `payload.ts`:新增 `export function basisOf(ctx: SyncContext): string`,按 C-6 定义,复用本文件已有的 `stableStringify` 与 `sha256`;`ARTIFACT_MAPPING_VERSION` 从 `../artifact-registry` 引入。
  7. `batching.ts`(新建):从 `runner.ts` 原样移入 `Chunk` 接口与 `makeChunk`、`chunkSession`、`splitChunkEvents`、`envelopeBytes`、`packBatches`、`groupBySession`,导出供 runner 使用,行为不变。
  8. `runner.ts`:
     a. `isAgentCandidate` 的 `Pick` 加 `'reevaluateAll'`;在隔离判定之后加 `if (ctx.reevaluateAll) return true;`。
     b. `runSync` 第 5 步:`const tier = serverTier(status.serverProtocolVersion);`;`tier === '1.3'` 时取 `getOriginUrl(projectRoot)`,非 null 则 `projectTypes = await refreshPlatformSpec(db, conn.serverUrl, conn.token, remote, now)`;`ctx = await createSyncContext(projectRoot, { tier, projectTypes })`;`const basis = basisOf(ctx); ctx.reevaluateAll = getBasis(db) !== basis;`。
     c. `collectChunks`:每次 `buildSessionPayload` 之后立刻 `replaceUnreported(db, sessionId, built.unreported)`(放在「无新事件且内容哈希未变 → 跳过」的判断之前);`buildTerminalPayload` 结果非 null 时同样写入。
     d. `Round` 加 `warningItems: IngestWarning[]`;`sendBatch` 成功后 `round.warningItems.push(...resp.warnings)`;`round.warnings` 与 `warningItems.length` 保持一致。
     e. `makeResult` 带上 `warningItems`(没有 round 时为 `[]`);`finish` 中 round 非 null 且 `warningItems` 非空 → `setLastWarnings(db, { at: now, items: round.warningItems }, now)`,中途停止的轮次同样写入。
     f. 第 11 步全部成功时,在 `setStatus` 之前 `setBasis(db, basis, now)`。
     g. 分块装箱函数移走后,`runner.ts` 不超过 600 行。
  9. `connection.ts`:
     a. `connectLocked` 的事务里,在 `clearSessions(db)` 之后加 `clearPlatformState(db); clearUnreported(db);`。
     b. 事务提交后、返回前:`serverTier(resp.protocolVersion ?? null) === '1.3'` 时重新开库,调用 `refreshPlatformSpec(db, serverUrl, resp.token, remoteUrl, now)`,忽略结果;失败只写 stderr,不影响接入结果。
     c. `disconnectPlatform` 不改:断开后保留本项目类型表缓存,`features check` 仍按「最近一次从平台拉到的本项目类型表」判断未知类型(spec §9);重新接入时由 a 清空。
  10. `status.ts`:`report.tier = serverTier(state.serverProtocolVersion)`;`platformSpec`:档位为 1.3 且 `getPlatformSpec` 非 null 时为 `{ typeCount: artifactTypes.length, fetchedAt }`;`lastWarnings = getLastWarnings(db)`;`unreported = summarizeUnreported(db)`;`createSyncContext` 传 `{ tier, projectTypes: 缓存里的 key 列表或 null }`;统计待上报会话时传给 `isAgentCandidate` 的判定对象 `reevaluateAll` 恒为 false(仅因重新评估进候选的会话不计入)。
  11. `warnings.ts`(新建):

      ```ts
      export function describeWarning(w: { kind: string } & Record<string, unknown>): string;
      export function groupWarnings(items: ReadonlyArray<{ kind: string } & Record<string, unknown>>): Array<{ kind: string; lines: string[] }>; // 按 kind 首次出现的顺序分组,组内去重
      ```

      | kind | 文案 |
      |---|---|
      | `binding_ineffective` | `绑定段未生效(<原因>):<bindingId>`;原因:`task_not_found` 任务不存在或不可见,`not_owner` 不能归属到本人,`task_closed` 任务已关闭,其他值原样 |
      | `path_dropped` | `路径不安全,平台已丢弃:<path>` |
      | `binding_pending` | `任务键尚未声明,该段挂起:<taskKey>` |
      | `task_key_declared_by_other` | `任务键已由他人声明,本人会话按协作计入:<taskKey>` |
      | `task_declaration_invalid` | `任务声明不合法,已丢弃:<taskKey>(<原因>)`;原因:`invalid_key` 任务键不合法,`invalid_name` 名称不合法 |
      | `artifact_type_unknown` | `本项目未配置产物类型 <type>,这条产出已丢弃:<path>;请联系项目管理员配置该产物类型` |
      | 其他 | `<kind>:<其余字段的 JSON>` |

      字段缺失时用 `-` 占位,不抛错。
  12. `cli.ts`:
      - `renderStatus`:`report.platformSpec` 非 null 时,「平台协议版本」一行末尾追加 `(本项目产物类型 <typeCount> 类,刷新于 <fetchedAt>)`;在既有行之后按需追加(没有内容不输出):

        ```text
        未上报产出:
          review_record ×2(docs/features/2026-10-20-积分/积分-评审记录.md 等)
          delivery_brief ×1(docs/features/2026-10-18-积分发放/积分发放-交付讲解.md)
          请联系项目管理员配置该产物类型
        最近一次平台告警(2026-10-18T15:00:00.000Z):
          binding_pending
            任务键尚未声明,该段挂起:2026-10-18-积分发放
        ```

        `count` 大于 1 时示例路径后加「等」。
      - `sync now`:在既有「同步完成:…」一行之后,`result.warningItems` 非空时追加 `平台告警:` 与按 `groupWarnings` 分组的明细(格式同上)。
  13. `index.ts`:新增导出类型 `WarningsRecord`;其余新增函数均为子系统内部使用,不进门面。
- 完成条件:
  - `npx tsc --noEmit` 通过;`npm test` 全绿(含 `__tests__/core/sync/protocol-version.test.ts`);`wc -l src/core/sync/runner.ts` 不超过 600。
  - 「验证方式」各条结果符合预期。
  - 不执行 `sync now`、`sync connect`(会连真实平台);需要端到端验证时由用户决定。
- 验证方式(先 `npm run build`):
  - `node dist/cli/index.js sync status` 在本仓库正常输出。
  - 新表已建、版本未升:

    ```bash
    node -e "
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync('.cgraphx/cgraphx.db');
    console.log(d.prepare(\"SELECT name FROM sqlite_master WHERE name LIKE 'sync_%' ORDER BY name\").all().map((r) => r.name).join(','));
    console.log(d.prepare('SELECT MAX(version) AS v FROM sync_schema_versions').get().v);"
    ```

    第一行包含 `sync_unreported_artifacts`,第二行为 `1`。
  - 旧版兼容:执行本机全局安装的旧版 `cgraphx sync status`,不出现「schema 版本」相关报错。
- 独立提交:是。提交主题 `feat(sync): 协议 1.3 适配——拉取本项目类型表 + 类型补配后自动补报 + 告警与未上报产出可见`。
- 风险/注意事项:
  - 接入时持锁期间多一次 `/spec` 请求,超时沿用 `CLIENT_TIMEOUT_MS`。
  - 升级后首轮会重建全部会话一次(一次性的读库与计算开销),只发送内容有变化的会话。
  - 旧版全局 cgraphx 跑的同步不写基准、也不认新键;全局升级后自然收敛。
