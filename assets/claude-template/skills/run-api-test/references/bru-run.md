# R3 跑测试规范

## bru run 命令

```
bru run docs/bruno/<服务>/<接口名>/ --env local --output <临时 JSON 路径> -r
```

### 参数说明

| 参数 | 说明 |
|---|---|
| 路径参数 | R1 清单涉及的接口目录(从 api-spec §5 取),不是全项目 `docs/bruno/` |
| `--env local` | 使用 `docs/bruno/environments/local.bru` 的变量(用户切换时透传 `--env staging` / `--env production`) |
| `--output <path>` | JSON 中间结果输出路径(临时,跑完即丢,不归档) |
| `-r` | 递归跑目录下所有 .bru |

### 跑哪些接口

**只跑 R1 清单涉及的接口目录**,不是全项目 `docs/bruno/`。

理由:用户指定需求或接口后,范围已锁定;跑全项目是另一个场景(全量回归),用户应自行 `bru run docs/bruno/ -r`,不归本 skill 管。

### 多接口目录的处理

R1 清单可能涉及多个接口目录(如 `getUser/` + `createUser/` + `common/login/`)。两种跑法:

- **分批跑**:每个接口目录单独 `bru run`,结果汇总(更细粒度,易定位崩溃)
- **合并跑**:把所有路径作为参数一次跑(bru run 支持多路径参数)

推荐**分批跑**——某个接口目录崩溃时不影响其他接口,且日志更清晰。

## 失败处理

### 单接口失败(bru run 正常返回,但某些接口 HTTP 错或断言失败)

不算崩溃,继续 R4。失败的接口在 JSON 中间结果里有状态,汇总到 R5 报告。

### bru run 整体崩溃(进程退出非 0,非单接口失败)

报"测试执行器异常" + 输出 bru 原始 stderr,**不继续 R4**。

崩溃常见原因:
- bruno CLI 版本 bug
- .bru 文件语法错(write-api 生成的 .bru 不符合 bruno-lang v2)
- 环境配置错(env 文件读不了)

崩溃时不继续 R4——继续也没意义(JSON 中间结果可能不完整);让用户判断是修 .bru、调 bruno 版本,还是回 write-api 重新生成。

## JSON 中间结果

`bru run --output <path>` 产出的 JSON,**临时产物,不归档**。

理由:JSON 是 bruno 的执行原始记录,字段多且对用户不友好;最终给用户看的是 R5 的 Markdown 报告 + JSONL 验证记录。JSON 跑完即丢。

## bru CLI 版本

测试工具是开源 bruno(`@usebruno/cli`),要求项目已装 bru CLI(`npm install -g @usebruno/cli` 或项目本地装)。

若 bru 命令不存在 → 报"未找到 bru CLI,请先装 `npm install -g @usebruno/cli`"并退出。
