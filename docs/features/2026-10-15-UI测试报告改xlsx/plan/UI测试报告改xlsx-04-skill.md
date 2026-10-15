# Skill 计划: UI测试报告改xlsx

> 上级:`UI测试报告改xlsx-index.md` · spec:`../UI测试报告改xlsx-spec.md`

### T-4: run-ui-test skill + FLOW-MAP 同步

- 目标:run-ui-test 的 R6 改为「写结构化结果 JSON → 调用 `cgraphx report ui-test`」,产物描述全部改为 xlsx + JSON + 截图
- 对应 spec 条款:§2、§3(作为 report-format.md 的内容来源)、§5、§6
- 强制引用:无(只改 markdown 资产)
- 依赖:T-2(命令须已存在)
- 涉及范围:`assets/claude-template/skills/run-ui-test/SKILL.md`、`assets/claude-template/skills/run-ui-test/references/report-format.md`、`assets/claude-template/FLOW-MAP.md`(只改 UI 功能测试流程的「产物」一行)
- 必须严格执行:
  - SKILL.md 只改 spec §6 表格列出的环节:「feature-id 与文件前缀规则」中的产物文件名、R6、「收尾」、「质量检查」,以及「异常速查」中新增一行「生成命令校验失败 → 按报错修正 JSON 后重新执行命令，不重跑用例、不改结果判定」。R0–R5、HARD-GATE、状态枚举、触发逻辑一字不改
  - R6 写法：先给出完整的执行顺序 ① 写 `<文件前缀>-ui功能测试结果.json`(格式见 report-format.md)② `cgraphx report ui-test docs/features/<feature-id>/ui功能测试/<文件前缀>-ui功能测试结果.json` ③ 退出码 2 时按 stderr 逐条修正 JSON 后回到 ②
  - 质量检查：第一条改为「JSON、xlsx、截图归指定 feature 目录的 `ui功能测试/`,截图按功能点命名」,并新增两条:「结构化结果 JSON 已写出，且 `cgraphx report ui-test` 以退出码 0 生成了 xlsx」「目录中没有旧的 md 报告」
  - 收尾：提示 xlsx 位置、JSON、截图目录、通过 / 失败 / 跳过汇总、失败清单与原因，以及下一步建议(原 md §4 四条，原文保留)。并写明「下一步建议只在对话中给出，不写入报告」
  - report-format.md 整体重写，只保留以下内容:产物表(spec §2 三类)、报告归属规则(不变)、**结构化结果 JSON**(字段表 + 视结果必填表 + spec §3.4 完整示例，与 spec §3 逐字段一致)、**xlsx 结构**(两个工作表的说明，与 spec §5 一致，并注明「由命令生成,agent 不手写」)、状态枚举、「前置暂停不记入报告」。删除「不产 JSONL——无程序化消费方」和 md 报告的五节示例
  - FLOW-MAP.md:产物行改为 `docs/features/<feature-id>/ui功能测试/`(用例规格 + xlsx 报告 + 结构化结果 + 按功能点命名的截图)
  - 全文不再出现 `-ui功能测试报告.md`。存量兼容只在 report-format.md 里提一句：旧 md 报告在重跑生成成功后由命令删除
- 允许局部适配:措辞与段落组织(写法沿用 skill 现有风格，直接给出最好的案例，不写冗长介绍)
- 完成条件:`grep -rn "ui功能测试报告.md" assets/claude-template` 只命中 report-format.md 中的存量兼容那一句;`npm run build` 通过(模板会复制到 dist)
- 验证方式:人工通读 SKILL.md 中 R6 → 收尾的链路，确认与 spec §6 表格逐行对应;核对 report-format.md 的 JSON 示例与 spec §3.4 字段一致(可以用 `node -e` 把两处示例代码块提取出来，`JSON.parse` 后比较)
- 独立提交:是;主题 `feat(skills): run-ui-test 报告改 xlsx——结构化结果 + 生成命令`
- 风险/注意事项:不要改根目录 `.claude/skills/run-ui-test/`(那是已部署的环境，由 `cgraphx install` 覆盖)
