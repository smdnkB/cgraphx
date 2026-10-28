# T-9: skill——新增四个

> 产物: plan
> 依据: spec@a8b762a

- 目标:新增 release-start、release-review、dev-start、dev-merge 四个 skill,把 F1~F4、F7、F9、F10 的流程写成 agent 照做的指引
- 对应 spec 编号:F1、F2、F3、F4、F7、F9、F10;K3、K5~K9;D2~D10、D13~D17、D20~D22、D35;全局约束(git 2.38 以上)
- 强制引用:无
- 涉及范围(全部新建):
  - `assets/claude-template/skills/release-start/SKILL.md`
  - `assets/claude-template/skills/release-review/SKILL.md`
  - `assets/claude-template/skills/dev-start/SKILL.md`
  - `assets/claude-template/skills/dev-merge/SKILL.md`
- 必须严格执行:
  - 命令照 C-5(`cgraphx replica …`)、C-6(`cgraphx release guard`)写,参数一字不差
  - 命名与说明照 C-8(版本分支、tag、`合入需求：<标题>` 用全角冒号、`发布 <版本号>:…`、chore(release) 两种、副本目录名、需求分支)
  - 审核报告照 C-9(路径、头部一行、节标题与顺序、取法、结论、过期判断)
  - 给用户看的话照 C-12:用 spec 功能方案里「」内的原句,名字和数字换成实际值
  - 每个 skill 的流程覆盖下表列出的行为链与全部边界,不加 spec 没有的行为
- 允许局部适配:
  - 各节的措辞、范例里的名字和数字
  - 小节怎么分(结构照下方「写法」)
- 写法:
  - 照仓库 CLAUDE.md「写 skill 时尽量直接展示最好案例」:多给可以照抄的命令和输出范例,少写抽象说明
  - 结构参照 `assets/claude-template/skills/dev-impl-subagent/SKILL.md`:frontmatter(`name`、`description`,description 末尾带中文触发词)→ 定位 → 流程(编号步骤,每步给出要跑的 git / cgraphx 命令)→ 范例 → 停下问用户(表格:情况 | 怎么做)→ 红线
  - 每个 skill 开头的流程第 1 步查 git 版本:`git version` 低于 2.38 → 停下,提示升级 git(release-start、dev-start 不用 merge-tree,可不查)
  - 「主干」:`main`,没有 main、有 master 时用 master;「版本分支」:匹配 `^dev/[0-9]+\.[0-9]+\.[0-9]+$` 的分支(K8);「在副本里」:当前项目根下 `.cgraphx/shared` 是符号链接
- 具体要求:
  1. **release-start**(F1、D3、D4、D5):
     - description 触发词:开版本、开始下个版本、发完版开新版本、打 tag 拉版本分支、release start
     - 流程:① 当前分支是主干且 `git status --porcelain --untracked-files=no` 为空,否则停下(F1①);② 本地每个版本分支跑 `git merge-base --is-ancestor <分支> <主干>`,有不成立的停下「<分支> 还没发,先跑 /release-review」(F1③);③ `node -p "require('./package.json').version"` 读版本号,读不到问用户(F1⑤);④ 下个版本默认末位加一,用户说了就用用户的(F1⑥);`dev/<下个>` 已存在且是主干的祖先 → 停下 F1⑦ 原句;⑤ tag:`v<版本号>` 已存在直接用(F1②);仓库一个 tag 都没有 → 候选提交取 `git log -1 --format='%H %s' -G'"version"' -- package.json`,给用户确认后打在它上面(F1④);其余打在主干当前提交;一律 `git tag -a v<版本号> -m "发布 <版本号>"`;⑥ `git checkout -b dev/<下个>`;⑦ `cgraphx release guard --json`,按输出的 `status` 说:`repaired` → 多说一句「提交拦截被钩子工具冲掉过,已补回」;`unsupported` → 把 `notice` 原样转告(没装上的原因;链接、被跟踪的还带要加的几行和加在哪,加不加由用户定),再补一句没有拦截时版本分支上的直接提交发版审核时照样列进疑似夹带(K5),其余步骤照常;⑧ 回报「已打 v2.0.10,开始 2.0.11」,并说明 tag 和分支只建在本地
     - 定位里写明退出:版本做到一半想退出,把主目录切回主干,在主干上 /dev-merge 停下问时回答「不再按版本走」(卸掉提交拦截、清掉按版本走的记号);版本分支和副本都留着
     - 红线:不推送 tag 和分支;不重打已有的 tag;不改版本号
  2. **release-review**(F3、F4、F9、D7、D13~D17):
     - description 触发词:发版审核、出审核报告、准备发版、发版前检查、发吧、合入主干、release review
     - 流程(审核):① 当前分支是版本分支,否则停下;② 取 `<起点>`:照 spec F3「取法」表头,沿版本分支第一父链取——`L=$(git rev-list --first-parent dev/<版本号> --not <主干> --) || exit 1; C=$(printf '%s\n' "$L" | tail -n 1); START=${C:+$C^1}; START=${START:-dev/<版本号>}`(版本期间同步过主干时 merge-base 会移到同步点,不能用;`--` 免得项目根下叫 main 的文件让 git 报歧义,git 报错时停下、原样转告);命令里的 `M^1..M^2`、`M^1` 一律加引号(zsh 开 extendedglob 时 `^` 是通配符);第一父链上两个父提交的合并 M,`git merge-base --is-ancestor "$M^2" <主干>` 成立的是同步主干(K5 不算),其余是合入;取起点和分类放在同一条命令里跑,并打出 `起点 <hash>`,后面各步的 `<起点>` 填这串 hash,不填变量名;一个合入都没有(只有同步主干也算)→ 只回 F3① 原句,手动合并也算合入;③ 按 spec F3「取法」表逐项取事实(表里的命令照抄进 skill,`<起点>` 同上;同步主干单列一节,不归到需求、不进疑似夹带和两个需求都改了的文件);合并预演有冲突时,每个冲突文件查版本分支这边改过它的合并,第二个父提交已在主干里的写「同步主干」,其余写合并说明(和 dev-merge 同一写法);④ 越界改代码按 D14:读该需求 `plan/*-index.md`「任务清单」的涉及范围,没有 plan 读 spec 写到的模块,都没写标「未声明范围」;⑤ 按 C-9 写 `docs/releases/v<版本号>-发版审核.md`,结论按 D15;⑥ `git add` 该文件,以 `chore(release): <版本号> 发版审核报告` 提交;⑦ 对话里给结论和摘要;用户说「先不发」→ 什么都不动
     - 流程(合入主干,用户说「发」时):① 结论是「不能直接合」→ 不合,说明原因;② 过期按 D17:报告头部「审核时最新提交」之后,`git log --first-parent --merges --format=%h <记录的提交>..dev/<版本号>` 有任何输出(第一父链上又出现了合并,不论说明是什么格式;只多了 `chore(release):` 提交不算)→ 提示重跑 /release-review,这次不合(F4①);③ 工作区有改了没提交的已跟踪文件 → 停下(F4③);④ 预演 `git merge-tree --write-tree --name-only <主干> dev/<版本号>`,有冲突停下列出冲突文件;⑤ `git checkout <主干>` 后 `git merge --no-ff dev/<版本号> -m "发布 <版本号>:合入 <标题>、<标题>"`,主干上有不在版本分支里的提交时(`git log --format='%h %s' dev/<版本号>..<主干>` 有输出)把它们逐行写进说明正文(F4②);⑥ 不打 tag、不发布、不推送;⑦ 清理副本(F9):`cgraphx replica list --json`,只有 `merged` 是 true 的放进可以删的那组;其余留着,`ahead` 大于 0 说差几个提交、`merged` 是 false 且 `ahead` 是 0 说还没有提交、`merged` 是 null 说判断不了合没合入;用 F9 原句问;用户说删 → 逐个 `cgraphx replica remove <副本目录名> --json`,`dirty` 时照 F9① 原句报出来、不删;`missing` 时标「已不在」(F9②);⑧ 提示「发布照你们现在的流程走;发完跑 /release-start」
     - 范例:给出一份完整的审核报告范例(照 C-9 骨架,用 spec F3 行为链里的订单导出、退款、积分发放三个需求),以及合入主干后的回报范例
     - 红线:不打 tag、不发布、不推送;报告过期或预演有冲突时不合;不替用户改版本号(只记进风险并提示提交写法);删副本前必须问
  3. **dev-start**(F7、D20~D22):
     - description 触发词:开副本、开需求副本、在副本里做、并行做需求、dev-start
     - 流程:① 在副本里 → 停下,提示到主目录开(同一个需求换会话用 /dev-handoff,不开新副本);② 定名字:feature-id 按 dev-spec 第 0 步和「产物位置与命名」确认(`docs/features/` 下已有就复用),文件前缀 = feature-id 去掉日期段,分支 `feat/<文件前缀>`,bug 修复用 `fix/<文件前缀>`;③ `cgraphx replica create <feature-id> --prefix <文件前缀> --branch <分支> --json`,按返回处理:`created: true` → 第 ④ 步;`created: false` → 直接给启动语(F7②);`dirty_main` → 列出 `files`,停下(F7①);`no_cow` → 用 F7④ 原句问,大小按 `requiredBytes` 换成 GB,用户同意后加 `--full-copy` 重跑;`name_taken` → 副本目录名已登记给别的需求,请用户换个标题或加业务 ID,按新名字重跑(D22);其余 code → 把 message 原样告诉用户,停下;④ 在副本里建两份索引:`cgraphx docs index <副本路径>`、`cgraphx features sync <副本路径>`;⑤ `warnings` 逐条转告(如 F7⑤ 写死路径的虚拟环境);⑥ 给 C-12 的启动语,之后补一句「副本里同步主目录的分支只用 /dev-merge,不要 git pull、git merge——快进同步过,合没合入就判断不准了」(K3 取法的前提);交接的需求之间有依赖时,照 F7③ 说明各开一个副本、合入后在依赖方副本里 /dev-merge 同步
     - 红线:不用 cp 自己复制目录(K1:只有经 cgraphx replica create 开出、登记过的才算副本);不在副本里开副本;主目录有改了没提交的已跟踪文件时不开
  4. **dev-merge**(F2、F9、F10③、D5~D10、D35):
     - description 触发词:合入需求、需求合入、同步版本分支、副本合入、删副本、清理副本、dev-merge
     - 定位里写明:副本里同步主目录的分支只用 /dev-merge(`--no-ff` 产生合并提交);用 `git pull`、默认的 `git merge` 快进同步过,K3 就判断不准
     - 流程(在副本里,不带参数):① 主目录路径 = `.cgraphx/shared` 链接目标的上级目录;② 主目录当前分支 `git -C <主目录> symbolic-ref --short HEAD`(D9);③ 副本里 `git status --porcelain` 有输出 → 先提交;④ `git fetch --no-tags <主目录> <分支>` 后 `git merge --no-ff -m "同步 <分支>" FETCH_HEAD`;有冲突就地和用户一起解决、提交;⑤ 同步带进 `docs/knowledge/` 的改动 → 问一句要不要在副本里跑 `cgraphx docs index`(D10);⑥ 提示「可以合入了：到主目录的会话里输入 /dev-merge <标题>」
     - 流程(在主目录,`/dev-merge <需求>`):① `cgraphx replica list --json` 按副本目录名、feature-id 或标题找到副本,找不到停下;`merged` 是 true → 停下「已经合入过了」;`merged` 是 false、`ahead` 是 0 → 停下「还没有提交」;`merged` 是 null → 说一句判断不了,照常往下走;①′ 当前分支是主干,且 `git config --local --get cgraphx.releaseFlow` 为 `true`(D5:发完版还没跑 /release-start)→ 停下问:先 /release-start、这次合进主干、还是不再按版本走(`cgraphx release guard --remove --json`;返回 `unsupported` 时拦截那几行是提交在仓库里的,把 `notice` 原样转告);② 主目录 `git status --porcelain --untracked-files=no` 有输出 → 停下(F2④);③ 副本 `dirty` 不为空 → 停下,提示先在副本里提交(F2②);④ `git fetch --no-tags <副本路径> <需求分支>`(D6:不加远程、不建本地分支);⑤ 预演 `git merge-tree --write-tree --name-only HEAD FETCH_HEAD`,有冲突 → 分支不动,每个冲突文件用 D7 的 `git log --first-parent --merges --format='%H %s' <起点>..HEAD -- <文件>` 找出撞上的合并,第二个父提交已在主干里的写「同步主干」(提示写「<文件>:主干上的改动也改过」),其余写合并说明,照 F2① 原句提示;⑥ 合并说明照 C-8,第 N 次:开了版本(当前分支是版本分支)从版本起点数第一父链上同标题的合入,起点照 F3 取法表头沿第一父链取(`L=$(git rev-list --first-parent HEAD --not <主干> --) || exit 1; C=$(printf '%s\n' "$L" | tail -n 1); START=${C:+$C^1}; START=${START:-HEAD}`,git 报错时停下、原样转告),用到 START 的每段命令都把这一行写在同一条命令开头(每次调用是新的 shell,空的 START 会让范围变空、结果为空却不报错);没开版本从该副本登记的 `createdAt` 之后数;⑦ `git merge --no-ff -m "<说明>" FETCH_HEAD`;⑧ 回报「已合入：<N> 个提交，改了 <M> 个文件;副本留到发版后清理」,N = `git rev-list --count --no-merges "HEAD^1..HEAD^2"`,M = `git diff --name-only "HEAD^1" HEAD` 的行数(`^` 表达式一律加引号);⑨ 合入带进 `docs/knowledge/` → 问一句要不要在主目录跑 `cgraphx docs index`(D10);⑩ 没开版本(当前分支不是版本分支)→ 合完直接问要不要删这个副本(F10③),同意就 `cgraphx replica remove <副本目录名> --json`
     - 流程(删副本,用户说「删副本 <需求>」):`cgraphx replica list --json` 看 `merged` 和 `dirty`;没合入的说明差几个提交,还没有提交的照实说,问过用户再 `cgraphx replica remove`;`merged` 是 null → 不删,请用户先在副本里确认提交都已合入;`dirty` 照 F9① 原句报出来
     - 红线:不把副本加成远程;预演有冲突不合;版本分支上只做合并,不改代码;删副本前必须问;不推送;没问过不跑 `cgraphx docs index`
- 完成条件:
  - 四个 SKILL.md 都有 frontmatter(`name` 与目录名相同)、定位、流程、范例、停下问用户、红线
  - 上表列的 F 编号行为链与边界,每一条都能在对应 skill 里找到落点
  - 全文出现的合并说明只用全角「合入需求：」
  - git 输出文件路径的命令(`status`、`diff`、`merge-tree`)都带 `-c core.quotePath=false`,中文路径原样显示
- 提交点:
  1. `feat(skills): 版本流程——release-start 开版本 + release-review 发版审核与合入主干`:`assets/claude-template/skills/release-start/SKILL.md`、`assets/claude-template/skills/release-review/SKILL.md`
  2. `feat(skills): 需求副本——dev-start 开副本 + dev-merge 合入与清理`:`assets/claude-template/skills/dev-start/SKILL.md`、`assets/claude-template/skills/dev-merge/SKILL.md`
- 风险/注意事项:
  - skill 只写在 `assets/claude-template/`;本仓库根目录 `.claude/` 不手改
  - release-review 的取法、结论、报告格式只写一份在 skill 里,与 spec F3 取法表、C-9 保持一致;spec 改了这一节要同步
