# T-4: 看板流程命令只认名字集合的第一个词

> 产物: plan
> 依据: spec@5852da8

- 目标: 流程命令只把「命令后第一个参数等于任务标题 / feature-id / 副本目录名」算定挂;Skill 参数首词命中,或参数里含需求目录路径,也算。
- 对应 spec 编号: F2、D6、D7、D8
- 强制引用: `docs/guides/coding-standards.md`(边界与结构、选型)
- 涉及范围: `src/core/board/match.ts`;`__tests__/core/board/match.test.ts`
- 必须严格执行:
  - C-5
  - `FLOW_COMMAND_PATTERN` 不改;不做标点 / 大小写 / 全角空格归一化;`task.prefix` 不加入 `flowNames`。
- 允许局部适配:
  - `firstWord` 的内部写法(trim / split);`flowNames` 的构建顺序;注释措辞。
- 具体要求:
  1. `firstWord(text: string): string` = `text.trim().split(/\s+/)[0] ?? ''`。
  2. `TaskContext` 加 `flowNames: ReadonlySet<string>`;`taskContextsOf` 用 `[task.title, task.featureId, ...own.map(r => r.name)].filter(n => n !== '')` 构建;`own` 是该需求的副本登记(含已删)。
  3. `matchFixedRules` 的 prompt 分支:`const params = FLOW_COMMAND_PATTERN.exec(prompt.text)?.[1]; if (params !== undefined && task.flowNames.has(firstWord(params)))` → 加 `REASON_FLOW_COMMAND` 与 `hitTs`。
  4. Skill 分支:`tool.tool === 'Skill' && tool.args !== null && (task.flowNames.has(firstWord(tool.args)) || tool.args.includes(task.prefix))` → 加 `REASON_FLOW_COMMAND` 与 `hitTs`。
  5. 测试 `match.test.ts` 的 C5:prompt 正例保留;Skill 正例改成 `args: '订单导出 按 spec 写计划'`(首词是需求名);不新增用例。
- 完成条件:
  - `match.test.ts` 通过;C5 的新口径断言成立。
  - 不新增测试文件 / 用例。
- 提交点:
  1. `fix(board): 流程命令只认第一个参数——标题 / feature-id / 副本目录名`:`src/core/board/match.ts`、`__tests__/core/board/match.test.ts`。
- 风险/注意事项:
  - 只加三个完整名字,不要退回 `includes`;不要把 `task.prefix` 当名字加进 `flowNames`。
  - Skill 路径用 `task.prefix`(带结尾 `/`),不是 `task.featureId` 裸串。
