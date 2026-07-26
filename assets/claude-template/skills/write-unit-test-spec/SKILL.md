---
name: write-unit-test-spec
description: 基于 spec 产出单元测试规格文档(零代码依赖)。读 spec 派生必测路径/边界/异常/期望,产出 <前缀>-单元测试-spec.md,每条场景标 spec 依据。完全不碰业务实现代码 —— 只看测试基建(测试目录/框架/既有测试风格)。产物是独立的测试规格契约,供后续 write-unit-test-code 填实测试代码消费。即使代码一行没写也能产出。Use when 写完 spec 想要单元测试规格 / 测试设计 / 测试范围清单 / 测试场景 / write-unit-test-spec. 不写测试代码、不读实现代码、不跑测试.
---

# Write Unit Test Spec

## 定位

**测试规格产出 skill**:基于 spec 派生"该测什么",产出独立的测试规格文档。完全不碰业务实现代码,只看项目的测试基建(测试目录、框架、既有测试风格)。

**和 write-unit-test-code 的分工**:
- 本 skill(write-unit-test-spec):产**测试规格文档**(该测哪些场景,基于 spec)
- write-unit-test-code:基于测试规格 + 已有实现代码,填实测试代码 + 跑测试 + 出报告

两个 skill 顺序依赖:先跑本 skill 拿规格,审完后跑 write-unit-test-code 填实。用户可以在中间叫停(只产规格,不填实)。

## HARD-GATE

- **不读业务实现代码** —— 本 skill 只读 spec 和测试基建(测试目录/框架/既有测试风格),不碰业务实现。测试规格是"该测什么",和代码怎么实现无关
- **不写测试代码** —— 本 skill 只产 markdown 规格文档,测试代码是 write-unit-test-code 的事
- **不编造测试场景** —— 每条必测场景必须能追溯到 spec 的某条验收口径,标 `依据: spec §X.Y`
- **不强制使用** —— 纯增量可选环节,不跑不影响原流程
- **依赖 spec** —— 当前 feature 没有 `<前缀>-spec.md` 时,提示"本 skill 依赖 spec,请先跑 write-spec"并退出

## Trigger

**使用此 skill 当**:
- 用户做完 spec,想要测试规格 / 测试设计 / 测试范围清单
- 用户想基于 spec 派生必测场景,审阅后再决定是否填实测试代码
- 用户明确说"写测试规格 / 测试场景 / 测试设计 / write-unit-test-spec"

**不要使用此 skill 当**:
- 没有 spec —— 先跑 `/write-spec`
- 想直接写测试代码 —— 用 `/write-unit-test-code`(但前提是已有测试规格)
- 想跑测试 —— 用 `/write-unit-test-code`(它收尾会跑)
- 纯文档 / 配置 / 无行为变更的需求 —— 无可测代码

## 流程

### 1. 前置检查

- 确认 `docs/features/<feature-id>/<前缀>-spec.md` 存在。不存在 → 提示并退出。
- 复用 spec 的 feature-id 和文件前缀,推导出本 skill 的产物文件名 `<前缀>-单元测试-spec.md`。

### 2. 识别项目测试基建(不读业务实现)

读项目的测试**基建**约定,决定测试代码未来放哪、用什么框架、什么命名。识别路径(按顺序尝试,任意一步识别到就停):

- 读 `package.json` 的 `test` script → 推断框架(vitest/jest/mocha)和测试命令
- 找既有测试目录:`__tests__/` / `test/` / `tests/` / `spec/`
- 读 1-2 个既有测试文件 → 推断命名风格、describe/it 用法、文件后缀(只看测试代码风格,不看被测代码)
- 非 JS 项目(python/go/rust)按该语言约定探测(pytest / go test / cargo test)
- 探测不到 → 问用户"测试文件放哪?用什么命名?"

识别结果作为测试规格文档里"测试骨架映射"节的依据(告诉 write-unit-test-code 未来测试文件该放哪)。

### 3. 读 spec 提取测试关注点(只读 spec)

从 `<前缀>-spec.md` 的以下章节派生必测路径:
- 验收标准与测试关注点
- 异常与边界场景
- 业务规则(每条规则通常对应至少一个测试)
- 系统行为(前置条件、触发、输出、失败行为)

把派生出的测试场景按"主路径 / 边界 / 异常"分组,每个场景标 spec 依据。

### 4. 产出测试规格文档

写到 `docs/features/<feature-id>/<前缀>-单元测试-spec.md`。结构轻量,至少包含:

- 测试范围(测什么、不测什么)
- 必测场景清单(按 主路径/边界/异常 分组,每条标 spec 依据)
- 测试骨架映射(未来测试文件路径 `<项目测试目录>/<feature-id>.test.ts` + 每个场景在骨架里的位置)
- 待确认项(spec 不够细时标【待确认】,提示用户回 write-spec 补)

**AI 自己发挥的空间**:具体章节怎么组织、必测场景写多细,agent 按 feature 复杂度判断。简单需求轻量写,复杂需求完整写。

### 5. 汇报 + 不自动继续

告诉用户:
- 测试规格文档路径
- 必测场景数(主路径 / 边界 / 异常 各几个)
- 待确认项(如有)
- 下一步建议:"审阅规格后,可跑 `/write-unit-test-code` 填实测试代码"

**不调用 write-unit-test-code / implementation / write-plan**,由用户决定。

## 产物

| 产物 | 路径 | 形态 |
|---|---|---|
| 测试规格文档 | `docs/features/<feature-id>/<前缀>-单元测试-spec.md` | 人读 markdown,每条必测场景标 spec 依据 + 测试骨架映射 |

## 边界场景

- **spec 不够细** → 测试规格里标【待确认】,提示用户回 write-spec 补,或本 skill 内问 3-5 个关键问题。不硬编造测试场景。
- **已有同模块测试规格文档** → 覆盖前提示用户"已有 <X>-单元测试-spec.md,是否覆盖",不静默覆盖。
- **跨语言项目** → 在规格里标注"本次规格按 <语言> 测试约定写",如果 spec 跨多语言,问用户主语言。
- **纯文档/配置需求** → 检测到 spec 无可测行为 → 提示"本需求无可测代码,不建议用本 skill"并退出。

## 不做的事

- 不读业务实现代码(只看测试基建)
- 不写测试代码(只产规格 markdown)
- 不跑测试
- 不填实断言
- 不改 spec / implementation / write-plan
- 不假设测试框架(运行时探测)

## 和其他 skill 的关系

- **write-spec**:上游,提供输入。
- **write-unit-test-code**:下游,消费本 skill 的测试规格文档,填实测试代码 + 跑测试 + 出报告。
- **implementation**:平行线路,写业务实现代码。本 skill 不依赖它(规格可早于实现产出)。
