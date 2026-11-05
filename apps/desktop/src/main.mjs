import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, shell, dialog } from 'electron';
import { appendFileSync, mkdirSync, existsSync, statSync, renameSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DshHost, redact, probeHost, isAlive, killTree } from './host.mjs';
import { ensurePresets } from './provision.mjs';
import { startGateway } from './gateway.mjs';
import { PilotAuth } from '../../../packages/dsh-pilot/src/host/auth.mjs';

app.setName('Pilot');
const smoke = process.argv.includes('--smoke');
if (process.env.PILOT_TEST_HOME && smoke) app.setPath('userData', process.env.PILOT_TEST_HOME);
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
let window, tray, host, gateway, origin, starting = false, quitting = false, finalExit = false;
// 远程模式：在 dsh web 前面加一层登录网关，只把网关地址交给窗口。
const remote = {
  enabled: process.env.PILOT_REMOTE === '1',
  host: process.env.PILOT_REMOTE_HOST || '',
  port: Number(process.env.PILOT_REMOTE_PORT || 8899),
};
// smoke 用一次性 home，退出时必须把 host 停掉；正常运行则让 host 留着给下次启动复用。
let persistHost = !smoke && process.env.PILOT_NO_HOST_REUSE !== '1';
// 远程模式不复用旧 host：网关地址和可信 Host 都跟本次启动绑定，复用容易连到错的一代。
if (remote.enabled) persistHost = false;
// 本次运行启动的 host 是否已经登记进缓存（登记过就可以留活给下次复用）
let hostPersisted = false;
// 「重启服务」要求冷启动：跳过复用逻辑。
let forceCold = false;
let hostLogFile;
let logPath, splashPath;
const log = message => {
  if (!logPath) return;
  try {
    if (existsSync(logPath) && statSync(logPath).size > 2 * 1024 * 1024) renameSync(logPath, `${logPath}.previous`);
    appendFileSync(logPath, `${new Date().toISOString()} ${redact(String(message))}\n`);
  } catch (error) { console.error('Log write failed:', error.message); }
};
function allowed(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted bridge sender');
  const url = event.senderFrame.url;
  const parsed = new URL(url);
  parsed.search = '';
  if (parsed.href !== pathToFileURL(splashPath).href && (!origin || parsed.origin !== origin)) throw new Error('Untrusted bridge origin');
}
function show() { window?.show(); window?.focus(); }
// ── host 复用缓存 ─────────────────────────────────────────────────────
// dsh web 冷启动要 25–30s（核心插件集加载），但服务开着就不用反复付这个成本：
// 退出时把 {url,pid,fingerprint} 记下来，下次启动先探活，命中就直接连上去。
// fingerprint 覆盖会影响 host 的东西（patch 内容、pilot host 半片、DSH 版本、profile 清单），
// 这些一变就说明必须冷启动，避免连到旧代码还在跑的 host。
function hostCachePath() { return path.join(app.getPath('userData'), 'host-cache.json'); }
function readHostCache() {
  try {
    const value = JSON.parse(readFileSync(hostCachePath(), 'utf8'));
    return value && typeof value.url === 'string' ? value : undefined;
  } catch { return undefined; }
}
function writeHostCache(entry) {
  try { writeFileSync(hostCachePath(), JSON.stringify(entry)); }
  catch { /* 缓存只是加速手段，失败不影响启动 */ }
}
// 用内容而不是 mtime 做指纹：每次 npm run dev 都会重写 lib/index.js，但内容没变就不该
// 判成「代码变了」而多等一次冷启动。
function contentStamp(file) {
  try { return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16); }
  catch { return 'missing'; }
}
function hostFingerprint(parts) {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(String(part ?? '')).update('\n');
  return hash.digest('hex').slice(0, 16);
}
async function showSplash(error) {
  origin = undefined;
  await window.loadFile(splashPath, { query: error ? { error } : {} });
}
async function start() {
  if (starting || quitting) return;
  starting = true;
  const cold = forceCold;
  forceCold = false;
  try {
    const root = path.resolve(__dirname, '../../..');
    const runtime = app.isPackaged ? path.join(process.resourcesPath, 'runtime') : root;
    const node = app.isPackaged ? path.join(runtime, 'node.exe') : (process.env.PILOT_NODE_PATH || path.join(root, '.runtime/node.exe'));
    if (!node || !existsSync(node)) throw new Error('请先执行 npm run prepare:runtime，再启动 Pilot。开发时也可设置 PILOT_NODE_PATH 指向独立 Node。');
    const entry = path.join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
    const bundle = path.join(runtime, 'packages/dsh-pilot');
    const home = path.join(app.getPath('userData'), 'dsh-home');
    mkdirSync(home, { recursive: true });
    const patch = path.join(app.getPath('userData'), 'pilot-launch.patch.yml');
    const lifecycle = app.isPackaged ? path.join(`${app.getAppPath()}.unpacked`, 'dist/lifecycle.mjs') : path.join(root, 'apps/desktop/src/lifecycle.mjs');
    const pluginPatch = readFileSync(path.join(bundle, 'cordis.patch.yml'), 'utf8');
    writeFileSync(patch, pluginPatch.replace(/name:\s*['"]?dsh-pilot['"]?/g, `name: ${JSON.stringify(path.join(bundle, 'lib/index.js').replaceAll('\\', '/'))}`));
    const fingerprint = hostFingerprint([
      pluginPatch,
      contentStamp(path.join(bundle, 'lib/index.js')),
      contentStamp(path.join(runtime, 'node_modules/@deepseek-ai/dsh/package.json')),
      contentStamp(path.join(home, 'profiles/web/package.json')),
      process.env.PILOT_NODE_PATH ?? '',
    ]);
    // 先试复用：同一份代码 + host 还活着 + 端口还能应答，就跳过整段冷启动。
    const cached = persistHost && !cold ? readHostCache() : undefined;
    if (cached && cached.fingerprint === fingerprint && isAlive(cached.pid) && await probeHost(cached.url)) {
      log(`Host reuse: dsh web already running (pid ${cached.pid}, started ${new Date(cached.startedAt ?? 0).toISOString()})`);
      await host?.stop();
      host = undefined;
      hostPersisted = true;
      if (quitting) return;
      origin = new URL(cached.url).origin;
      await window.loadURL(cached.url);
      log('DSH ready; desktop page loaded (reused host)');
      return;
    }
    await showSplash();
    await host?.stop();
    host = undefined;
    if (cached && isAlive(cached.pid)) {
      log(`Host cache unusable (${cached.fingerprint === fingerprint ? 'port down' : 'code changed'}), recycling pid ${cached.pid}`);
      await killTree(cached.pid);
      writeHostCache({});
    }
    // 首次启动把产品预置插件写进 profile（知识库 / 多角色群聊）。
    const provision = await ensurePresets({
      runtime, node, entry, home, log,
      status: text => {
        try {
          void window?.webContents.executeJavaScript(`document.getElementById('status').textContent=${JSON.stringify(text)}`).catch(() => {});
        } catch { /* 启动页可能已经关闭 */ }
      },
    });
    log(`Provision: ${provision.map(item => `${item.name}=${item.status}`).join(', ')}`);
    hostLogFile = path.join(app.getPath('userData'), 'logs/dsh-host.log');
    host = new DshHost({
      node, entry, home, patch, lifecycle, cwd: app.getPath('userData'), log, logFile: hostLogFile,
      trustedHosts: remote.enabled && remote.host ? [`${remote.host}:${remote.port}`] : [],
    });
    host.on('exit', info => {
      log(`Host exit: ${JSON.stringify(info)}`);
      writeHostCache({});
      if (!info.expected && !quitting && !starting) void showSplash('DSH 服务意外退出，可重试启动。');
    });
    const url = await host.start();
    if (quitting) return;
    // 远程模式：窗口和外部浏览器都只走网关；dsh web 仍只监听回环。
    let pageUrl = url;
    if (remote.enabled) {
      if (!remote.host) throw new Error('PILOT_REMOTE=1 时必须设置 PILOT_REMOTE_HOST（本机局域网地址）');
      const auth = new PilotAuth(path.join(home, 'storages', 'dsh-pilot', 'auth.json'));
      await auth.open();
      gateway = await startGateway({ upstream: url, auth, listenHost: remote.host, listenPort: remote.port });
      pageUrl = gateway.url;
      log(`Gateway listening on ${gateway.url} (auth mode: ${auth.mode})`);
    }
    if (persistHost) writeHostCache({ url, pid: host.child?.pid, fingerprint, startedAt: Date.now(), version: app.getVersion() });
    hostPersisted = true;
    origin = new URL(pageUrl).origin;
    await window.loadURL(pageUrl);
    log('DSH ready; desktop page loaded');
    if (smoke) {
      await new Promise(r => setTimeout(r, 5000));
      const info = await window.webContents.executeJavaScript('window.pilotDesktop.getInfo()');
      const result = await window.webContents.executeJavaScript('({title:document.title,text:document.body.innerText.slice(0,16000),errors:document.body.innerText.includes("Failed to load plugins"),homeEntry:[...document.querySelectorAll("button")].some(el => (el.textContent + el.getAttribute("aria-label") + el.title).includes("Pilot 首页"))})');
      result.info = info;
      writeFileSync(path.join(app.getPath('userData'), 'smoke-result.json'), JSON.stringify(result, null, 2));
      writeFileSync(path.join(app.getPath('userData'), 'home.png'), (await window.webContents.capturePage()).toPNG());
      if (result.errors || result.homeEntry || info.name !== 'Pilot') throw new Error('Renderer smoke check failed');
      result.chrome = await window.webContents.executeJavaScript("document.querySelector('.pilot-window-titlebar')?.outerHTML.slice(0,700) ?? null");
      await window.webContents.executeJavaScript(`(async () => {
        const pause = () => new Promise(resolve => setTimeout(resolve, 400));
        const sidebar = document.querySelector('.pilot-sidebar');
        if (!sidebar) throw new Error('Pilot sidebar missing');
        const box = sidebar.getBoundingClientRect();
        const rail = sidebar.querySelector('.pilot-activitybar')?.getBoundingClientRect();
        const menu = sidebar.querySelector('.pilot-menu')?.getBoundingClientRect();
        if (!rail || !menu || box.width < 200 || Math.abs(rail.width - 48) > 1 || menu.x < rail.right - 1 || Math.abs(box.top) > 1) throw new Error('Rail + menu column layout failed: ' + JSON.stringify({ box, rail, menu }));
        const pageRows = sidebar.querySelectorAll('.pilot-page-list .pilot-menu-item').length;
        if (pageRows !== 3) throw new Error('Menu column page list failed: ' + pageRows);
        const home = document.querySelector('.pilot-home');
        if (!home || home.getBoundingClientRect().height < 100) throw new Error('Workbench surface missing from the main slot: ' + JSON.stringify(home && home.getBoundingClientRect()));
        const currentPanel = sidebar.querySelector('.pilot-activity[aria-current="page"]')?.getAttribute('aria-label') ?? '';
        if (currentPanel !== '工作台') throw new Error('Workbench is not the active rail item: ' + currentPanel);
        const pageTitle = () => document.querySelector('.pilot-home .pilot-view-title')?.textContent || '';
        const firstPage = pageTitle();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', metaKey: true }));
        await pause();
        // 字体统一为微软雅黑：宿主组件与我们的壳层都要走同一族
        const shellFont = getComputedStyle(document.querySelector('.pilot-home')).fontFamily;
        const sidebarFont = getComputedStyle(sidebar.querySelector('.pilot-menu-title')).fontFamily;
        if (!/Microsoft YaHei|微软雅黑/i.test(shellFont) || !/Microsoft YaHei|微软雅黑/i.test(sidebarFont)) {
          throw new Error('Shell font is not Microsoft YaHei: ' + JSON.stringify({ shellFont, sidebarFont }));
        }
        const secondPage = pageTitle();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true }));
        await pause();
        const backPage = pageTitle();
        if (!firstPage || !secondPage || secondPage === firstPage || backPage !== firstPage) throw new Error('Page shortcuts failed: ' + JSON.stringify({ firstPage, secondPage, backPage }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
        await pause();
        const paletteOpen = !!document.querySelector('.pilot-palette');
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await pause();
        const paletteClosed = !document.querySelector('.pilot-palette');
        if (!paletteOpen || !paletteClosed) throw new Error('Command palette failed: ' + JSON.stringify({ paletteOpen, paletteClosed }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', metaKey: true }));
        await pause();
        const settingRows = document.querySelectorAll('.pilot-home .pilot-setrow').length;
        const toggleCount = document.querySelectorAll('.pilot-home .pilot-switch').length;
        const hostState = await fetch('/pilot', { headers: { accept: 'application/json' } }).then(response => (response.ok ? response.json() : null)).catch(() => null);
        if (!hostState || typeof hostState.version !== 'number' || typeof hostState.settings !== 'object') throw new Error('Pilot host HTTP surface missing: ' + JSON.stringify(hostState));
        const created = await fetch('/pilot/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'smoke 写入验证' }) }).then(response => (response.ok ? response.json() : null)).catch(() => null);
        const listed = await fetch('/pilot/tasks', { headers: { accept: 'application/json' } }).then(response => (response.ok ? response.json() : null)).catch(() => null);
        if (!created?.task?.id || !listed?.tasks?.some(task => task.id === created.task.id)) throw new Error('Pilot host task round-trip failed: ' + JSON.stringify({ created, listed }));
        await fetch('/pilot/tasks/' + encodeURIComponent(created.task.id), { method: 'DELETE' }).catch(() => null);
        const savedSettings = await fetch('/pilot/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ defaultPage: 'tools' }) }).then(response => (response.ok ? response.json() : null)).catch(() => null);
        if (savedSettings?.settings?.defaultPage !== 'tools') throw new Error('Pilot host settings write failed: ' + JSON.stringify(savedSettings));
        await fetch('/pilot/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ defaultPage: 'workbench' }) }).catch(() => null);
        const resetButton = [...document.querySelectorAll('.pilot-home .pilot-pill')].find(button => button.textContent === '恢复默认');
        if (!resetButton) throw new Error('Settings reset control missing');
        resetButton.click();
        await pause();
        const keysOn = document.querySelector('.pilot-sidebar').dataset.kbd === 'on';
        if (settingRows < 6 || toggleCount < 1 || !keysOn) throw new Error('Settings page failed: ' + JSON.stringify({ settingRows, toggleCount, keysOn }));
        const titlebarEl = document.querySelector('.pilot-window-titlebar');
        const toolbarToggle = sidebar.querySelector('.pilot-collapse-trigger');
        if (!toolbarToggle) throw new Error('Collapse control missing');
        // 先保证是展开态，再折叠（折叠状态可能来自窄窗口的自动收起）
        if (sidebar.dataset.collapsed === 'true') { toolbarToggle.click(); await pause(); }
        if (sidebar.dataset.collapsed !== 'false') throw new Error('Sidebar expand failed before collapse check');
        toolbarToggle.click();
        await pause();
        if (sidebar.dataset.collapsed !== 'true') throw new Error('Sidebar collapse failed');
        // 品牌章（侧栏图标轨顶部）折叠后仍然可见
        const brand = sidebar.querySelector('.pilot-brand');
        if (!brand) throw new Error('Brand mark lost when collapsed');
        // 折叠后图标轨仍固定 48px（不随 56px 折叠列变宽），内容从侧栏列右边缘开始。
        // 宿主对 grid-template-columns 有过渡动画，等它稳定再量。
        let railWidth = 0;
        let homeLeft = 0;
        let colRight = 0;
        for (let i = 0; i < 25; i += 1) {
          railWidth = sidebar.querySelector('.pilot-activitybar').getBoundingClientRect().width;
          colRight = sidebar.getBoundingClientRect().right;
          homeLeft = document.querySelector('.pilot-home').getBoundingClientRect().x;
          if (Math.abs(homeLeft - colRight) <= 1 && Math.abs(railWidth - 48) <= 1) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (Math.abs(railWidth - 48) > 1) {
          throw new Error('Collapsed rail width changed: ' + JSON.stringify({ railWidth }));
        }
        if (Math.abs(homeLeft - colRight) > 1) {
          throw new Error('Collapsed content does not start at the sidebar edge: ' + JSON.stringify({ homeLeft, colRight }));
        }
        toolbarToggle.click();
        await pause();
        if (sidebar.dataset.collapsed !== 'false') throw new Error('Sidebar expand failed');
        if (sidebar.querySelector('.pilot-collapse-trigger').getAttribute('aria-label') !== '折叠侧边栏') throw new Error('Collapse control label did not flip back');
        const settings = [...sidebar.querySelectorAll('.pilot-activity-bottom button')].find(button => (button.textContent + button.getAttribute('aria-label') + button.title).includes('设置'));
        if (!settings) throw new Error('Settings trigger missing');
        settings.click();
        await pause();
        const dialog = document.querySelector('.pilot-settings-dialog');
        if (!dialog) throw new Error('Pilot settings dialog did not open from the gear');
        const navItems = [...dialog.querySelectorAll('.pilot-settings-navitem')];
        if (navItems.length < 2) throw new Error('Host settings sections missing in the dialog: ' + navItems.length);
        const hostItem = navItems.find(item => item.textContent.trim() !== '本机偏好');
        if (!hostItem) throw new Error('No host settings section to select');
        hostItem.click();
        await pause();
        const hostContent = dialog.querySelector('.pilot-settings-content')?.textContent?.trim() ?? '';
        if (hostContent.length < 4) throw new Error('Host settings section rendered empty: ' + hostContent.slice(0, 60));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await pause();
        if (document.querySelector('.pilot-settings-dialog')) throw new Error('Escape did not close the settings dialog');
        await pause();
        document.querySelector('.pilot-new-session').click();
        await pause();
        const workspaces = sidebar.querySelector('.pilot-workspaces');
        const menuTitle = sidebar.querySelector('.pilot-menu-title')?.textContent ?? '';
        const agentText = workspaces?.innerText ?? '';
        if (!workspaces || workspaces.hidden || menuTitle !== '会话与项目') throw new Error('New session left the session view (menu: ' + menuTitle + ')');
        if (!workspaces.textContent.trim()) throw new Error('Workspace region missing');
        // 宿主浏览器在空工作区下只渲染宿主空态；有会话时才有分组标题与行。
        if (agentText.trim().length < 2) throw new Error('Agent page rendered empty: ' + JSON.stringify(agentText.slice(0, 80)));
        // 普通会话直接列出来，不再套「默认工作区」分组：平铺模式的标题是「会话」
        const sectionLabel = workspaces.querySelector('[class*="sectionLabel"]')?.textContent?.trim() ?? '';
        if (sectionLabel === '工作区') throw new Error('Workspace grouping not flattened: ' + sectionLabel);
      })()`);
      log('Pilot sidebar collapse, settings and new-session checks passed');
      const view = await window.webContents.executeJavaScript('(() => { try { return JSON.parse(localStorage.getItem("dsh.workspace.view.v5") || "null"); } catch { return null; } })()');
      if (view && view.groupBy !== 'flat') throw new Error('Pilot workspace view not flattened: ' + JSON.stringify(view));
      app.quit();
    }
  } catch (error) {
    log(error.stack ?? error);
    await host?.stop();
    hostPersisted = false;
    writeHostCache({});
    if (smoke) { process.exitCode = 1; app.quit(); }
    else if (!quitting) await showSplash(error.message);
  } finally { starting = false; }
}
if (locked) {
  app.on('second-instance', show);
  app.on('before-quit', event => {
    if (finalExit) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void (async () => {
      // 正常退出不杀 host：让 dsh web 留在后台，下次启动直接复用（省掉 25–30s 冷启动）。
      // smoke 用一次性 home、或本次启动没成功登记缓存时必须停掉，避免留下没人认领的进程。
      if (!persistHost || !hostPersisted) await host?.stop();
      if (gateway) { await gateway.close(); gateway = undefined; }
      tray?.destroy();
      finalExit = true;
      app.quit();
    })();
  });
  app.whenReady().then(async () => {
    const data = app.getPath('userData');
    mkdirSync(path.join(data, 'logs'), { recursive: true });
    logPath = path.join(data, 'logs/pilot.log');
    const root = path.resolve(__dirname, '../../..');
    const resources = app.isPackaged ? path.join(app.getAppPath(), 'resources') : path.join(root, 'apps/desktop/resources');
    splashPath = path.join(resources, 'loading.html');
    window = new BrowserWindow({ title: 'Pilot', frame: false, titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#454545', height: 50 }, autoHideMenuBar: true, icon: path.join(resources, 'icon.png'), width: 1320, height: 880, minWidth: 900, minHeight: 640, backgroundColor: '#ffffff', show: !smoke, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.webContents.on('preload-error', (_event, preloadPath, error) => log(`Preload failed (${preloadPath}): ${error.stack ?? error.message}`));
    window.on('page-title-updated', event => { event.preventDefault(); window.setTitle('Pilot'); });
    window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
    window.webContents.on('will-navigate', (event, url) => { if (!origin || new URL(url).origin !== origin) event.preventDefault(); });
    window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
    window.webContents.on('console-message', (_event, _level, message) => log(`[renderer] ${message}`));
    // 没有应用菜单就没有默认的 Ctrl+R：这里补一个页面刷新快捷键（F5 同效），
    // 改客户端插件后不必整个重启应用。调试用，不打断正在进行的会话。
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const reload = (input.control || input.meta) && input.key.toLowerCase() === 'r';
      if (!reload && input.key !== 'F5') return;
      event.preventDefault();
      log('Renderer reload requested by shortcut');
      window.webContents.reload();
    });
    window.webContents.on('render-process-gone', (_event, detail) => { log(`Renderer exited: ${detail.reason}`); if (!quitting) void showSplash('页面进程已退出，请重试。'); });
    const icon = nativeImage.createFromPath(path.join(resources, 'icon.png'));
    tray = new Tray(icon);
    tray.setToolTip('Pilot');
    tray.on('click', show);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 Pilot', click: show },
      { label: '重启服务', click: () => { show(); forceCold = true; void start(); } },
      { label: '查看日志', click: () => shell.openPath(path.dirname(logPath)) },
      { label: '检查更新', click: checkForUpdates },
      { type: 'separator' },
      // 「退出」保留后台服务（下次秒开）；要连服务一起停用这一项。
      { label: '退出（后台服务保留）', click: () => app.quit() },
      { label: '停止服务并退出', click: () => { persistHost = false; forceCold = true; app.quit(); } },
    ]));
    Menu.setApplicationMenu(null);
    ipcMain.handle('pilot:info', event => { allowed(event); return { name: 'Pilot', version: app.getVersion(), platform: process.platform, frameless: true }; });
    ipcMain.handle('pilot:retry', event => { allowed(event); void start(); });
    ipcMain.handle('pilot:logs', event => { allowed(event); return shell.openPath(path.dirname(logPath)); });
    ipcMain.handle('pilot:select-directory', async event => { allowed(event); const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
    ipcMain.handle('pilot:updates', event => { allowed(event); return checkForUpdates(); });
    await start();
  }).catch(error => { log(error.stack); process.exitCode = 1; app.quit(); });
}
async function checkForUpdates() {
  await dialog.showMessageBox(window, { type: 'info', title: 'Pilot 更新', message: `当前版本 ${app.getVersion()}`, detail: '尚未配置发行仓库。更新源将在正式发布时接入；当前请通过项目发行包更新。' });
  return { configured: false };
}
