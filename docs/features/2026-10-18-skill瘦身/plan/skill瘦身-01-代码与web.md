# 实现计划: skill瘦身 · 批次 1 代码与 web

> 产物: plan
> 依据: spec@cf4712c

## 共用约定

本文件的任务都改 TypeScript 源码,执行前先读完本节。

1. 分支:在 `feat/skill瘦身` 上做(没有就从 `main` 建);开工前 `git status` 确认暂存区是空的。
2. 规范:动代码前读 `docs/guides/coding-standards.md`;新注释一律中文;`src/core` 不得 import `src/cli`、`src/web`。
3. 范围:只改任务「涉及范围」列出的文件;不改 `docs/features/` 下任何已有文件;不写新测试(测试走独立流程),但改动弄红的既有测试要同步修正。
4. 每个任务做完跑:`npm run build`、`npm test`,都通过才提交。
5. 提交:标题格式 `type(scope): 中文描述`,补充说明用「——」,并列用「+」;每个任务一笔。本仓库的提交门禁会先拦一次,对照 `git diff --cached` 自查下面几点后,用 `CGRAPHX_PRECOMMIT_REVIEWED=1 git commit ...` 重试:`src/core` 没有 import `src/cli`、`src/web`;没有写死的绝对路径、密钥、阈值、版本号;没有新增 TODO、FIXME;没有被注释掉的命令注册。
6. 遇到任务要求和 spec 冲突、要改范围外的文件,停下写 `PLAN_CONFLICT: <原因>`,不自行换方案。

## T-1: 注册表登记开头结论 + 只查 md + `features check --staged`

- 目标:`features check` 按 spec §8.2 检查各类新产物的开头结论(spec 不再要求「一图看懂」,HTML 产物不查开头结论),并新增 `--staged`,只检查暂存区里 `docs/features/` 下新增和修改的文件,供提交门禁调用。
- 对应 spec 条款:§8.2、§8.4(检查范围)、§12(新写的 HTML 产物只查头部)、§13 第 4、6、7 条、§14(注册表只改开头结论)。
- 强制引用:`docs/guides/coding-standards.md`、`docs/guides/interface-standards.md`
- 依赖:无。
- 涉及范围:
  - `src/core/artifact-registry/registry.ts`
  - `src/core/artifact-registry/types.ts`(只改注释)
  - `src/core/features/check.ts`
  - `src/core/features/cli.ts`
  - `src/core/features/errors.ts`
- 必须严格执行:
  - `BUILTIN_ARTIFACT_TYPES` 的 `firstScreen` 改成下表,其余字段(key、name、defaultPhase、minTier、requiresBasis)一个不改;不增删类型,不动 `PATH_RULES`。

    | key | firstScreen |
    |---|---|
    | `spec` | `null`(撤掉「一图看懂」) |
    | `plan` | `{ heading: '设计预览', planIndexOnly: true }`(不变) |
    | `handoff` | `{ heading: '本任务范围', planIndexOnly: false }` |
    | `api_test_spec`、`unit_test_spec`、`ui_test_spec` | `{ heading: '覆盖范围', planIndexOnly: false }` |
    | `api_test_report`、`unit_test_report` | `{ heading: '结论', planIndexOnly: false }` |
    | `closure_record` | `{ heading: '历时', planIndexOnly: false }` |
    | `release_record` | `{ heading: '版本与上线时间', planIndexOnly: false }` |
    | `prd` | `{ heading: '需求概览', planIndexOnly: false }` |
    | `design_doc` | `{ heading: '架构总览', planIndexOnly: false }` |
    | 其余(`wireframe`、`ui_test_report`、`api_doc`、`delivery_brief`、`knowledge`、`code_map`、`design_map`、`schema_knowledge`) | `null`(不变) |

  - `firstScreenHeadingOf(identity, projectRelPath)`:路径扩展名不是 `.md`(不区分大小写)时返回 `null`;其余逻辑不变。注释写明「开头结论只对 md 生效;HTML 读不出二级标题,不查」。
  - `checkFeatures(projectRoot, targets, opts)` 的 `CheckOptions` 新增 `staged?: boolean`:
    - `staged` 为真且 `targets` 非空时,抛新错误类 `CheckStagedWithTargetsError`(继承 `FeaturesError`),消息:`--staged 不能和目标参数一起用;要查指定文件或需求目录就去掉 --staged`。`exitCodeForError` 把它映射为 `2`(和「目标不存在」同一类)。
    - `staged` 为真时,待查文件 = 下面这条命令的输出,命令在 `projectRoot` 下执行:
      `git diff --cached --name-only -z --diff-filter=ACMR --relative -- docs/features/`
      用 `execFileSync`(不经 shell),`encoding: 'utf-8'`,`stdio: ['ignore', 'pipe', 'ignore']`,`timeout: 5000`;按 `\0` 切分、去空串,只留 `featureIdOf(路径) !== null` 的,去重后升序。命令失败(不在 git 仓库、git 不可用、超时)时按「没有暂存文件」处理,返回空列表,不抛错。
    - 必须用 `-z`:不加 `-z` 时 git 会把中文路径转义成 `"docs/features/2026-10-18-skill\347..."`。
    - 其余流程(按 HEAD 判断新旧、头部、依据、开头结论、警告)完全复用现有循环,不另写一套。
  - `cli.ts` 的 `features check [targets...]` 新增 `.option('--staged', '只检查暂存区里 docs/features/ 下新增和修改的文件')`,把 `staged: options.staged === true` 传给 `checkFeatures`。`--json` 输出的形状 `{ ok, checkedFiles, failures, warnings, findings: [{ level, path, code, message, fix }] }` 不变;退出码规则不变(有失败为 1)。
- 允许局部适配:
  - 暂存文件的收集函数放在 `check.ts` 内,函数名自定;`JsonOptions` 类型怎么扩展自定。
  - `types.ts` 里 `firstScreen` 的注释措辞自定,字段名不改。
- 具体要求:
  1. 改 `registry.ts` 的类型表和 `firstScreenHeadingOf`。
  2. 改 `check.ts`:`CheckOptions` 加 `staged`;入口按 `staged` 选文件来源;加冲突检查。
  3. 改 `errors.ts`:新增 `CheckStagedWithTargetsError`,接入 `exitCodeForError`。
  4. 改 `cli.ts`:注册 `--staged` 并透传。
  5. 文件头注释里「首屏」的说法可以保留,不必全局改名。
- 完成条件:
  - `npm run build`、`npm test` 通过。
  - 下面「验证方式」各步结果符合预期。
- 验证方式(在仓库根目录执行;做完把临时文件清掉):
  1. `node dist/cli/index.js features check 2026-10-18-skill瘦身`:不再出现「首个二级标题不是「一图看懂」」。
  2. `node dist/cli/index.js features check --staged --json`(暂存区为空):输出 `"checkedFiles": 0`、`"failures": 0`,退出码 0。
  3. 新建临时文件 `docs/features/2026-10-18-skill瘦身/临时-接口测试-spec.md`,内容:

     ```markdown
     # 接口测试规格: 临时

     > 产物: api_test_spec
     > 依据: spec@cf4712c

     ## 1. 接口清单
     ```

     执行 `git add` 该文件后跑 `node dist/cli/index.js features check --staged`:报 1 处失败「首个二级标题不是「覆盖范围」」,退出码 1。把 `## 1. 接口清单` 改成 `## 覆盖范围`,再 `git add`、再跑:0 处失败。(`依据` 的指纹如果和 `features show` 显示的不同,会多一条「过期」警告,不影响结论。)
  4. 新建临时文件 `docs/features/2026-10-18-skill瘦身/临时-设计文档.html`,前几行:

     ```html
     <!doctype html>
     <!--
     > 产物: design_doc
     > 依据: spec@cf4712c
     -->
     <html><body><h2>随便什么</h2></body></html>
     ```

     跑 `node dist/cli/index.js features check docs/features/2026-10-18-skill瘦身/临时-设计文档.html`:没有 `first_screen` 失败。
  5. `node dist/cli/index.js features check --staged 2026-10-18-skill瘦身`:报 `--staged 不能和目标参数一起用…`,退出码 2。
  6. 清理:`git reset -q -- docs/features/2026-10-18-skill瘦身/临时-接口测试-spec.md`,删掉两个临时文件;`git status` 确认干净。
- 独立提交:是。建议标题:`feat(features): 开头结论登记七类产物 + 只查 md + check 新增 --staged——spec 撤掉一图看懂`
- 风险/注意事项:
  - `--staged` 是新的命令参数,已经负责人确认并写进 spec §8.4;参数名、行为和报错文案按本任务原文,不要改。
  - HEAD 里已有的文件不查开头结论,这是现有逻辑,不要改。

## T-2: web 系统地图两处提示与注释

- 目标:代码地图停止维护后,web「系统地图」页的两处「去运行 `/code-map-write`」提示改成「代码地图已停止维护,内容可能过时」;源码注释里引用已废弃 skill 的地方改成直接写规则。
- 对应 spec 条款:§9(web 页、代码注释)、§13 第 9 条。
- 强制引用:`docs/guides/coding-standards.md`
- 依赖:无。
- 涉及范围:
  - `src/web/codemap-templates.ts`
  - `src/web/codemap-reader.ts`(只改注释)
  - `src/web/constants.ts`(只改注释)
- 必须严格执行:
  - `renderCodemapHomeContent` 空态里的 `<p>在 Claude Code 中运行 <code>/code-map-write</code> 生成,生成后刷新本页即可浏览。</p>` 改为 `<p>代码地图已停止维护,内容可能过时。</p>`;`<h1>还没有代码地图</h1>` 不变。
  - `renderStaleBox` 里的 `<p>在 Claude Code 中运行 <code>/code-map-write</code> 重新生成</p>` 改为 `<p>代码地图已停止维护,内容可能过时。</p>`;上面的「已过期:生成之后以下文件有改动…」和文件列表不变。
  - 页面结构、class 名、其他文案一个不改;不删页面,不动 `docs/code-map/`。
- 允许局部适配:注释措辞。
- 具体要求:
  1. `codemap-templates.ts`:改上面两处 `<p>`;函数上方注释「空态引导 /code-map-write」改为「空态提示代码地图已停止维护」。
  2. `codemap-reader.ts` 文件头注释里「过期口径(契约 3)与 code-map-recall skill 的 `git diff` 一致,不含其 `git status` 一项:只看已提交改动。」改为:「过期口径(契约 3):`git diff --name-only <source_commit> HEAD -- <related_code...>` 有输出即过期;只看已提交的改动,不看工作区里没提交的改动。」
  3. `constants.ts` 里 `CODE_MAP_DIR` 的注释,把「code-map-write skill 的产物目录」改成「代码地图目录(原由 code-map-write skill 生成,该 skill 已于 2026-10-19 废弃)」,其余描述保留。
- 完成条件:
  - `grep -n "代码地图已停止维护" src/web/codemap-templates.ts` 命中 2 处;`grep -n "code-map-write" src/web/codemap-templates.ts` 无结果;`grep -n "code-map-recall" src/web/` 无结果。
  - `npm run build`、`npm test` 通过。
- 验证方式:上面的 grep 与命令;可选:`node dist/cli/index.js web` 打开「系统地图」页看一眼。
- 独立提交:是。建议标题:`refactor(web): 系统地图两处提示改为「代码地图已停止维护」——code-map skill 废弃`
- 风险/注意事项:如果有既有测试断言了旧文案,同步改测试里的期望字符串,不改测试逻辑。
