# Pilot

Pilot 使用独立 Electron 宿主管理官方 DeepSeek Harness CLI，产品界面通过 `packages/dsh-pilot` Bundle 提供。

```text
apps/desktop/          Electron、启动页、preload、进程管理
packages/dsh-pilot/    产品 Host / Client、品牌、首页和设置扩展
runtime/manifest.json 固定 Node 与 DSH 版本
scripts/              构建、运行时准备和桌面冒烟验证
```

当前目标为 Windows x64，固定 Node 24.20.0、DSH 0.2.1-rc.5。开发环境需要 Node 与 npm。

## 开发运行

```powershell
npm ci
npm run build
npm run prepare:runtime
npm run dev
```

`prepare:runtime` 从 nodejs.org 下载 Node，按官方 SHA-256 清单校验，再使用根锁文件安装生产依赖到 `.runtime`。开发模式使用根工作区中的 DSH 和插件，默认使用 `.runtime/node.exe`。也可以直接使用已安装的独立 Node，跳过运行时准备：

```powershell
$env:PILOT_NODE_PATH = (Get-Command node).Source
npm run dev
```

不要把 `PILOT_NODE_PATH` 指向 Electron。关闭窗口会隐藏到托盘；通过托盘或应用菜单中的“退出”完全结束应用。首启在官方设置中配置模型和凭据。

## 验证与打包

```powershell
npm test
npm run build
npm run smoke
npm run dist:win
# 验证打包后的应用：
node scripts/smoke.mjs release/win-unpacked/Pilot.exe
```

`smoke` 在临时目录启动真实 Electron 和 DSH 两次，检查页面中的 Pilot 品牌及插件加载状态；不会使用已有 DSH 配置，也不会调用付费模型。运行结束会打印日志证据目录。若设置了 `PI_SCRATCH_DIR`，临时数据存入该目录。

Windows 安装包输出到 `release/`。运行时放在 ASAR 外，安装包携带 Node、DSH 与产品 Bundle，无需用户安装开发环境。首次构建需要下载构建工具与运行依赖。当前未配置签名证书。

独立插件包可通过以下方式构建并安装到相同版本的 DSH：

```powershell
npm run build
npm pack --workspace dsh-pilot --pack-destination $env:TEMP
# 将实际生成的 tgz 路径传入：
dsh plugin --profile web add <dsh-pilot-0.1.0.tgz>
```

## 数据与架构边界

Pilot 用户数据由 Electron `userData` 管理，包含：

- `dsh-home/`：独立的 DSH 数据和 web Profile，不默认复用 `~/.dsh`。
- `logs/pilot.log`：轮转日志，启动 URL 的认证 token 会脱敏。
- `pilot-launch.patch.yml`：产品启动层，与用户 Profile patch 分开。

产品 Bundle 提供 VS Code 风格的三列工作台：最左侧为单列活动图标，中间为当前功能的菜单或项目/会话列表，右侧为聊天或页面内容。设置入口位于活动栏底部。Electron 使用无边框窗口、36px 可拖拽标题栏与原生窗口控制按钮。Pilot 保留官方工作区浏览器、设置和聊天能力，活动图标继续接纳兼容插件注册的入口。

桌面桥接仅提供版本、目录选择、打开日志、重试与更新入口，验证调用方主窗口及来源。没有桥接的普通 Web 环境仍可使用产品 Bundle。

当前更新入口会说明未配置发行源；尚不执行在线更新。上线前需配置实际发行仓库、签名与更新验证。聊天请求、会话持久化及工具执行复用 DSH，真实模型调用需要用户配置。

更详细的启动与关闭机制见 [架构说明](docs/architecture.md)。
