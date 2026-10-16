# 交接提示词:需求② cgraphx 接入研发管理平台

> 用法:在 cgraphx 仓库(`/Users/smdnk/objects/ai/cgraphx`)打开新会话,把下面分隔线之间的内容整段粘贴发送。开始前先确认研发管理服务端在运行(`curl http://localhost:8080/api/health` 返回 `{"ok":true}`)。

---

开始需求②「cgraphx 接入研发管理平台」:让本地 cgraphx CLI 能接入研发管理服务端,并把本地采集的数据上报到平台。按流程推进:knowledge-recall → /clarify-requirements → /write-spec → /write-plan → 实现 → 测试,每个阶段做完先停下,等我确认后再进下一步。

开始前先绑定开发任务:在 web(研发管理平台)上为本需求建一个任务并认领,然后 `cgraphx task use T-<任务号>`;如果还没建平台任务,用 `cgraphx task use cgraphx接入平台 --manual` 先建本地手动任务(本仓库已配置外部任务源,不带 `--manual` 会去平台查找)。spec 写好后头部写 `> 任务: <同一个值>`。

## 已锁定的决策(来自需求①,澄清时据此确认细节,不要推翻)
- 接入:用平台账号登录,按本地 git 远程地址匹配平台项目;仓库未登记、账号停用、不是项目成员都拒绝,且不上报任何数据。换取的长期凭据存本地。
- 上报:本地数据 1 小时内在平台可见;离线积压联网后自动补传,一条不丢;员工可随时手动立即同步。
- 现有约束不变:hook 里不发网络请求(每个 hook 约 5ms,不能因网络阻塞 Claude Code)。
- 上报白名单:时间、会话 id、事件类型、工具名、skill 名、绑定段(任务 id 形如 `T-<n>`)、commit(hash / message / 分支 / 文件 / 增删行)、产出指针(本地按 cgraphx 路径约定映射成平台产物类型后声明)、参考(本地推断出的路径与概念名)。路径一律仓库内相对路径。**绝不上传** prompt 原文、命令原文、代码内容、命令输出。
- 任务源:平台 `GET /api/client/v1/tasks` 已兼容 `.cgraphx/task-source.json` 契约,接入时可自动写好该配置。
- 本地 cgraphx 既有业务规则与本地 web 不变;改动属于本地采集端,要单独评审。

## 必读(事实来源,不要凭印象)
- 客户端协议契约:`/Users/smdnk/objects/ai/cgraphx-server/packages/contract/src/client.ts`、`enums.ts`(`ArtifactType`、`CLIENT_ERROR_CODES` 含 `internal_error` / `payload_too_large`,413 表示请求体过大、可拆批重试)。契约已发布,只增不改。
- 服务端如何处理上报:`/Users/smdnk/objects/ai/cgraphx-server/apps/server/src/domain/ingest.ts`(幂等键、路径拦截规则、绑定段解析),代码地图 `/Users/smdnk/objects/ai/cgraphx-server/docs/code-map/flows/客户端接入与上报.md`。
- 需求① spec:`/Users/smdnk/objects/ai/cgraphx-server/docs/features/2026-10-15-研发管理服务端/研发管理服务端-spec.md` §5.1–5.2(产物类型与产出记录)、§7(数据接入协议)。
- 本地现状:知识库 `docs/knowledge/开发任务.md`、`开发任务绑定.md`、`会话id来源约束.md`、`git提交记录须在钩子当下固定hash.md`;代码 `src/core/task/{source.ts,resolve.ts,artifacts.ts}`、`src/core/timeline/`。

## 当前环境(已就绪)
- 服务端:`~/objects/ai/cgraphx-server`,`pnpm dev` 启动后接口在 `http://localhost:8080`。
- 本仓库已接入:平台项目「cgraphx」已登记本仓库(`https://github.com/smdnkB/cgraphx.git`),`.cgraphx/task-source.json` 已写好(含 liulongfei 的上报凭据,目录已被 git 忽略)。平台任务 T-23「研发管理服务端」已由 liulongfei 认领。
- 已知服务端遗留问题见 `/Users/smdnk/objects/ai/cgraphx-server/docs/issues/2026-10-15-第一期遗留问题.md`,其中 P1(每次接入都发新凭据,旧的不作废)、P4(回执「已接收条数」口径不统一)与客户端设计相关,澄清时考虑进去。

## 完成标准
本地 cgraphx 接入平台并上报后,在平台任务详情与「我的工作量」里能看到本仓库的会话、时长、commit 与产出;离线后联网能补传;重复上报不重复计数。
