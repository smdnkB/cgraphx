### T-3: features 只认内置类型与需求环节,去掉 `> 任务:`

> 产物: plan
> 依据: spec@1fedd36

- 目标: 产物检查只认内置 20 种类型(平台下发的类型表不再读);`features show` 的「平台环节」改叫「需求环节」、末行不再提平台、项目自定义类型行删掉;spec 头部的 `> 任务:` 不再读、不再显示、不再检查,旧 spec 里留着的这一行不引发任何新的警告或失败。
- 对应 spec 编号: F2、D3、D4、K1、K6;F4、D11。(执行者据此读 spec 原文,不凭任务转述猜)
- 强制引用: `docs/guides/coding-standards.md`、`docs/guides/interface-standards.md`(输出/退出码)
- 涉及范围:
  - 修改:`src/core/features/check.ts`、`src/core/features/cli.ts`、`src/core/features/show.ts`、`src/core/features/scanner.ts`、`src/core/features/types.ts`、`src/core/features/index.ts`、`src/core/artifact-registry/header.ts`。
  - 前置:T-1 已完成(`src/core/task/` 已删,`readFeatureTask`/`scanFeatureTasks` 无外部读取方;`cli/index.ts` 已不注入 `readProjectArtifactTypes`)。
  - 与同一步同时跑的任务(T-2、T-7)不重叠。
- 必须严格执行:
  - **check 只认内置(D3/K1)**:`CheckOptions` 删 `projectTypes` 字段,`checkFeatures` 去掉该参数与 `projectTypes` 变量;`unknown_type` 警告的消息保持「未知类型 <X>:不是内置类型」(去掉「也不在本项目类型表」的条件拼接),改法改成「改用内置类型标识」(删掉「确需自定义类型,请项目管理员在平台配置…」);`cli.ts` 删 `FeaturesCommandDeps` 接口与 `registerFeaturesCommands` 的 `deps` 参数,`check` action 里不再传 `projectTypes`。
  - **show 需求环节(D4/K6)**:环节表 `PHASE_DEFS` 与产物归环节的算法**不动**;文本输出标题「平台环节(按默认类型表;任务类型按「需求开发」估)」改成「需求环节(按默认类型表)」;末行「实现、知识经验:由 commit 和会话承载,以平台为准」改成「实现、知识经验:由提交和会话承载,不按产物算」;项目自定义类型那一行与 `customTypes` 的收集计算整体删掉;`FeatureDetail` 删 `customTypes` 字段。
  - **去 `> 任务:`(D11)**:`scanner.ts` 删 `readFeatureTask`、`scanFeatureTasks`、内部 `taskOf`、`TASK_HEADER_PATTERN` 常量,文件头注释里「任务声明由 readFeatureTask / scanFeatureTasks 单独读取」的说法删掉;`show.ts` 删 `readFeatureTask` import 与 `task: readFeatureTask(...)` 字段,`FeatureDetail.task` 字段删;`cli.ts` 的 renderShow 删「任务」行(`if (detail.task !== null)` 块);`check.ts` 两处 `invalid_task` 检查(主 spec 头部一处、注册表头部一处)连同 `TASK_VALUE_PATTERN` 常量删掉;`types.ts` 的 `CheckFindingCode` 联合删 `'invalid_task'`;`index.ts` 门面删 `readFeatureTask`、`scanFeatureTasks` 导出;`artifact-registry/header.ts` 删 `任务` case 与 `HeaderFields` 的 `task` 字段(唯一读取方已删)。
  - `--json` 输出:字段名除删掉的 `task`、`customTypes` 外**一个不改**(D4)。
- 允许局部适配:
  - 各文件内被删代码周边的注释同步措辞;
  - `PHASE_DEFS` 注释里「平台环节」字样改成「需求环节」的措辞。
- 具体要求:
  - 改完用本仓库需求目录自测:`node dist/cli/index.js features check` 对 `docs/features/` 全量通过(本需求 spec 没有 `> 任务:` 行);再造一个带 `> 任务: T-123` 头部行的临时 spec(在 `/tmp` 下搭最小目录,或临时加行后还原)确认 `features check` 不出任何新的警告/失败(设计验收 6)。
  - `__tests__/features/scanner.test.ts` 若断言了 `readFeatureTask`/task 相关行为,删那些用例(被测能力已下掉),其余保持绿。
- 完成条件:
  - `npm run build`、`npm test` 通过;
  - `node dist/cli/index.js features show 2026-11-05-下掉web与平台同步` 的输出:标题「需求环节(按默认类型表)」、无「任务」行、无「项目自定义类型」行、末行「实现、知识经验:由提交和会话承载,不按产物算」;
  - `features show <需求> --json` 与改前逐字段对比,仅少 `task`、`customTypes` 两个字段(可用 git stash 前后对比或人工核对)。
- 提交点:
  1. `refactor(features): 产物只认内置类型——平台环节改需求环节+任务行下掉`:上述全部文件。
- 风险/注意事项:
  - 「平台环节」的判定算法(K6)是**沿用**不是重写——只改文案,别动 `PHASE_DEFS`、必需标记与归环节逻辑。
  - `header.ts` 的 `任务` case 删除后,头部解析遇 `> 任务:` 行会走「未知头部行」的处理——确认未知头部行在 `check` 里不产生警告(旧 spec 不能因此变红);若会产生,把 `任务` 加进头部解析的已知但忽略清单,而不是恢复 case。
