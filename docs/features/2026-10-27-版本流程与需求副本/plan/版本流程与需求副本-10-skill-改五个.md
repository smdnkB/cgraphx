# T-10: skill——改五个

> 产物: plan
> 依据: spec@3eef166

- 目标:dev-impl-subagent 不再在 main / master 上停下问分支、改查版本分支;dev-impl 加同样的检查;dev-handoff 按 D23 开副本;dev-spec 复用 /dev-start 建的目录;doc-report 按需求出报告时路径用项目内路径
- 对应 spec 编号:F2⑥、F7(交接一句、「之后 /dev-spec 直接复用这个需求目录」)、F8(/doc-report)、F10、D11、D22、D23、D34、D36
- 强制引用:无
- 涉及范围:
  - `assets/claude-template/skills/dev-impl-subagent/SKILL.md`
  - `assets/claude-template/skills/dev-impl/SKILL.md`
  - `assets/claude-template/skills/dev-handoff/SKILL.md`
  - `assets/claude-template/skills/dev-spec/SKILL.md`
  - `assets/claude-template/skills/doc-report/SKILL.md`
- 必须严格执行:
  - 版本分支一律写成匹配 `^dev/[0-9]+\.[0-9]+\.[0-9]+$` 的分支(K8)
  - 命令照 C-5,启动语照 C-12,命名照 C-8
  - 只改下面列出的地方,其余段落不动
- 允许局部适配:
  - 措辞和句子在段落里的位置
- 具体要求:
  1. **dev-impl-subagent**(D11、D36):
     - 「开跑前」第 1 条「看分支:当前在 main 或 master 上,先停下问用户要不要建分支。」改成:「看分支:当前分支是版本分支(匹配 `^dev/[0-9]+\.[0-9]+\.[0-9]+$`)就停下,提示先 `/dev-start <需求>` 开副本;其余分支(包括 main)直接在当前分支上做。」
     - 「停下问用户」表第一行「开跑前发现在 main 或 master 上 \| 先不派任务,问要不要建分支」改成「开跑前发现在版本分支上 \| 先不派任务,提示先 `/dev-start <需求>` 开副本」
     - 红线 2「不在 main 或 master 上直接开跑。」改成「不在版本分支上直接开跑。」
  2. **dev-impl**(D11):「流程」第 1 步「理解输入」开头加一句:「先看当前分支:是版本分支(匹配 `^dev/[0-9]+\.[0-9]+\.[0-9]+$`)就停下,提示先 `/dev-start <需求>` 开副本。」
  3. **dev-handoff**(D23、F7 交接一句):
     - 流程第 1 步确认 feature-id 之后加「要不要开副本」的判断(D23):主目录在版本分支上 → 每个交接目标开一个副本;不在版本分支上、`cgraphx replica list --json` 里有在用的副本 → 默认开,写交接文件前说一句「这几个交接目标各开一个副本」,用户说不开就照旧;没开过副本 → 照旧,不提;在副本里交接(同一个需求换个会话)不开新副本
     - 开副本时第 3 步的顺序:先给每个目标开副本——文件前缀 = feature-id 去掉日期段,分支 `feat/<文件前缀>`(bug 修复 `fix/<文件前缀>`),跑 `cgraphx replica create <feature-id> --prefix <文件前缀> --branch <分支> --json`:`dirty_main` → 列出 `files`,停下;`no_cow` → 问用户「这块盘不能快速复制,要整份复制 <大小>,继续吗?」,同意后加 `--full-copy` 重跑;`created: false` → 复用已有副本;其余 code → 把 message 原样告诉用户,停下;开成后在副本里跑 `cgraphx docs index <副本路径>`、`cgraphx features sync <副本路径>`。讨论稿和主任务目录下没提交的文件随主任务的副本移过去。再把交接文件写进各副本的 `docs/features/<feature-id>/`
     - 开了副本时,非主任务的交接文件:「功能方案」节照抄本会话负责的功能点行(不再写「终确认的讨论稿:<路径>」),「共享背景」节照抄主任务交接文件里的共享背景,不再写「见主任务交接文件」
     - 第 4 步启动语:开了副本时用 C-12 的「在 <副本绝对路径> 开新会话，输入：先读 docs/features/<feature-id>/<文件前缀>-交接提示词.md 再继续。」;没开副本照旧
     - 「交接文件样例」不动(没开副本的写法);在样例后加一段「开了副本时」的差别说明(上面三条)
  4. **dev-spec**(D22、F7):「工作流程」第 0 步末尾「用户已给 feature-id,或目录已由 clarify 讨论稿、`/dev-handoff` 建立 → 直接复用。」改成「用户已给 feature-id,或目录已由 clarify 讨论稿、`/dev-handoff`、`/dev-start` 建立 → 直接复用。」(改之前先 grep 这句,和文件里的原文逐字对上再改)
  5. **doc-report**(D34):「采集 timeline 数据」一节加两句:「按需求出报告(阶段总结里的某个需求)时,会话和产出取 `cgraphx task show <需求> --json`,其中的路径已换成项目内路径。按时间窗出报告时,事件里落在副本目录下的绝对路径,按 `cgraphx replica list --json` 列出的副本路径换成项目内路径再写进报告。」
- 完成条件:
  - `assets/claude-template/skills/dev-impl-subagent/SKILL.md` 里不再出现「先停下问用户要不要建分支」「不在 main 或 master 上直接开跑」
  - dev-impl、dev-impl-subagent 都含 `dev/[0-9]+`
  - dev-handoff 写明了 D23 的三种情形、开副本时的顺序、非主任务文件的照抄写法、副本启动语
- 提交点:
  1. `feat(skills): 按需启用版本流程——dev-impl 系不再停下问分支、改查版本分支`:`dev-impl-subagent/SKILL.md`、`dev-impl/SKILL.md`
  2. `feat(skills): dev-handoff 交接到副本 + dev-spec 复用 /dev-start 的目录 + doc-report 用项目内路径`:`dev-handoff/SKILL.md`、`dev-spec/SKILL.md`、`doc-report/SKILL.md`
- 风险/注意事项:
  - dev-impl-subagent 红线 5「不用 git worktree」保留不动
  - skill 只改 `assets/claude-template/` 下的源文件
