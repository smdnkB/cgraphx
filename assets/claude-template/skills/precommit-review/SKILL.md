---
name: precommit-review
description: 提交前审查 staged diff 的可疑修改。Use when 被 precommit-check hook 拦截后 / git commit 前审查 / 提交前自检 / 检查可疑修改 / 被注释的开关 / 未闭合逻辑 / 魔法字符串 / 临时标记。agent 自己跑 git diff --cached 逐项判断,不做脚本正则。
---

## 何时用

- precommit-check hook 拦截了你的 `git commit`,要求审查 → 立刻用本 skill
- 主动想在提交前自检可疑修改
- 任何"提交前再过一遍"的兜底场景

## 你要做什么

本 skill 不做脚本正则匹配 —— 你(agent)自己跑 git 命令拿 diff,逐项判断。

### 步骤

1. **列暂存文件**:`git diff --cached --name-status` —— 看哪些文件是 M/D/R(非纯新增)
2. **拿实际改动**:`git diff --cached` —— 取 staged-vs-HEAD 的完整 diff
3. **逐项审查**(下面清单),每命中一项就记下来
4. **把发现讲给用户**,问是否放行
5. 若干净或用户确认 → 用 `CGRAPHX_PRECOMMIT_REVIEWED=1 git commit ...` 重试提交(带这个 env 前缀,precommit-check hook 会放行)

### 审查清单(逐项判断,不是正则)

- **被注释的开关**:新增的 `// @Component` / `// @Service` / `// @JmsListener` / `// @Scheduled` / `// @ConditionalOnProperty` / `// @Bean` / `// @EventListener` / `// @PostConstruct` 等。Spring 注解被注释 = bean 不加载 / 监听不触发 / 定时不跑 —— 高危,直击历史事故
- **被注释的业务调用**:新增的 `// executorService.submit(...)` / `// consumer.connect()` / `// consumer.listenTopic(...)` / `// consumeMessage(...)` / `// .start()` / `// .run()` 等。关键链路被注释 = 功能静默失效
- **未闭合的逻辑**:新增代码块括号失衡、`if`/`try`/`for` 没有配对的 `}`/`catch`/`)`、`return` 在不该断的地方 —— 编译器能抓多数,但看一眼补齐
- **写死的魔法字符串/数字**:可疑硬编码(密码、URL、ID、阈值)写死在代码里 —— 应抽常量
- **TODO/FIXME/临时/暂时**:新增行里带这些标记,确认是否应提交还是该当下处理掉

### 判断原则

- 只看**本次新增的**改动(diff 里 `+` 开头的行),不看历史代码
- 命中任何一项都该 surface 给用户,让用户决定
- 不替用户改代码 —— 你只审查、报告、等指示

## 输出格式

把发现的每一项按 `文件:行号 + 类别 + 原文` 列给用户,例如:

```
[关闭的开关] zqassis-service/.../CTGMQConsumerRunner.java:30
  +//@Component    ← bean 不再装载,确认是否有意

[被注释的业务调用] zqassis-service/.../CTGMQConsumerRunnerPull.java:49
  +//        executorService.submit(this::consumeMessage);    ← 关键链路被关,确认是否有意
```

若一项都没命中,明说"未发现可疑修改",提示可用 `CGRAPHX_PRECOMMIT_REVIEWED=1 git commit ...` 提交。
