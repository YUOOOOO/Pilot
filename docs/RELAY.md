# Pilot 服务器中继

本轮优先实现服务器端。复用 nanoMuse 固定提交 `010e886822ce95a70df55a4d4c4a67b2e333cb66` 的 `nanomuse-cloud 0.27.0`，保留认证、设备 Hub、同步、请求转发、限流与管理接口；不重写协议或执行引擎。上游源码在 `cloud/nanomuse_cloud/`。对外名称已改为 PilotCloud，包名、模块路径和 `NANOMUSE_CLOUD_URL` 未改。Pilot 启动与部署适配在新增文件中。

## 本轮结果与边界

- 服务端 **255 项测试通过、1 项跳过**。跳过的是需要 POSIX 非 root 用户权限语义的数据目录检查，当前 Windows 无此环境。新增代码 Ruff 检查通过。
- 真实回环 HTTP/WebSocket 测试通过：验证码登录、模型目录、双设备 task/event/result 与 approve/stop 帧转发、服务端生成发送者身份、跨账号隔离、同步、重新连接、服务进程重启后凭据和同步数据恢复、退出后凭据失效。
- 桌面现有 relay、Hub、task、sync 四组 **48 项测试通过**。启动器 PowerShell 语法解析通过。
- 当前开发中继运行于 `http://127.0.0.1:8787`，`/healthz` 返回 `ok=true, version=0.27.0`。数据与私密配置位于 `.pilot-data/relay/`，未切换当前桌面账号或连接，未发送模型请求。
- 真实网络测试的设备是协议夹具，不是两个真实 DSH Host。尚未验收真实工具执行、远程审批 UI、Windows ACL、跨机器网络或模型代理请求。
- Docker/Caddy 配置已提供并做 YAML/引用核对；本机没有 Docker，未构建镜像、申请 TLS 证书或部署公网服务器。没有真实 SMTP/SMS 凭据，未发送验证码邮件或短信。
- 当前客户端和中继网页只提供密码注册与密码登录。新账号用手机号或邮箱加密码创建，随后可用 `POST /v1/auth/login` 登录。已有账号不会被注册覆盖。验证码接口 `/v1/auth/code` 与 `/v1/auth/verify` 仍在，界面暂不调用，便于以后加回。
- 项目会话当前只具备本地分组。上游远程任务没有 workspace 绑定参数，同步也没有项目目录身份；不得把普通 side 对话同步当作项目目录恢复。后续须由目标设备将不透明项目标识映射到已授权 DSH 工作区，验证会话归属和实际 cwd。不得接收远端绝对路径后直接执行。

## 配置与依赖

使用 Python 3.12。`cloud/requirements.lock` 锁定本轮解析的跨平台运行依赖；没有宣称上游所有依赖原本已锁定。`scripts/pilot-relay.py` 将文件或 Compose 注入的环境变量交给原 `Settings`，不另建账号、配置优先级或同步数据库。

`init` 以排他方式生成两把独立随机密钥，已有文件直接拒绝覆盖。默认关闭 GitHub 采集、地理数据库下载和模型改进样本收集；显式设置自有服务链接，避免空值回退到官方服务。`check` 和 `serve` 要求有效 origin 及至少 32 字符的不同密钥；公网 URL 必须使用 HTTPS，本机和私网 IP 可用 HTTP。

`CLOUD_SECRET` 与数据库必须一起备份并长期保留；不要在更新时重新生成。`CLOUD_ADMIN_TOKEN` 是管理权限凭据，不是客户端登录凭据。私密配置、数据库、日志、开发数据均已纳入忽略规则。Windows 文件 ACL 需由部署用户管理；POSIX 初始化文件模式为 0600。

## Windows 本机运行

在仓库根目录，使用独立环境：

```powershell
py -3.12 -m venv cloud\.venv
& .\cloud\.venv\Scripts\python.exe -m pip install -r cloud/requirements.lock
& .\cloud\.venv\Scripts\python.exe -m pip install --no-deps -e cloud
& .\cloud\.venv\Scripts\python.exe scripts/pilot-relay.py init
& .\cloud\.venv\Scripts\python.exe scripts/pilot-relay.py check
& .\cloud\.venv\Scripts\python.exe scripts/pilot-relay.py serve
```

默认读取 `cloud/.env`，数据库为 `cloud/data/cloud.db`，只监听 `127.0.0.1:8787`。也可用 `--env-file` 与 `--data-dir` 指定独立目录；当前开发实例使用此方式。`init` 不需要第三方依赖，可先生成配置。

打开 `http://127.0.0.1:8787/app/`；管理页是 `/app/admin/`。默认 `CODE_SENDER=log`，验证码写在运行服务的日志里，仅用于受控自托管。未设置 `UPSTREAM_KEY` 时，认证、设备 Hub 和同步仍可运行，模型代理返回未配置错误。

如启动开发桌面连接自有中继，先正常退出已有开发实例，再执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-dev.ps1 -RelayUrl http://127.0.0.1:8787
```

该参数映射现有 `NANOMUSE_CLOUD_URL`，不会热切换运行中的账号、任务或目录。不要把已有服务的登录 key 用到另一个中继。正式部署可直接给桌面进程设置 `NANOMUSE_CLOUD_URL=https://relay.example.com`。所有设备须连接同一个中继，并登录同一账号。跨设备时 localhost 指设备自身，须改为服务器实际可达地址。

## Linux 服务器与 TLS

需要实际服务器、解析到该服务器的域名、开放的 80/443 端口，以及支持 `env_file.format: raw` 的 Docker Compose。当前未提供这些环境，以下为待服务器验收的部署流程。

从仓库根目录生成配置：

```bash
python3 scripts/pilot-relay.py init --public-base https://relay.example.com --sender smtp
```

在服务器编辑生成的 `cloud/.env`，填写 `ACME_EMAIL`、`SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM`。保留随机密钥；环境文件使用 `KEY=value`，不要 `source` 执行，不要给值添加 shell 引号。需要短信时沿用上游 `.env.example` 的 Aliyun 变量；需要模型代理时再配置 `UPSTREAM_BASE`、`UPSTREAM_KEY` 和 `CLOUD_MODELS`，不配置也可使用 Hub。

```bash
cd cloud
docker compose --env-file .env -f compose.pilot.yml config --quiet
docker compose --env-file .env -f compose.pilot.yml up -d --build
curl --fail https://relay.example.com/healthz
docker compose --env-file .env -f compose.pilot.yml logs --tail=100 relay
```

`Pilot.Dockerfile` 使用依赖锁和相同的 Pilot 启动入口；服务以 uid/gid 10001 运行，SQLite 使用 `relay_data` 命名卷。构建上下文白名单排除本机密钥与用户数据。中继容器没有宿主发布端口，只通过 Caddy 暴露 TLS，保留 SSE/WS 转发、原请求限制和可信代理处理。不要启动多个 Uvicorn workers 或任意横向复制，当前 Hub 的连接与待处理调用在单进程内存中。

配置中的 `/privacy` 是实现数据说明，`/own-key` 是设备模型接入说明。公开运营时可将 `PRIVACY_URL`、`OWN_KEY_DOCS`、`REPO_URL`、`INVITE_URL` 指向运营者自己的页面；默认说明页不代表已完成运营政策。

更新镜像时保留 `.env` 和命名卷。备份数据库应使用 SQLite backup API，不能只复制运行中的 `cloud.db` 而忽略 WAL；同时保存 `CLOUD_SECRET`。不要执行 `docker compose down -v`，它会删除持久卷。

## 回归命令

```powershell
& .\cloud\.venv\Scripts\python.exe -m pip install pytest pytest-asyncio ruff
Push-Location cloud
& .\.venv\Scripts\python.exe -m pytest -q
Pop-Location
& .\cloud\.venv\Scripts\python.exe -m ruff check scripts/pilot-relay.py cloud/tests/test_pilot_launcher.py cloud/tests/test_pilot_network.py
python scripts/verify_upstream.py
```

网络测试仅使用临时账号、临时数据库、动态回环端口；结束后关闭子进程，不改当前桌面连接。上游测试仍使用自己的模拟供应商，不等于真实模型或完整跨端验收。

## 来源

本轮新增 104 个固定上游文件：`cloud/` 服务、已提交静态控制台与控制台构建源码、测试、基础部署文件，以及 `scripts/self-host.sh`。未引入官方机器专用的 `cloud/deploy/`。原基础部署入口保留作来源参考，Pilot 实际使用 `compose.pilot.yml`、`Pilot.Dockerfile` 和 `pilot-relay.py`。

清单现为 **641 个来源文件，626 个原样文件、15 个适配文件**（后续 nexo 固定名称增加一项文案测试适配）；中继引入未改上游认证、Hub、任务、同步核心。许可证与原 NOTICE 保留，见 [UPSTREAM.md](UPSTREAM.md)、[来源清单](upstream/files.json) 和 [NOTICE](../NOTICE)。
