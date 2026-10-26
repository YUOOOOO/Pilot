# 上游执行层提取与核对

本记录对应 nanoMuse 固定提交 `010e886822ce95a70df55a4d4c4a67b2e333cb66`。本次完成源码提取、依赖核对及可用自动化检查，不表示 Pilot 应用、项目会话或桌面适配已完成。

当前状态更新：基线提取/代理重试记录保留为历史验证；桌面适配见 [PILOT-UI.md](PILOT-UI.md)，服务器中继见 [RELAY.md](RELAY.md)。来源清单现为 641 条：626 个文件原样保留，15 个适配文件单列当前哈希（含 nexo 固定名称的文案测试适配），不能把历史“537 个原样一致”当作现状。

## 1. 提取范围

| Pilot 路径 | 保留原因 | 状态 |
| --- | --- | --- |
| `harness/desktop/` | Electron 外壳、Host 启停、原生 operator、权限、保护退出、资源、测试、npm 锁文件 | 原样提取 |
| `harness/dsh-nanomuse/` | Host/client bundle、Windows ACL 适配、Hands/Reach、配置、同步、审批、停止、测试、pnpm 锁文件及静态资源 | 原样提取 |
| `harness/README.md` | 上游启动和打包说明 | 原样保留，仅作为上游参考 |
| `nanomuse/` | Python CLI、MCP、Hands、Sentinel、桥接及运行时资源 | 整包原样提取 |
| `scripts/desktop-app/` | PyInstaller spec、运行时入口、构建/健康检查、macOS 打包脚本 | 原样提取 |
| `pyproject.toml`、`config/config.example.toml` | Python 包、CLI、依赖及配置资源入口 | 原样提取 |
| `tests/` | 上游 Python 回归测试参考及本次执行层测试 | 原样保留；未运行整库测试 |
| Android/iOS 各两份 `ideas.{en,zh}.json` | bundle 的 `fences.test.mjs` 按原相对路径校验同源数据 | 仅测试夹具，不含手机端执行代码 |
| `web/public/fonts/OFL.txt` | 保留 Figtree 字体许可来源；运行时静态资源内另有许可副本 | 原样提取 |
| `THIRD_PARTY_NOTICES.md`、`docs/upstream/nanomuse-NOTICE.txt` | nanoMuse 版权及第三方声明 | 原样保留 |
| `docs/upstream/desktop-app.workflow.yml` | 真实上游构建配方的证据 | 仅参考，未放入 `.github/workflows`，不启用发布 |
| `docs/upstream/nanomuse-README.md` | 上游 Python 包/产品说明的参考副本 | 原样保留 |

共登记 **537 个上游文件**，包括此前已有且匹配的根 `LICENSE`。逐文件源路径和 SHA256 见 [files.json](upstream/files.json)。新增的完整性脚本 `scripts/verify_upstream.py` 和本说明属于 Pilot 文件，不伪装成上游源码。

本轮已另行引入根 `cloud/` 服务端、控制台和测试，以及基础自托管脚本；本机验证与公网部署边界见 [RELAY.md](RELAY.md)。Android/iOS 应用、子模块、展示站点和 demo 仍未引入；bundle 内的 `cloud.ts` 等内部服务保留。

### 为什么保留完整 Python 包

`nanomuse_runtime.spec` 调用 `collect_submodules("nanomuse")`，运行时入口保留 CLI 子命令；spec 明确收集 `nanomuse/server/static/`、`nanomuse/skills/builtin/` 和 `config/config.example.toml`。只复制 `computer/` 或 `bridge/mcp_server.py` 会破坏这条真实构建链。因此本次保留包内实现及已提交的静态构建物，尚未为了精简重写入口或 PyInstaller 配置。

根 `tests/` 中还包含上游文档、发布、手机端等测试；它们不全部适用于本次选取的子集。本文只声明下列指定测试的结果，不声明直接执行整库 `pytest` 会通过。

## 2. 依赖闭包与工具版本

| 环节 | 基线声明/实际解析 | 本次处理 |
| --- | --- | --- |
| Node | package engines `>=22`；上游说明要求 22.19+ | 临时 Node **22.19.0**，官方 SHA256 校验通过 |
| npm | 随本次 Node 提供 | **10.9.3** |
| pnpm | 上游 workflow 使用 `pnpm@11` | 临时固定 **11.0.0**，冻结锁文件安装 |
| Electron | 精确 **44.7.0** | 保持 package.json 与 package-lock.json，不升级 |
| DSH | **0.2.0-rc.2** | 沿用 bundle peer/dev 依赖及暂存脚本，不复制或重写 Agent 循环 |
| TypeScript | desktop 锁文件与 bundle 锁文件 | 沿用各自版本；两个模块类型检查通过 |
| Python | package 要求 `>=3.11`；上游 CI 使用 3.12 | 临时 **3.12.12** |
| Python 安装 | `.[hands,dev]` 与 PyInstaller | 使用 scratch 虚拟环境完成；上游未提供 Python 锁文件 |
| Windows 桌面输入 | `@computer-use/nut-js` **4.2.0** 及 libnut 平台预编译件 | 声明与原生资源路径保留；未进行真实鼠标键盘验收 |
| macOS 权限 | `node-mac-permissions` **2.2.2**、`mac-screen-capture-permissions` **1.0.2**、Swift helper | 源码及脚本保留；无 macOS 构建验证 |
| DSH 原生依赖 | node-pty、sharp、koffi、require-builtin、Windows ACL runner | 已完成 win32/x64 暂存并通过对应 Electron 的 Host smoke；ACL、PTY 等真实工具动作仍未逐项验收 |

原 PATH 没有 Git、Node、npm、pnpm、uv 等工具，`python.exe` 仅为 WindowsApps 占位。已使用 scratch 内的临时工具完成本次检查，没有修改系统 PATH 或安装全局开发环境；scratch 工具不属于项目可分发文件。Git 仍未配置，未提交、推送或发布。

上游 `.gitmodules` 仅声明 Android 的 proot 和 iSH。本次桌面路径没有这些子模块依赖，故不导入其 gitlink 或预建手机端目录。

### 构建关系

```text
bundle package.json + pnpm-lock.yaml
  → pnpm build → lib/（Host ESM、client factory、类型声明）
  → prepare-dsh.mjs → 同版本 DSH + bundle + 对应平台原生件

desktop package.json + package-lock.json
  → npm ci → TypeScript/Electron/operator 原生依赖

pyproject.toml + nanomuse/ + config/config.example.toml
  → scripts/desktop-app/nanomuse_runtime.spec
  → runtime_entry.py → PyInstaller runtime/

以上三路 + desktop/resources/ + macOS helper（仅 macOS）
  → electron-builder.yml → 平台包
```

`prepare-dsh.mjs` 精确选择 DSH 顶层版本，但内部执行 `npm install --no-package-lock`；因此其传递依赖并未由独立 staging 锁文件完全固定。Python 依赖也含范围约束。这是上游基线现状，本次没有另建版本体系或宣称完全可复现打包。

## 3. 工作区和会话契约：源码核对

下列行为来自固定版本 nanoMuse 与 DSH 0.2.0-rc.2 的源码；DSH 包通过本次安装依赖及 scratch 内解包核对。

- nanoMuse 桥接声明：`workspaces.create({ path })` 返回带 `workspaceId` 的视图；`openWorkspace(id)`、`startSession(workspaceId?)` 接受工作区 ID。参见 `harness/dsh-nanomuse/src/client/index.ts:85–96,544–548`。
- DSH 客户端解包 RPC 的 `{ workspace, created }`，返回 `WorkspaceView`，不是仅含一个 ID 的完整契约。会话摘要字段为 `cwd`，工作区另通过 `WorkspaceView.sessionIds` 关联；创建时不能同时传 `workspaceId` 和 `cwd`。
- DSH `openWorkspace` 可能复用该目录下未归档的空会话；`startSession()` 无参数时，优先继承当前视图所属工作区，然后才用最近工作区。不能把它视为保证创建独立旁聊的无条件操作。
- 当前 nanoMuse 主会话依次采用同步状态、localStorage 记忆和候选排序；所谓 oldest 实际按 `updatedAt` 排序。`MuseChats.tsx:240–289` 的候选过滤没有项目/工作区排除条件，Host 同步列表 `cloud.ts:818–829` 也未排除项目。下一阶段必须同时处理列表、主会话及同步归属。
- `cloud.ts` 已有同步工作区创建路径；远程 task 新会话仅指定 preset，未传项目目录；同步拉回会话落在 `~/nanoMuse` 工作区（失败则用 cwd）。不能据此声称跨端项目目录已恢复。
- `sync.ts:702–725` 还维护账号主会话约束，不改为每设备独立主会话。

待运行确认：创建/打开空会话复用，两个项目的实际命令目录，重启后 cwd/成员恢复，从项目视图创建旁聊的归属，项目排除主会话与同步候选。没有新建会话数据库或项目调度器。

## 4. 执行、审批、停止与 cloud 耦合：源码核对

### 命令执行

Windows preset 启用 DSH PowerShell 工具；`windows-pwsh-sandbox.ts` 只对 Electron 下匹配的 ACL runner 启动插入 console trampoline，随后回到原 DSH runner。未绕开 ACL、审批或停止链。DSH 自身 `danger-full-access` 模式会走不同执行分支，不应将所有模式统称为受限 ACL 执行。

PowerShell 工具把审批服务和 `exec.signal` 交给上游 executor；取消沿 jobs/shell executor 传递。目标机实际隔离、越界访问拒绝、后台进程回收仍须运行验证。

### 电脑操作

```text
Electron → DSH Host → hands-tools.ts → nanomuse mcp（stdio）
  → Python bridge/computer → 带 token 的 Electron loopback operator → 原生截图/输入
```

`main.ts:311–361` 注入 operator URL/token、确认密钥及可选 `NANOMUSE_PY`；`hands-tools.ts:35–45` 默认 MCP cwd 为用户 home，不能直接当成项目命令 cwd。敏感操作通过 runtime 拒绝、DSH 审批和确认票据衔接；不能把 shell ACL 的文件边界等同于桌面鼠标键盘边界。

### 停止

聊天取消、远程 task 的 agent.cancel、审批 abort 和保护退出保留。保护退出先阻止新任务、等待空闲，再结束 Host；Windows 最终通过 `taskkill /T /F` 处理 Host 树。真实输入动作、后台 jobs、拒绝/超时审批及退出残留进程尚未验收。

### 自有模型

`cloud.ts` 不只是官方账号：还提供本机凭据读取、provider 配置、Hands 环境、审批、同步、远程任务及工作状态。`hands-tools.ts` 注入 `nanomuseCloud` 并调用 `handsEnv()`；因此删除整块服务会切断本机能力。

源码支持自有 provider endpoint/key，并为非 nanomuse provider 放行直连；这不等于应用已证明完全离线或不联系上游服务。无官方账号的完整聊天/Hands 启动和配置生效仍待实际验收。

## 5. 本次验证结果

| 检查 | 结果 |
| --- | --- |
| `python scripts/verify_upstream.py` | 537 个导入文件与固定提交逐字节一致；版本、许可资源、providers 同源数据和手机端测试夹具检查通过 |
| bundle `pnpm install --frozen-lockfile --ignore-scripts` | 成功；未改锁文件 |
| bundle `pnpm build` | 通过，生成 Host/client/types |
| bundle `pnpm typecheck` | 通过 |
| bundle `pnpm test` | **350 通过、12 跳过、0 失败** |
| desktop `npm ci --ignore-scripts --no-audit --no-fund` | 成功；仅依赖安装，不代表 Electron/原生件可运行 |
| desktop `npm run typecheck` | 通过 |
| desktop `npm test` | **152 通过、0 失败** |
| 指定 18 个 Python 测试文件（见后文） | **202 通过、7 跳过、1 排除** |
| DSH `prepare-dsh.mjs` | 初轮超时；2026-10-24 经当前系统代理重试成功，退出码 0，生成完整 `dsh.json`，见第 8 节 |
| Electron 二进制与 Host smoke | 2026-10-24 下载、版本检查、hooks 及隔离 `--app` smoke 通过；完整 GUI 和运行时打包未验证 |

初轮交付复核：Pilot 自有文档/脚本共 12 个文件通过 UTF-8、代码块与行尾空白检查，19 个本地链接有效；`python -m ruff check scripts/verify_upstream.py` 通过。初轮未完成的生成目录曾清理；代理重试后已重新生成完整 `harness/desktop/dsh/`，见第 8 节。

Python 首轮为 201 通过、7 跳过、2 失败。回环 HTTP 被环境代理转发造成的 MCP 测试失败，通过仅在测试进程设置 `NO_PROXY=localhost,127.0.0.1,::1` 后重跑通过。`test_shell_and_python` 直接调用 POSIX `sleep`，当前 Windows 无该命令，保留源码并明确 `--deselect`，没有修改测试或制造替代输出。

bundle 的 12 项跳过包括 POSIX shell、CLI 夹具相关用例及 Windows 符号链接权限；Python 的 7 项跳过遵循上游平台/权限条件。所有计数按实际输出记录，跳过及排除不代表通过。原生输入、ACL、GUI、重启恢复、账号及跨设备测试均未因此获得通过结论。

## 6. 可复用检查命令

以下在项目根目录的 PowerShell 执行；需自行具备 Node 22.19+、pnpm 11、Python 3.12。临时工具在 scratch，不保证后续会话仍存在。

```powershell
python scripts/verify_upstream.py

Push-Location harness/dsh-nanomuse
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm typecheck
pnpm test
Pop-Location

Push-Location harness/desktop
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
Pop-Location
```

Python 本次使用独立虚拟环境，安装的是 `.[hands,dev]` 和 `pyinstaller`；不是系统 Python。

```powershell
$env:PYTHONUTF8 = '1'
$env:NO_PROXY = 'localhost,127.0.0.1,::1'
python -m pytest -q tests/test_config.py tests/test_sentinel.py tests/test_sandbox.py tests/test_tools.py tests/test_skills.py tests/test_computer.py tests/test_computer_coords.py tests/test_computer_operator.py tests/test_bridge.py tests/test_mcp_bridge.py tests/test_mcp.py tests/test_certs.py tests/test_cli.py tests/test_agent.py tests/test_holds.py tests/test_sync.py tests/test_build_runtime_check.py tests/test_desktop_runtime_staging.py --deselect tests/test_tools.py::test_shell_and_python
```

## 7. 未完成的构建与下一步

固定版 DSH staging、Electron 下载、`check-hooks.mjs` 与隔离 `smoke.mjs --app` 已完成，详见第 8 节。上游完整构建顺序见参考 workflow。Python spec 的入口和资源路径已核对，但尚未构建 PyInstaller 成品或安装包。完整 GUI、电脑操作和 ACL 动作仍待验收。

**暂勿按默认配置直接启动或分发导入的上游应用。** 当前 appId、产品名、账号/更新/问题地址及默认数据目录仍是 nanoMuse 的。后续任何基线启动必须显式设定隔离的 `NANOMUSE_DESKTOP_HOME`、`NANOMUSE_DATA_DIR`、`DSH_HOME`，并在测试配置中审查服务地址；阶段 2 才改为 Pilot 身份及独立持久目录。本次测试使用临时目录，没有启动默认桌面或覆盖用户 nanoMuse 数据。

`prepare-dsh` 与 Host smoke 已验证；`npm start`、`npm run dist`、`build-runtime.py --check` 的完整应用/打包链路尚未跑通，不作为 Pilot 可运行或发布承诺。没有启用上游发布 workflow，没有提交、推送或发布安装包。

## 8. 2026-10-24 代理重试与 Host 验收

读取已启用的 Windows 当前用户系统代理，仅在下载子进程中设置 `HTTP_PROXY`、`HTTPS_PROXY`、npm proxy 及 Electron downloader 对应变量。未修改系统代理、全局 npm 配置或系统 PATH，未关闭 TLS 校验。回环地址通过 `NO_PROXY` 排除。重用 scratch 的 Node 22.19.0/pnpm 11.0.0/Python 环境；DSH 与 Electron 下载并行执行，单轮总上限 140 秒，均在上限内完成。

| 命令/检查 | 实际结果 |
| --- | --- |
| `node scripts/prepare-dsh.mjs`（desktop 目录） | 退出码 **0**；npm 新增 539 个包，脚本完成裁剪及记录 |
| `node node_modules/electron/install.js`（desktop 目录） | 退出码 **0**；二进制已落地 |
| `dsh/dsh.json` 与实际 package.json | DSH **0.2.0-rc.2**、bundle **1.0.6** 一致；win32/x64、sharp native、22500 文件、约 414 MB |
| DSH CLI、bundle Host/client 入口 | `@deepseek-ai/dsh/lib/bin.js`、`dsh-nanomuse/lib/index.js`、`lib/client.js` 均存在 |
| Electron Node 模式 `-p` 版本检查 | 退出码 **0**；Electron **44.7.0**，内置 Node **24.21.0**，modules ABI **149** |
| `node scripts/check-hooks.mjs` | 退出码 **0**；69 个 hooks 匹配，其中 10 个由 bundle 设置 |
| `node scripts/smoke.mjs` | 退出码 **1**；默认开发分支把 Windows 绝对路径传给动态 `import()` 引发 `ERR_UNSUPPORTED_ESM_URL_SCHEME`（已单独复核），被 catch 后最终报 `no Electron binary at undefined` |
| `node scripts/smoke.mjs --app <scratch 的 Electron/DSH 视图>` | 退出码 **0**；原脚本已有 `--app` 分支验证成功，未修改脚本 |
| `python scripts/verify_upstream.py` | 退出码 **0**；537 个上游文件一致，原四份 package/锁文件 SHA256 与重试前完全一致 |

`--app` 的目录仅为 scratch 中的 Electron 原文件副本，并通过 Windows junction 将 `resources/dsh` 指向本地完整暂存，不是安装包或 Pilot 应用成品。此方式绕开原脚本默认分支的路径导入问题，不替换 Host 启动、鉴权或业务逻辑。开发分支问题仍保留为已知限制；本批依赖可用性不受其阻塞。

Host 使用原 smoke 自建的临时 DSH home；另将 `NANOMUSE_DESKTOP_HOME`、`NANOMUSE_DATA_DIR` 指向 scratch，云服务地址指向本机未提供服务的端口，并移除已知模型/账号密钥变量。未发起模型任务或 `--operator`。实际检查：

- dump-config 加载 **5** 项 bundle 补丁。
- 未携 token 的入口返回 **401**，携 token 的入口返回 **303**。
- `/nanomuse/cloud/status` 与 `/nanomuse/rooms/state` 均返回 **200**，rooms 数据结构检查通过。
- 原脚本完成进程树停止和临时 home 清理；进程列表复核无 Node/Electron 残留，scratch 无 smoke home 残留。

scratch 保存 `retry-stage.exit`、`retry-electron.exit`（均为 0）、下载日志、`retry-hooks.log`、脱敏 `retry-smoke.log` 和 `retry-verification.json`；这些是临时诊断资料，不提交到项目。此轮未改上游执行源码和锁文件，不重复宣称先前单元测试是本轮重跑。

此前网络下载与 Host 启动阻塞已经解除。仍未验收完整 GUI、Windows ACL 真实执行、鼠标键盘操作、Python 打包成品、项目会话及安装包；持久开发工具链仍待配置。

最终交付复核：四份原 package/锁文件哈希未变，537 个上游文件校验退出码 0；12 个自有文档/脚本的 UTF-8、代码块、行尾空白与 19 个本地链接检查通过。检查结束后 Node/Electron 进程数为 0，临时 smoke home 与 Electron/DSH 检查视图已清理；完整 DSH 暂存和已安装 Electron 保留在项目生成目录中。

## 9. Pilot 首轮界面适配

已构建并部署自有首页、品牌、双列导航、nexo/会话/项目本地分组、简洁状态栏及左下菜单。bundle 本轮构建通过，352 测试通过、12 平台跳过；desktop 152 测试通过。实际窗口确认首页和分组显示，搜索、关于、设置、新建普通会话及收起恢复可操作；项目入口打开了原生目录选择框并取消。完整范围与未完成项见 PILOT-UI.md。

`files.json` 原始来源条目未覆盖；`localSourceChanges` 记录 8 项适配的路径、原因和当前 SHA256。完整性脚本按基线及明确适配清单校验，执行/审批/停止核心及 Python 包未被界面工作重写。
