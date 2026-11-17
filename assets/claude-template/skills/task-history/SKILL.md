---
name: task-history
description: 从 cgraphx 时间线反查一个需求的开发历史与实际投入(活跃时长,到小时)。用提交、独占文件、提问关键词、时间窗四类锚点关联事件,分页拉全量、按本地日期分组、间隔超 1 小时断开累计活跃段,给下界~上界小时范围;时间线覆盖不足时回退原始会话估算并标非 timeline 实测,仍不足写无法估算。$dev-end 收口档案的「历时」节由本 skill 供数。Use when 任务考古 / 还原开发历史 / 这个需求怎么开发的 / 迭代过几轮 / 实际投入多久 / 活跃时长 / 工作量 / 收口档案历时 / 跨会话查某需求。
---

# 任务历史分析 (task-history)

## 定位

- **按需求实体反查**:从时间线还原一个需求被哪些会话讨论/改动、跨了几轮、去间隔真实活跃多久。与 doc-report 分工——那个按时间窗出日报周报,这里按需求反查。
- 典型消费方是 `$dev-end` 收口档案的「历时」节:它直接抄本 skill 返回的「工作量结论」,不会再自己查时间线——你的返回就是它看到的全部。
- 被子 agent 隔离调用时,上万条事件 JSON、逐会话钻取等中间过程不回传,只回浓缩报告。

## 输入(缺了自己先补)

- 目标需求:feature-id / 编号 / 名称
- git 仓路径 + SHA 范围(或时间窗);缺时间窗先结合需求目录、提交关键词、相关代码及会话证据确定候选范围;不得仅按需求目录的提交限制时间窗

## 核心认知:时间线不认识「需求」

时间线记的是**项目级事件流**(每条带 `session_id` / `turn_id` / `prompt_text` / `commit_files` / `tool_args.file_path`),没有任务标签;一个会话还可能混多个需求。「按需求查」不是原生查询,是用锚点反推检索拼出来的——归属是**推断结果**,不是系统查询结果。

## 四个锚点(按可靠性排序)

| 锚点 | 可靠性 | 注意 |
|---|---|---|
| commit SHA / commit_message 关键词 | 最高 | 每个 commit 属于且仅属于一个需求 |
| prompt_text 关键词 | 高 | 用**需求特有词**(如「分档」「去重器」「回单口径」);通用词(「活动」「任务」「流程」)会串到别的需求;排除以 `<task-notification>` 开头的子 agent 回调 |
| 特征文件 `--file` | 看文件 | **先判独占/共享**(铁律见下);`--file` 是 substring 匹配 `tool_args.file_path` 或 `commit_files` |
| 时间窗 `--since/--until` | 辅助 | 消掉历史与未来的串扰,消不掉窗口内并行需求 |

**特征文件先判独占/共享(铁律)**:用 `--file` 前先 `git log --oneline -- <文件>`——提交全属本需求 → 独占,干净可用;横跨多个需求编号 → 共享文件,单独用必串,只能叠加时间窗,且主锚点退到 commit + prompt 关键词,文件仅作佐证。

## 拉全量事件(必须分页,不能只拉一页)

非分页查询默认只给最近 100 条、`--limit` 单次最多 10000——**算时长必须用 `--paged` 翻页拉全**,翻到 `next_cursor` 为 null:

```bash
# 首页:带筛选条件与页大小;stderr 会出一行「[timeline] 补录状态: complete|partial|blocked」,记下来
cgraphx timeline query --paged --format json --type=git_commit --since=<d> --until=<d> --limit=1000
# 续页:只带 --cursor(条件随游标,再带筛选或 --limit 会报参数错误、退出码 3)
cgraphx timeline query --paged --format json --cursor <上一页的 next_cursor>
```

- 输出 `{"events": [...], "next_cursor": "..."|null}`,按 `(ts,id)` 升序;同一轮翻页是稳定快照,同时间戳不漏不重。
- 续页报参数错误且提示库文件更换 → 数据库换过,游标作废,从首页重新拉一遍。
- 整轮循环可以直接用脚本攒(首页参数传命令行,续页只传游标;stderr 状态行直通终端):

```python
# pull.py —— 用法: python3 pull.py --type=user_prompt --since=<d> --until=<d> --limit=1000 > all.json
import json, subprocess, sys

args = ['cgraphx', 'timeline', 'query', '--paged', '--format', 'json'] + sys.argv[1:]
events = []
while True:
    out = subprocess.run(args, stdout=subprocess.PIPE, text=True, check=True).stdout
    data = json.loads(out)
    events += data['events']
    if not data['next_cursor']:
        break
    args = ['cgraphx', 'timeline', 'query', '--paged', '--format', 'json',
            '--cursor', data['next_cursor']]
json.dump(events, sys.stdout, ensure_ascii=False)
```

**补录状态进报告**:`complete` 才算时间线完整;`partial`(单文件失败/无来源/无法归属)或 `blocked`(锁竞争/采集关闭/旧库未合并/库不可用)→ 时间线可能缺事件,但已成功部分仍是有限证据——事件够算就照算、在「覆盖」里注明原因,不够算走「覆盖不足」。具体原因沿用状态行后面的 stderr 提示,一并带回。

## 三步还原

1. **commit 定骨架**:git 侧 `git log --all -i --grep="<需求编号或关键字>" --format="%h author=%aI %s"`,结合需求目录、独占代码文件提交及会话证据核对首末边界(优先看 author date——批量 rebase 会改写 commit date);不要仅以需求目录提交的首末日期截断开发过程。时间线侧分页拉 `--type=git_commit` 对时间戳；候选边界不能可靠确定时扩大检索,以证据筛选,不编造提交范围。
2. **特征文件扩展**:对骨架 commit 的核心改动文件逐个判独占/共享;独占的用 `--file=<文件>` 分页反查所有动过它的会话。
3. **prompt 关键词补纯讨论会话**:分页拉 `--type=user_prompt`,按需求特有词搜 `prompt_text` 聚合 `session_id`——澄清/探索/被中断的分支没有提交,只有这步捞得到。

三步捞到的会话合并去重 → 本需求的会话列表。**混合会话必须逐轮看** `prompt_text` / `tool_args` 判断哪几轮属于本需求,不把整段无条件算给本需求。

## 活跃时长(下界/上界各算一遍)

先把捞到的全部相关事件**按 `id` 去重**(多锚点捞同一事件只算一次),再分两份事件集——不把全项目事件、看板窗口或混合会话全部时长直接计入(看板的会话-需求命中只作参考,口径与本 skill 不同):

- **下界事件集(明确归属)**:本需求的 commit 事件、独占文件的工具事件、只做本需求的会话轮的事件。
- **上界事件集**:下界 + 混合会话里有依据的候选轮(prompt / 改动内容指向本需求)。

两份**各跑同一算法**:

1. 按本地日期分组(跨午夜按本地日期分开),组内按时间升序;
2. 相邻间隔 **>1 小时断开,≤1 小时(含整 1 小时)连续**;
3. **每段至少 2 个带时间事件才可计算**,单事件段丢弃(不写 0);
4. 段时长 = 首末时间差,合计 = 各段之和。

```python
# active-hours.py —— 用法: python3 active-hours.py <events.json>(JSON 数组,元素含 id/ts)
import sys, json
from datetime import datetime, timedelta
from collections import defaultdict

events = json.load(open(sys.argv[1], encoding='utf-8'))

def parse(t):
    try:
        return datetime.fromisoformat(str(t).replace('Z', '+00:00')).astimezone()
    except ValueError:
        return None

seen, byday = set(), defaultdict(list)
for e in events:                                  # 同一事件多锚点捞到只算一次
    if e.get('id') in seen:
        continue
    seen.add(e['id'])
    t = parse(e.get('ts'))
    if t is not None:
        byday[t.strftime('%Y-%m-%d')].append(t)

GAP = timedelta(hours=1)
total = timedelta()
for d in sorted(byday):
    ts = sorted(byday[d])
    segs, s, p, n = [], ts[0], ts[0], 1
    for t in ts[1:]:
        if t - p <= GAP:
            p = t; n += 1
        else:
            segs.append((s, p, n)); s = p = t; n = 1
    segs.append((s, p, n))
    ok = [(a, b) for a, b, c in segs if c >= 2]   # 段内至少 2 个带时间事件
    active = sum((b - a for a, b in ok), timedelta())
    total += active
    print(f"{d}: 事件={len(ts)} 段={len(ok)} 活跃={active.total_seconds()/3600:.1f}h "
          + ' '.join(f"{a:%H:%M}-{b:%H:%M}" for a, b in ok))
print(f"合计 {total.total_seconds()/3600:.1f}h")
```

下界、上界各跑一次,结果写成**区间**:`约 <下界>h ~ <上界>h`。混合会话直接给这个区间,不逐时段确认、不额外标注不确定性;但缺数据、回退估算必须如实说明。

## 原文证据(铁律)

- 引用会话原文佐证归属(「这轮在讨论本需求」)必须**真读原始会话文件**,并留可定位锚点(会话 id + 轮次/行号/时间):Claude Code `~/.claude/projects/`、CodeBuddy `~/.codebuddy/projects/`、Codex `~/.codex/sessions/`(未归档)、DeepSeek `~/.dsh/sessions/`,按 `session_id` 找文件。
- 找不到文件、读不出内容 → 标「原文不可得」;**不得拿时间线摘要或提交记录反推冒充会话原文**。

## 覆盖不足

补录状态 partial/blocked、或两份事件集都形不成任何可计算段 → 时间线不足:

- 原始会话文件里有可计算时段(每条记录带时间戳,同一算法照算)→ 回退估算,结果**标「非 timeline 实测」**;
- 会话也不足 → 写**「无法估算」**,不写 0、不拿日历跨度或提交间隔凑数。

## 返回格式(浓缩报告;第一节必须是工作量结论)

```
## 工作量结论
- 需求: <标识> · git_range: <首SHA>..<末SHA>
- 日历跨度: <立项日> ~ <收口日>,共 <N> 天(仅日历跨度,常远大于真实投入)
- 实际投入: 约 <下界>h ~ <上界>h ≈ <Z> 工作日
  - 口径: 下界=明确归属事件 · 上界=含混合会话候选事件 · <timeline 实测 | 非 timeline 实测(会话回退) | 无法估算>
- 补录状态: <complete|partial|blocked> · <一句原因>
- 覆盖: <缺失数据及回退原因;没有就写「完整」>
```

其后按需给细节:commit 骨架(SHA + author date + 一句改动,时间序)、会话列表(短码 + 首末时间 + 独占/混合(混了什么))、逐日活跃段、归属判断依据(用了哪些锚点)。该需求已有收口档案时,加一节「与既有档案的差异」。

## 约束

- 不回传原始事件 JSON / 脚本中间结果,只回浓缩报告;不回传全部会话的全部轮次。
- 活跃时长必须给区间(下界~上界),不假装精确到分钟。
- 无数据不能当 0;缺数据如实说覆盖不足。
- 不把其他项目或其他需求的会话算进来;混合会话不整段无条件算给本需求。
- 一次跑完,不建议调用方再派第二次;数据不足就如实说。
