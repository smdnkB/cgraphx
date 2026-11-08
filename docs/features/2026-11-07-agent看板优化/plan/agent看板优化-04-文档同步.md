# T-4: 文档同步

> 产物: plan
> 依据: spec@67abbc8

- 目标:仓库说明与变更记录跟上「看板任务挂版本、按版本过滤」和「看板经 release 门面取版本历史」。
- 对应 spec 编号:D15、spec「文档」表
- 强制引用:无
- 涉及范围:
  - `CLAUDE.md`
  - `CHANGELOG.md`
- 必须严格执行:
  - `CLAUDE.md`:
    - 架构段 board 那句「只经 project、timeline、features、replica、agents 五个门面取数」改成六个,加 release;同一段补一句:任务带版本(合入过的版本分支,或副本起点分支当计划版本,现算不写绑定),页头可按版本过滤。
    - 「本仓库是什么」段 board 的描述同步加「按版本过滤」。
    - release 那句职责补上「为看板只读读出版本历史(各版本分支那一段的合入、tag)」。
  - `CHANGELOG.md`:在 `## Unreleased` 下加一节 `### Added — board shows versions and filters by version`,英文,和现有条目同样风格:说明任务旁显示版本(released / 未发 / planned / missed)、顶部下拉按版本过滤并显示任务数、选了版本时本机没有会话的任务也列出、版本从合入记录和副本起点分支现算不新增记录。
  - 写的事实和 spec 一致,不写 spec 里没有的行为。
- 允许局部适配:
  - 措辞、句子放在段内的位置。
- 具体要求:
  1. 按上面改两个文件。
- 完成条件:
  - `grep -n "五个门面" CLAUDE.md` 在 board 相关处无结果。
  - CHANGELOG 新节在 `## Unreleased` 下、第一个 `###` 之前。
- 提交点:
  1. `docs: 看板任务挂版本——CLAUDE.md、CHANGELOG 同步`:`CLAUDE.md`、`CHANGELOG.md`
- 风险/注意事项:
  - `CLAUDE.md` 很长,只改 board、release 相关的句子,不动别的段落。
