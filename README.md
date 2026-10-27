# 月相 · 经期记录 MCP

一个自建的经期与排卵期记录服务：

- **MCP 服务器**：让 Claude 等 AI 帮你记经期、查周期、预测下次什么时候来。
- **自带网页日历**：手机打开就能看、能记，可以添加到主屏幕。
- **数据在你自己的 Supabase**：数据库密钥只放在服务器上，浏览器和 AI 客户端都拿不到。
- **有鉴权**：网页要登录，MCP 要带密钥或走 OAuth，没配密钥就拒绝一切请求。

## 工具

| 工具 | 作用 |
|---|---|
| `add_period` | 记一次经期开始（可带天数、备注；同一天再记就是更新） |
| `list_periods` | 查看历史经期，附每次周期长度和平均周期 |
| `get_cycle_status` | 当前在周期哪个阶段、预测下次经期 |
| `delete_period` | 删除一条经期记录 |
| `add_ovulation` | 记一次排卵期 |
| `list_ovulations` | 查看排卵期记录 |
| `delete_ovulation` | 删除一条排卵期记录 |

周期怎么算：只用真实经期记录（「仅标记」的不算），两次之间隔 15 到 65 天的才进平均，太短或太长都当成记录有误、跳过。排卵日按「下次经期前 14 天」估算，前后各一天算排卵期。这是通用估算，不能用来避孕或诊断。

## 部署

### 1. 建表

在 Supabase 的 SQL Editor 里运行 [`sql/schema.sql`](sql/schema.sql)。三张表都开了 RLS 且不配任何规则，只有服务端密钥能读写。

### 2. 配环境变量

照着 [`.env.example`](.env.example) 填。必填四个：

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`：服务端密钥（`sb_secret_` 开头）。**不要**用 publishable / anon key。
- `MCP_PROXY_SECRET`：访问密钥，一个够长的随机字符串。网页登录、OAuth 授权、MCP 的 Bearer 都用它。
- `PUBLIC_BASE_URL`：本服务对外的地址，比如 `https://period.example.com`。

### 3. 运行

需要 Node 20 以上。

```bash
npm install
npm start
```

Coolify、Railway 这类平台选 Nixpacks / Railpack 直接构建就行，启动命令是 `npm start`。

**一定要挂在 HTTPS 后面**。网页登录的 cookie 在 HTTPS 下才会带 Secure 标记。

## 使用

### 网页

浏览器打开 `PUBLIC_BASE_URL`，输入访问密钥登录，30 天内不用再登。手机上可以「添加到主屏幕」当 App 用。

- **状态**页：现在是周期第几天、什么阶段、离下次还有几天，下面是历史记录。
- **日历**页：点任意一天，选「月经期开始 / 排卵期 / 仅标记 / 清除记录」。

### 连 claude.ai

设置 → 连接器 → 添加自定义连接器，地址填 `https://你的域名/mcp`，按提示登录授权，跳到授权页时输入访问密钥。

### 连其他客户端

支持自定义请求头的客户端，直接带：

```
Authorization: Bearer <MCP_PROXY_SECRET>
```

地址是 `/mcp`（Streamable HTTP）。只支持旧版 SSE 的客户端用 `/sse`，同样要带这个请求头。

## 安全说明

- 访问密钥别发给别人，别贴进聊天记录。泄露了就换一个，再重启服务。
- 同一个 IP 15 分钟内输错 10 次密钥会被暂时锁住。
- 日志会自动隐藏密钥、令牌和经期备注。
- 如果你以前用过「浏览器直连 Supabase」的版本，给表加过允许匿名读写的规则，换成本服务以后记得删掉，`sql/schema.sql` 末尾有查和删的语句。

## 测试

```bash
npm test
```

## 协议

[PolyForm Noncommercial 1.0.0](LICENSE.md)：个人自用、学习、修改、非商业分享都可以，**不能商用**。转发时请保留 `LICENSE.md`。

by 猫猫 & 晏安
