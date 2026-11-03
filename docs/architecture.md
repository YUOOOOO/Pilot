# Pilot 架构

## 进程关系

```text
Electron main
  ├─ BrowserWindow + sandboxed preload
  ├─ Tray / menus / logs / native dialogs
  └─ spawn bundled node.exe
       ├─ --import lifecycle.mjs（仅父子进程生命周期适配）
       └─ 官方 @deepseek-ai/dsh/lib/bin.js
            web --patch <产品层> --host 127.0.0.1 --port 0 --no-open
              ├─ 官方基础和 Web Bundle
              └─ dsh-pilot 双面插件
```

官方 CLI 的 `desktop` Profile 是保留名称，Pilot 在自己的 DSH_HOME 中使用 `web`，与用户全局 web Profile 隔离。官方 Profile 由 CLI 初始化，无需首启 npm 下载。

## 启动和认证

启动页立即显示，Electron 持续消费 stdout/stderr，按行处理跨数据块输出。只接受 `dsh web:` 报告的 HTTP 127.0.0.1 地址，保留认证参数，在 HTTP 探测通过后交给 Chromium 加载。日志中的 token 参数被脱敏。启动超时或提前退出显示失败状态，可从启动页或菜单重试。

主窗口启用 contextIsolation、sandbox，关闭 nodeIntegration。原生 bridge 检查调用方 webContents、主 frame 和当前页面来源。弹出的 HTTP(S) 链接交给系统浏览器，禁止任意顶层导航。

产品 patch 按启动路径生成，以绝对 JS 入口定位随包 Bundle。官方 modules 插件从入口寻找最近 package.json，读取 dsh.client 元数据。产品 Client 以官方 `window.__ModuleLoader__.load({ id, factory })` 协议构建；React 由官方前端模块系统提供。

## 正常关闭与异常

Windows Node 不能靠 child.kill('SIGTERM') 模拟可处理的 Unix 信号。Pilot 使用 Node `--import` 加载小型适配模块，父进程通过 IPC 发送关闭消息，适配模块触发进程内 SIGTERM 事件，进入官方 CLI 已注册的 dispose 路径。父进程意外退出导致 IPC 断开时也走同一路径。适配模块不修改官方包内容或模块加载行为。

宿主等待 5 秒，超时后通过 Windows taskkill 清理自管 Host 的进程树。实际正常关闭是否完成可通过日志的 code=0 判断。DSH 异常退出显示恢复页，由用户重试，避免无界重启循环。窗口关闭隐藏到托盘，显式退出才关闭 Host。

## 打包

Node、官方 DSH 和产品 Bundle 放在 resources/runtime，ASAR 外运行。生命周期模块使用 app.asar.unpacked 路径，避免独立 Node 读取 ASAR 的限制。生产依赖由根 package-lock.json 的 npm ci --omit=dev 安装，运行时版本记录在 runtime/manifest.json。

prepare-runtime 使用 Windows PowerShell 下载官方 Node，使用官方 SHASUMS256.txt 验证二进制。运行资源输出到忽略的 .runtime 目录；用户数据不写入安装目录。发行时应一并保留 Node 和 npm 依赖自带的许可证文件。

## 当前范围

- 产品品牌、首页、VS Code 式活动栏和功能侧栏已接入。保留 ui-sidebar 模块以满足官方设置等插件的客户端依赖。rc.5 的侧栏子插槽不能重复声明，Pilot 在该模块激活后适配其注册条目的 component，并在卸载时恢复；沿用原注册的子插槽、反应式面板数据和会话回调。这一版本相关适配集中在 sidebar.tsx，升级 DSH 时必须验证。窗口使用无边框、原生窗口控制和 36px 可拖拽顶部区域。
- 产品 Host 提供 pilotProduct 元数据服务，后续业务服务在此包扩展。
- 目录选择只返回目录；工作区创建由官方侧栏处理。
- 更新菜单和 bridge 已预留，但没有真实发行仓库，当前不联网检查或下载更新。
- 未接入模型凭据；真实聊天、工具运行与会话恢复需在配置模型后验证。
- 当前发行脚本针对 Windows x64，其他平台尚未验证。

## 验证入口

npm test 覆盖分块就绪输出、认证参数保留与脱敏、正常关闭、提前退出和启动超时。

npm run smoke 使用隔离数据目录启动真实 Electron 与官方 DSH 两次，检查品牌、点击首页、调用版本 bridge、返回聊天并正常退出，保存日志、页面文本和截图。它不发送模型请求。
