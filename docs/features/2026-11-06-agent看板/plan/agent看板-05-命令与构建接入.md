# T-5: 命令与构建接入

> 产物: plan
> 依据: spec@90c1887

- 目标: `cgraphx board` 命令落地——先补录再起服务再开浏览器的完整启动链;board 命令组注册进 CLI;`page.html` 登记进构建资产清单随包分发。
- 对应 spec 编号: F1 行为链(任意目录 → 补录 → 打开浏览器)、③、D4、D1(`cli/index.ts` 加一行注册、copy-assets 加 page.html)、验收 8、9。
- 强制引用: `docs/guides/coding-standards.md`(动代码);`docs/guides/interface-standards.md`(命令注册、输出、退出码)。
- 涉及范围: `src/core/board/cli.ts`(新)、`src/cli/index.ts`、`scripts/copy-assets.cjs`。
- 必须严格执行:
  - 按 C-8(启动顺序、终端输出、刷新编排、可注入的打开函数)。
  - 命令注册走 interface-standards:board 子系统命令在 `board/cli.ts` 导出 `registerBoardCommands(program: Command): void`,由 `src/cli/index.ts` 统一接入(加一行 import + 一行调用,不动其他注册)。
  - stderr 消息带 `[board]` 前缀;错误经 `exitCodeForError` 映射退出码,不散落 `process.exit` 字面量;Ctrl+C / SIGTERM 干净退出(退出码 0)。
  - `copy-assets.cjs` 增加 `src/core/board/page.html → dist/core/board/page.html` 一行(与两个 schema.sql 并列的显式 copyFile,不 walk 目录)。
  - 不做任何附加命令行选项(`--json`、固定端口、无浏览器模式都不做;spec D4)。
- 允许局部适配:
  - 打开浏览器命令的平台分支写法(`open` / `start` / `xdg-open`,win32 可走 `cmd /c start`);可注入参数的形态(如 `options.openBrowser?: (url: string) => void`)。
  - 启动各阶段之间的空行与提示措辞微调(C-8 的文案本身不变)。
- 具体要求:
  1. `board/cli.ts`:`cgraphx board` 命令,description 一句话;action 按 C-8 编排——`syncProjects`(C-9/T-3 门面)逐项目打进度行 → `computeBoardData` → `createBoardServer` → `listen` → 打印带令牌地址 → 打开浏览器(注入点;失败打「浏览器没打开,手动访问 <地址>」,服务照常) → 等待信号退出。
  2. 刷新回调:把 `syncProjects` + `computeBoardData` 组成 `refresh()` 传给 server(C-7/C-8);刷新中 server 挡 409。
  3. `src/cli/index.ts`:`import { registerBoardCommands } from '../core/board/cli'` + `registerBoardCommands(program)`(放在其他子系统注册之后、legacy 空命令之前)。
  4. `scripts/copy-assets.cjs`:登记 page.html;文件头注释的清单说明同步补一行。
- 完成条件:
  - `npm run build` 零错误;`npm pack --dry-run` 清单含 `dist/core/board/page.html`(统一验证 2);`npm test` 全量通过。
  - 冒烟:任意目录(含非项目目录)`node dist/cli/index.js board` 全链走通——补录进度行、带令牌地址、浏览器打开、页面可用、Ctrl+C 退出码 0;`node dist/cli/index.js board --help` 正常。
- 提交点:
  1. `feat(board): cgraphx board 命令——先补录再打开,page.html 随包分发`:本任务 3 个文件。
- 风险/注意事项:
  - 提交前检查点第一条(资产未登记 copy-assets)本任务正是落点——自查 `npm pack --dry-run`。
  - `cgraphx board` 从任意目录跑:不得依赖 cwd 是项目目录(compute 用 listProjects,不用 cwd);根命令 postAction 的会话提示照旧生效,不特殊处理。
  - 长驻进程:server 存活期间不占 ingest.lock(补录在启动/刷新时拿放);不监听 SIGPIPE 之外的信号魔法。
