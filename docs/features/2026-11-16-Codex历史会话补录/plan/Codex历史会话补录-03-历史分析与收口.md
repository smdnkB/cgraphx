# T-3：历史分析与收口

> 产物: plan
> 依据: spec@7e9527f

- **目标**：恢复 task-history 的需求事件关联与活跃时长口径，提供可在既有宿主部署调用的 dev-end / task-history 技能。
- **对应 spec 编号**：F2、F3、K5–K8、K10、D5–D8、D11。
- **强制引用**：无（仅修改技能与命令模板）。
- **涉及范围**：`assets/claude-template/skills/task-history/SKILL.md`（新）、`assets/claude-template/skills/dev-end/SKILL.md`（新）、`assets/claude-template/commands/dev-end.md`、`assets/claude-template/deprecated-assets.json`。
- **必须严格执行**：C-2、C-3、C-4；从 Git 历史 `7189124^:assets/claude-template/agents/task-history.md` 取旧工作量依据；以本需求 spec K5–K8 和用户的混合会话展示选择优先于旧模板相抵触之处。
- **允许局部适配**：skill 文本的组织和内部辅助脚本写法可以调整；不得改变技能名、宿主部署入口、统计与来源口径；超出涉及范围按 PLAN_CONFLICT 上报。
- **具体要求**：
  1. 以旧 task-history 的提交骨架、独占文件、提问关键词、时间窗口和逐会话核查恢复需求归属；分页完整获取事件，不能把看板窗口或全项目事件直接计入单需求。
  2. 按 C-3 分别计算下界/上界，以结果填充收口档案的日历跨度和实际投入小时范围；明确缺证据不写 0，原始会话回退须标非 timeline 实测；混合会话直接给范围，不额外标不确定性。
  3. 新建 `dev-end` skill，保留原有收口档案章节、来源真实性、上线/发布规则，与原命令模板形成一致的可调用入口；避免旧命令与新技能出现相反的历时要求。`task-history`、`dev-end` 均由现有资产目录部署，不恢复废弃 agent 文件或旧任务表。
  4. 明确 `dev-end` 获取需求、提交范围、实际测试报告、补录状态和历史结果；知识命中/缺口/新确认引用 AI 会话须查原始 transcript 并留可定位证据，缺原文不得反推冒充。
  5. 检查 `deprecated-assets.json` 保留旧 agent 清理且不误删新 skill；Codex 的技能名和调用形式与 C-4 一致，可安装宿主遵循各自现有部署规则。
- **完成条件**：范围内模板形成一致的调用链，构建复制后可在 `dist/.claude-template/skills/` 找到两份技能；`npm run build` 成功；既有测试不变红。
- **提交点**：1 笔 `feat(skills): 恢复需求历史分析与收口技能`，仅包含上述 T-3 文件。
- **风险/注意事项**：原规则的「timeline 实测」仍是事件代理，非精确人工工时；按用户指定不额外标混合会话不确定性，但缺数据与非 timeline 回退必须如实说明。
