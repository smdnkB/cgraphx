# 测试规范

## 时区

- vitest 钉死 `TZ=UTC`(见 `vitest.config.ts` 注释),保证日期/时区断言跨机器可复现;**不要为了迁就本机时区改动**
- 跨时区行为通过派生带显式 TZ 覆盖的子进程验证(见 `__tests__/core/timeline/store.timezone.test.ts`),不依赖宿主机时区

## Mock 政策与隔离

- **测试走真实栈,不用 `vi.mock`**(32 文件现状:0 处;`vi.spyOn` 仅 2 文件,用于时间/时钟)
- 触 fs / DB 的用 `fs.mkdtempSync(os.tmpdir())` 建临时项目目录 + 真实 SQLite 文件库(`:memory:` 不是默认,仅 1 例),不伪造 DB 层
- 临时目录 afterEach 清理;测试数据测试内联构造,不用 fixtures 目录

## 测试描述

- describe / it 描述**一律英文**(与代码注释中文约定有意不同)
- describe 以被测对象为题(`'resolveTimeBound'`、`'TimelineStore.insert + query'`);spec 条款派生的验证项标注章节号(`'safety: forbidden keywords (spec §3.1, §9.1 #1)')
