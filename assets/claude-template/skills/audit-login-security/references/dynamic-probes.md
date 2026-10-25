# 受控动态验证

只在**已经读到疑点**、且用户明确允许本地/测试环境时使用。目的不是「扫一遍看看」,而是把代码里那条可疑分支用一次请求钉死。

## 规则(HARD)

1. **环境白名单**:`localhost` / `127.0.0.1` / 用户明确指认的测试域名。**生产域名、客户环境一律拒绝**,即使用户说「没事」。
2. **账号**:只用用户提供的测试账号。不注册、不试真实用户、不改测试账号的密码(验证改密流程时用专用账号,结束后告知)。
3. **剂量**:每个探针 ≤ 3 次请求;不并发、不挂字典、不跑扫描器;整轮总请求量控制在几十次以内。
4. **停止条件**:出现 429、WAF 拦截页、连续 5xx、或响应开始异常(被限流/封 IP)→ 立即停,记入报告,不换 IP 不绕过。
5. **证据**:记录 `method path → status · 耗时 · 关键响应字段`,证据里 token/手机号打码。
6. **失败不重试**:网络错误、超时、环境没起,直接记「环境不可用」,不反复打。
7. **不改服务状态**:不上传文件、不触发短信轰炸(短信探针最多 1 次)、不批量注册。

## 探针清单

先确认「代码疑点 → 对应探针」,没有疑点的不跑。

### P1 用户名枚举
```bash
curl -s -o /dev/null -w '%{http_code} %{time_total}\n' -X POST "$BASE/api/login" \
  -H 'Content-Type: application/json' -d '{"username":"known_user","password":"wrong_probe_1"}'
curl -s -o /dev/null -w '%{http_code} %{time_total}\n' -X POST "$BASE/api/login" \
  -H 'Content-Type: application/json' -d '{"username":"no_such_user_zz","password":"wrong_probe_1"}'
```
看 **状态码 / 响应体文案 / 耗时** 三者是否一致。存在用户会多跑一次哈希,耗时差常 > 50ms。

### P2 认证逻辑短路
用**测试账号 + 空密码 / 错密码**,看是否仍返回 token:
- 返回 200 且 body 有 `token`/`access_token` → 致命
- 返回 200 但无 token、只有用户信息 → 高危(信息泄漏)
- 返回 500 + 堆栈 → 记错误处理问题

### P3 JWT 篡改
```bash
# 1) 解出 payload,改 sub/role,保留原签名,重放
python3 - <<'PY'
import base64, json
t = "<TOKEN>"
h, p, s = t.split('.')
def d(x): return json.loads(base64.urlsafe_b64decode(x + '=' * (-len(x) % 4)))
print(d(h)); print(d(p))
PY
```
- 改 payload 保留签名 → 若仍 200:验签缺失(致命)
- `alg` 改 `none` 并删签名 → 若仍 200:致命
- 若服务端 HS256:用公开信息/弱密钥字典**只做 1~2 个**常见弱密钥尝试(`secret`、`changeme`),命中即高危;不做离线爆破

### P4 登出后重放
1. 登录拿 token → 2. 调登出 → 3. 用旧 token 调一个需登录的接口。
- 仍 200 → 会话未失效(高)

### P5 改密后旧会话
用专用测试账号:登录(A)→ 另一会话改密 → A 的 token 再调接口。
- 仍 200 → 旧会话未失效(高);改密后**记得告知用户新密码**

### P6 越权
用 A、B 两个测试账号:
- A 的 token 访问 `B 的资源 id` → 200 且返回 B 的数据 = 水平越权(高)
- A 的 token 访问管理端接口(`/admin/**`、`/api/admin/**`)→ 200 = 垂直越权(高)
- 改请求里的 `tenantId`/`orgId` → 能读到其他租户数据 = 隔离失效(高)

### P7 验证码复用 / 万能码
- 同一 code 连续用两次:第二次仍通过 → 可复用(中,配合任意手机号升级为高)
- `000000`/`123456`/`111111`:命中 → 致命(若同时可指定任意手机号)
- 发送接口响应体是否含 code → 若能直接读出,等同绕过

### P8 限流确认
对**测试账号**连续 5 次错误密码(仅 5 次,不换账号、不换 IP):
- 无 429 / 无锁定 / 无验证码升级 → 无限流(中高,按是否有 MFA 判)
- 锁账号但不锁 IP → 可 DoS 他人账号(中)

### P9 开放重定向
```
GET /login?returnUrl=https://example.com
GET /login?returnUrl=//example.com
GET /login?returnUrl=https://<target-host>@example.com
```
- 302 到 `example.com` → 开放重定向(中)

### P10 令牌过期
解出 `exp` / `iat`:
- 无 `exp` 或 > 24h 且无 refresh → 高风险(中高)
- `exp` 只在前端校验(后端 `ignoreExpiration`)→ 高

## 结果记录

| # | 目标(代码疑点) | 请求 | 预期 | 实际 | 结论 | 置信度 |
|---|---|---|---|---|---|---|

「结论」只能写 命中/未命中/环境不可用,不写「疑似」。环境不可用的探针在报告里归「待验证」,并写明缺什么(服务没起 / 没有测试账号 / 需要 WAF 白名单)。
