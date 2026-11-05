# T-5 程序:db-query

> 产物: plan
> 依据: spec@4d4bf55

- 目标:db-query 的项目级连接配置和查询日志改走数据位置(并过的目录在用户目录的项目目录里,没并过的照旧在本地 `.cgraphx/`);用户级 `~/.cgraphx/db-profiles.json` 不变;读不到配置的报错、`db init` 的说明改成新位置;删掉「副本关联的主项目不在了」的分支。
- 对应 spec 编号:D8、D23;F3「迁移与兼容」(报错与 `cgraphx db profiles` 显示的来源改写新位置;并过以后本地又出现的 `.cgraphx/db-profiles.json` 不再读)
- 强制引用:`docs/guides/coding-standards.md`、`docs/guides/interface-standards.md`
- 涉及范围:
  - `src/core/dbquery/config.ts`、`init.ts`、`logging.ts`、`cli.ts`
  - 既有测试:`__tests__/core/dbquery/` 下 `config.test.ts`、`init.test.ts`、`logging.test.ts`、`cli.test.ts`(被本任务弄红时)
- 必须严格执行:
  - 用到的基础层按 C-5(`getDataDir`、`ensureDataDir`、`locateData`、`missingDataMessage`,import 自 `../data-location`)
  - 读(`config.ts`):项目级配置路径 = `getDataDir(projectRoot)` + `PROFILES_FILENAME`;`getDataDir` 为 null → 只读环境变量与用户级两层(相当于项目级不存在)
  - 写(`init.ts` 的 `initDbProfiles`):目录 = `ensureDataDir(resolved)`;null → 抛 `Error(missingDataMessage(locateData(resolved)))`;文件权限照现在 0600(POSIX,覆盖时再 chmod);删掉 `main-missing` 分支
  - 日志(`logging.ts`):目录 = `getDataDir(projectRoot)`;null 或目录不在 → 直接返回,不建目录、不报错;目录在时照现在追加、轮转、0600;删掉 `main-missing` 分支与对数据目录的 `mkdirSync`
  - 三层加载顺序、合并规则、禁用开关、退出码都不变
- 允许局部适配:
  - 报错与说明的英文措辞(保持文件现有的英文风格),但必须带修复提示
- 具体要求:
  1. `config.ts`:`projectLocalConfigPath` 返回 `string | null`;调用处 null 时不往 `filesToRead` 里放项目级;「No db-profiles.json found」的报错改为:`No db-profiles.json found. Run \`cgraphx db init\` to create the project-level config (it lives in the project data dir shown by \`cgraphx project show\`), or create ~/.cgraphx/db-profiles.json globally, or set CGRAPHX_DB_PROFILES_PATH.`;文件头注释第 2 条改成「项目级:数据位置里的 db-profiles.json(并过的目录在 ~/.cgraphx/projects/<目录名>/,没并过的在 .cgraphx/)」
  2. `init.ts`:按「必须严格执行」;函数注释里 `.cgraphx/ missing → throws` 改成「拿不到数据位置 → throws」
  3. `logging.ts`:按「必须严格执行」;文件头注释里的路径改成「数据位置里的 db-query.log」
  4. `cli.ts`:`db init` 的 description 改为 `Create the project-level db-profiles.json template (in the project data dir, see \`cgraphx project show\`)`;`db profiles` 显示来源时,项目级照旧显示实际文件路径(路径已按新位置算出,不另改)
  5. 既有测试:直接往 `<临时项目>/.cgraphx/db-profiles.json` 写配置、期望被读到的用例,改成先让这个临时目录成为「装过、有旧库」的目录(建 `.cgraphx/cgraphx.db` 并在里面建一张 `timeline_meta` 表),这样数据位置就是本地 `.cgraphx/`;断言意图不变
- 完成条件:
  - `grep -rn "resolveDataDir\|main-missing" src/core/dbquery` 无输出
  - `grep -n "mkdirSync" src/core/dbquery/logging.ts` 无输出
  - `grep -n "ensureDataDir" src/core/dbquery/init.ts` 有命中
- 提交点:
  1. `refactor(db-query): 项目级连接配置和查询日志改走数据位置——并过的目录在用户目录`:`config.ts`、`init.ts`、`logging.ts`、`cli.ts`,以及改过的 `__tests__/core/dbquery/` 测试
- 风险/注意事项:
  - 日志写入失败只写一行 stderr、不阻塞查询的语义不变
  - 别在读配置的路径上调 `ensureDataDir`(读不建目录、不写记号)
