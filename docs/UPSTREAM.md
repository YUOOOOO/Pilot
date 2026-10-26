# 上游来源与引入记录

## 固定导入基线

- 项目：nanoMuse。
- 仓库：https://github.com/nano-muse/nanoMuse
- 导入提交：`010e886822ce95a70df55a4d4c4a67b2e333cb66`（沿用研究基线，未混用浮动版本）。
- 上游声明：GPL-3.0-or-later；嵌入第三方版权及许可条件原样保留。
- 状态：完成原样提取与基线验证后，已进入 Pilot 首轮界面适配；14 个上游文件的本地修改及当前哈希单列登记。依赖验证见 EXECUTION-LAYER.md，界面范围见 [PILOT-UI.md](PILOT-UI.md)。
- 固定提交归档：`https://codeload.github.com/nano-muse/nanoMuse/zip/010e886822ce95a70df55a4d4c4a67b2e333cb66`。
- 下载归档 SHA256：`4c87ad67e3412f91a8dd16c5ab5c0d5921c074f3c58b62ea407173872d348868`。

DSH：https://github.com/deepseek-ai/deepseek-harness

DSH 保持依赖，版本 **0.2.0-rc.2**；Electron 保持上游精确版本 **44.7.0**。bundle 的 pnpm 锁文件及 desktop 的 npm 锁文件原样导入。staging 脚本和 Python 仍含上游范围解析约束，未宣称完全锁定所有传递依赖。PI-Desktop 是体验参考，不作为执行层复制来源。

## 研究到的集成位置

| 位置 | 作用 | Pilot 处理方向 |
| --- | --- | --- |
| `harness/desktop/` | Electron 外壳、DSH 进程、平台操作与打包 | 复用必要链路，适配品牌、目录与导航桥接 |
| `harness/dsh-nanomuse/` | DSH bundle、客户端及 Host 插件 | 复用执行与集成，改布局和项目会话 |
| `harness/dsh-nanomuse/src/client/MuseChats.tsx` | 主会话与旁聊列表、同步视图 | 重排为 nexo、会话、项目，保留上游语义 |
| `harness/dsh-nanomuse/src/client/index.ts` | UI 插槽及工作区导航接口 | 替换布局，核对目录选择与会话创建接口 |
| `harness/dsh-nanomuse/src/cloud.ts` | 模型凭据、设备、Hands 等混合服务 | 分辨核心依赖，不整体删除 |
| `harness/dsh-nanomuse/src/task.ts` | 远程任务及审批/停止桥接 | 中继阶段复用并适配项目会话 |
| `nanomuse/` | Python 运行时及电脑操作桥接 | 仅在执行链确需时提取相关模块与依赖 |
| `scripts/`、资源与锁文件 | 生成、运行时构建、打包依赖 | 根据真实引用提取，保留生成关系 |
| `cloud/` | 中继、认证、设备与同步 | 已引入固定版本服务、控制台、测试和基础部署；Pilot 入口与验证见 RELAY.md |
| `android/` | OpenMinis 派生手机代码，包含 Android 和 iOS | 后续阶段引入，保留平台差异 |

工作区客户端返回值、会话 `cwd` 与成员关联、主会话筛选、自有模型/Hands 的 cloud 内部耦合已进行固定版本源码核对；完整运行、持久化和项目恢复尚待测试，参见 EXECUTION-LAYER.md。

## 引入原则

1. 固定提交，避免从多个浮动版本拼装代码。
2. 按实际依赖保留必要文件和资源，不从业务名称推断可删除性。
3. 保留文件原有版权、SPDX 和许可证信息；第三方声明一并记录。
4. 记录本地适配，便于回查上游及选择性同步修复。
5. 不将上游官方生产服务、更新地址、问题入口或账号体系直接当作 Pilot 默认服务。
6. 不引入用户配置、凭据、聊天记录或本机运行数据。

## 已引入文件

逐文件清单见 [upstream/files.json](upstream/files.json)：**641 个来源文件**，包含原 537 条目及 104 个中继文件，原路径和基线 SHA256 不改写。`localSourceChanges` 现单列 15 项适配（新增 nexo 固定名称的文案测试登记）；完整性脚本验证 626 个原样文件和 15 项适配文件。Pilot 新增界面、中继启动/部署入口、依赖锁和测试不属于上游原始文件。可运行 `python scripts/verify_upstream.py` 复核。

| Pilot 路径 | 同一固定提交的来源 | 用途与许可 |
| --- | --- | --- |
| `LICENSE` | `LICENSE` | 原样许可证副本，GPL-3.0-or-later |
| `harness/desktop/**` | 同路径 | Electron/Host/operator、资源、测试及锁文件；GPL，保留 UI-TARS 等原声明 |
| `harness/dsh-nanomuse/**`、`harness/README.md` | 同路径 | bundle/配置/测试/资源与锁文件；GPL，保留 Windows adapter MIT 等原声明 |
| `cloud/**`（不含官方机器专用 `deploy/`）、`scripts/self-host.sh` | 同路径，同一固定提交 | 服务端、静态控制台/构建源码、测试与基础部署，104 个文件原样引入；Pilot 使用独立启动/部署文件 |
| `nanomuse/**`、`pyproject.toml`、`config/config.example.toml` | 同路径 | Python CLI/MCP/Hands、包数据和配置；GPL 与所嵌第三方条款 |
| `scripts/desktop-app/**`、`tests/**` | 同路径 | 真实运行时打包链及上游测试参考；GPL |
| Android/iOS 各 `ideas.{en,zh}.json` | 同路径，详见 JSON 清单 | bundle 测试的跨端静态夹具，不代表手机端实现 |
| `web/public/fonts/OFL.txt` | 同路径 | Figtree SIL OFL 1.1 原文 |
| `THIRD_PARTY_NOTICES.md` | 同路径 | 原样第三方许可及资源声明；包含未引入组件的上游说明，不代表本批均已导入 |
| `docs/upstream/nanomuse-NOTICE.txt` | `NOTICE` | 完整 nanoMuse 原声明，含原版权 |
| `docs/upstream/nanomuse-README.md` | `README.md` | 原说明参考，保留原文链接语境 |
| `docs/upstream/desktop-app.workflow.yml` | `.github/workflows/desktop-app.yml` | 构建配方参考，不作为启用的发布工作流 |

本地新增 `scripts/verify_upstream.py`、`docs/EXECUTION-LAYER.md` 与文件清单；更新 Pilot 文档和忽略规则。未修改导入文件的执行/审批/停止行为，未提交、推送或发布。后续适配应单独登记修改文件及原因。

## 未来 Pi 扩展候选

以下只作研究线索，不是首版依赖，也未安装或运行验证：

- https://github.com/Micheleww/dsh-pi-agent
- https://github.com/weijiafu14/pi2dsh
- https://github.com/badlogic/pi-mono

接入前单独验证主/子 Agent 方式、会话兼容性、DSH 版本、电脑操作工具和审批链。

## 中继引入与验证

`nanomuse-cloud 0.27.0` 的原服务端保持不改，新增 Pilot `scripts/pilot-relay.py`、`cloud/Pilot.Dockerfile`、`compose.pilot.yml`、锁定运行依赖及回归测试。服务端 255 测试通过、1 项 Windows 平台跳过；真实回环 HTTP/WebSocket 认证、双设备转发、隔离、同步和重启持久化通过，桌面原中继链 48 测试通过。本机服务已启动；公网服务器、TLS、真实邮件/短信和 DSH 跨端执行未验收，见 [RELAY.md](RELAY.md)。原认证/Hub/任务/同步核心未重写。
