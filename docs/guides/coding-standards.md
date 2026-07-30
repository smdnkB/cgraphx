# 编码规范

## 边界与结构

- 硬分层:`src/core/`(全部业务 + 基建)**永远不得依赖** `src/cli/` / `src/web/`;后两者只依赖 core
- 子系统标准形态(`src/core/<subsystem>/`):`index.ts` 门面 + `cli.ts` + `types.ts` + `errors.ts` + `constants.ts`;DB 子系统另有 `schema.sql` + `schema-bootstrap.ts`(features 类纯文件系统子系统免)
- **门面是硬约定**:外部调用方必须经 `index.ts`,不得直接伸手进内部模块(⚠️ markdown 子系统目前缺失,待补)
- 与 TS 源码同放的运行时资产必须登记 `scripts/copy-assets.cjs`;dist 目录结构须与 src/ 镜像(schema 路径相对编译后模块解析)

## 选型(偏离社区默认)

- **禁入 chalk**:ANSI 颜色手写转义序列(见 `src/cli/index.ts`)
- 枚举语义用 `as const` 数组 + 联合类型,不用 TS enum
- 内置模块导入统一 `node:` 前缀;存量裸导入(`core/errors.ts` 等)遇改收敛
- **注释中文**:新代码一律中文;旧英文注释遇改重写(CLAUDE.md 约定)
- 单文件超 **600 行必须拆分**
- 版本号唯一事实来源 `package.json`,运行时于 `cli/index.ts` 读取;发版走 `npm version`

## 错误与日志

- 每子系统自有 `errors.ts`(类型化错误层级,`XxxError`);子系统错误直接继承 `Error`,保持可整体移除
- 用户可修复的错误:**消息必带修复提示**(如 "Run `cgraphx docs index` to apply the latest schema.")
- CLI 层:action 内 try/catch → `exitCodeForError` 映射错误类型到退出码(编号表见 interface-standards.md)
- 日志走可替换 `Logger`(defaultLogger / silentLogger,测试可静音)
