# 远程访问与登录（第 1–2 步）

## 现在有什么

| 能力 | 位置 | 状态 |
|---|---|---|
| 鉴权内核（密码 / 会话 / 令牌 / 限流） | `packages/dsh-pilot/src/host/auth.mjs` | 已完成 |
| `/pilot/*` 全路由鉴权 + `/pilot/auth/*` | `packages/dsh-pilot/src/host/routes.mjs` | 已完成 |
| 入口网关（登录页、Cookie、HTTP/WS 代理、密钥打码、MinerU 限制） | `apps/desktop/src/gateway.mjs` | 已完成，默认关闭 |
| 桌面端接线（`PILOT_REMOTE`） | `apps/desktop/src/main.mjs`、`host.mjs` | 已完成，默认关闭 |

## 鉴权三模式

`$DSH_HOME/storages/dsh-pilot/auth.json` 里的 `mode`：

- `loopback`（默认）——只放行回环地址，行为与改造前一致。
- `password`——回环免登录；其他来源必须带登录会话 Cookie 或 Bearer 令牌。
- `open`——全部放行，只给完全信任的场景。

接口（都在 `/pilot` 下）：`GET /auth/state`、`POST /auth/login|logout|password|mode|token`。
密码用 scrypt 加盐；会话是无状态 HMAC Cookie（30 天）；登录连续失败 5 次锁 5 分钟。

## 怎么开启远程

1. 本机设置访问密码（推荐 `password` 模式）：

   ```powershell
   # 端口取自 dsh host 的启动地址（本机回环地址），例如 http://127.0.0.1:49278
   Invoke-RestMethod -Method Post http://127.0.0.1:49278/pilot/auth/password -ContentType 'application/json' -Body '{"password":"你的密码"}'
   Invoke-RestMethod -Method Post http://127.0.0.1:49278/pilot/auth/mode -ContentType 'application/json' -Body '{"mode":"password"}'
   ```

2. 找到本机在局域网里的地址，然后带环境变量启动 Pilot：

   ```powershell
   $env:PILOT_REMOTE = '1'
   $env:PILOT_REMOTE_HOST = '192.168.1.20'   # 必须是本机一个具体地址，不能是 0.0.0.0
   $env:PILOT_REMOTE_PORT = '8899'
   npm run dev
   ```

3. 其他电脑打开 `http://192.168.1.20:8899/`，输入访问密码即可。

网关会拒绝：通配地址、未设密码就绑定非回环地址、非回环来源的 MinerU 托管接口。

## 网关做了什么

- 登录页 `/__pilot/login`，会话 Cookie（HttpOnly、SameSite=Strict，HTTPS 下自动加 Secure）。
- 所有 HTTP 与 WebSocket 升级走同一套鉴权；未登录的浏览器导航 303 到登录页，API 请求 401。
- 首次加载时自动把 dsh web 的启动 token 补给上游（浏览器已有 `dsh-auth-*` Cookie 时不再补，避免重定向循环）。
- `GET /knowledge/config` 的 5 个明文密钥字段打码为 `__PILOT_SECRET_UNCHANGED__`；
  `PUT /knowledge/config`、`PATCH /knowledge/bases/:id` 里的该占位符会被剥掉，等于「保持不变」。
- `docker`/MinerU 托管接口只允许回环来源。

## 还没做的（第 3–4 步）

- 账号体系（多用户、注册、找回密码）：当前是「一个共享访问密码」，不是「一人一账号」。
- 真正的数据同步：知识库文档、会话、任务、群聊的增量同步与冲突合并（参考 `dev-old` 分支
  `cloud/nanomuse_cloud/sync.py` 的 cursor/seq/tombstone 协议）。
- HTTPS：网关只做 HTTP；公网部署需要在前面加 Caddy/nginx 终止 TLS。
- 多用户隔离：现在所有登录者共享同一个 `DSH_HOME`。
