/** @jsxRuntime classic */
import * as React from 'react';
import { product } from './product';
import { registerSidebar, Icon, type SidebarContext } from './sidebar';
import { PilotMark, PilotName } from './brand';
import { useDesktopInfo } from './core/desktop';
import { WorkbenchApp } from './workbench/shell';
import { flattenWorkspaceGrouping } from './workbench/workspace-view';
import { bindWorkspaceApi } from './agent-menu';
import { readHostState } from './core/host-api';
import { setPrefs } from './workbench/store';
import { bindCostMeter } from './workbench/cost-meter';
import { isAccentId, normalizeDefaultPage, type PilotPrefs } from './workbench/prefs';
// 越早写越好：宿主的会话浏览器在模块初始化时读取这份视图状态
flattenWorkspaceGrouping();
// 页面模块自注册进注册表；顺序即 ⌘1..N 与侧轨顺序
import './pages/workbench';
import './pages/knowledge';
import './styles/shell.css';

type Dispose = () => void;

// Structural subset of the published rc.5 contracts; no client packages are bundled.
interface ClientContext extends SidebarContext {
  effect(setup: () => Dispose, label?: string): unknown;
}

function WorkbenchIcon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="m3 10 9-7 9 7M5 9v11h14V9M9 20v-7h6v7" />
  </svg>;
}

function PilotVersion() {
  const info = useDesktopInfo();
  return <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '18px 0', borderBottom: '1px solid var(--pilot-line, rgb(33 30 25 / 10%))' }}>
    <div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>关于 Pilot</div>
      <div style={{ fontSize: 12, marginTop: 5, color: 'var(--pilot-ink3, #857d6c)' }}>由 DeepSeek Harness {product.engineVersion} 驱动</div>
    </div>
    <span aria-label={`Pilot 版本 ${info?.version || product.version}`} style={{ fontFamily: 'var(--pilot-mono, ui-monospace, monospace)', fontSize: 11, letterSpacing: '0.04em', color: 'var(--pilot-ink2, #57503f)', fontVariantNumeric: 'tabular-nums' }}>PILOT {info?.version || product.version}</span>
  </div>;
}

export const inject = ['slots', 'layout', 'uiWorkspace', 'locale', 'sessions', 'workspaces', 'remote'];

/**
 * 实测原生窗口按钮（最小化/最大化/关闭）在右上角占用的宽度，写成 CSS 变量。
 * 用 Window Controls Overlay 的 env() 量，拿不到时按 138 CSS px 兜底。
 * 页面缩放会改变这些按钮的 CSS 宽度，所以不能只在启动时算一次。
 */
function syncWindowControls(): void {
  try {
    const root = document.documentElement;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:0;margin:0;';
    probe.style.paddingLeft = 'env(titlebar-area-x, 0px)';
    probe.style.paddingTop = 'env(titlebar-area-width, 0px)';
    root.appendChild(probe);
    const computed = getComputedStyle(probe);
    const x = Number.parseFloat(computed.paddingLeft) || 0;
    const areaWidth = Number.parseFloat(computed.paddingTop) || 0;
    probe.remove();
    const controls = areaWidth > 0 ? Math.round(window.innerWidth - x - areaWidth) : Math.round(138 / (window.devicePixelRatio || 1));
    root.style.setProperty('--pilot-window-controls', `${controls}px`);
    // 宿主面板（自动化任务 / 插件）的页头动作区需要让开的宽度：只有启用 Window Controls
    // Overlay 的 Electron 窗口才留，普通浏览器里留 0，避免平白多出一块右内边距。
    const overlay = (navigator as unknown as { windowControlsOverlay?: { visible?: boolean } }).windowControlsOverlay;
    const hasOverlay = overlay !== undefined && overlay.visible !== false;
    root.style.setProperty('--pilot-window-controls-inset', hasOverlay ? `${controls + 8}px` : '0px');
  } catch { /* CSS 里有兜底 */ }
}

export function apply(ctx: ClientContext) {
  try { registerSidebar(ctx); } catch (error) { console.error('Pilot sidebar activation:', error instanceof Error ? error.stack : String(error)); throw error; }
  // 原生窗口按钮（最小化/最大化/关闭）占右上角一条区域，宽度随缩放/系统缩放/机型变化。
  syncWindowControls();
  // 缩放（Ctrl+= / Ctrl+- / Ctrl+滚轮）和窗口尺寸变化都会改变那条安全区的 CSS 宽度，
  // 重算后宿主面板的页头（见 shell.css 的 t-XoWW_pageHeading / X_2TxG_pageHead 规则）才不会压到按钮。
  ctx.effect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => { frame = 0; syncWindowControls(); });
    };
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, 'pilot: window controls width');
  // 启动时即采用宿主保存的偏好（强调色/默认页面/快捷键提示）覆盖本地默认值，
  // 否则首屏会用默认强调色，直到打开设置弹窗才跳变成宿主保存的那个。
  void readHostState().then(state => {
    const settings = state?.settings;
    if (!settings) return;
    const patch: Partial<PilotPrefs> = {};
    if (typeof settings.accent === 'string' && isAccentId(settings.accent)) patch.accent = settings.accent;
    if (settings.defaultPage !== undefined) patch.defaultPage = normalizeDefaultPage(settings.defaultPage);
    if (settings.showKeys !== undefined) patch.showKeys = settings.showKeys !== false;
    if (Object.keys(patch).length > 0) setPrefs(patch);
  }).catch(() => { /* 宿主未就绪时保持本地偏好 */ });
  // 旧版窗口 preload 会在内容顶部画一个收起按钮；新版已把它移到侧栏。这里清掉运行时残留，
  // 让页面刷新后旧按钮立即消失（彻底移除仍需重启以加载新 preload）。
  try {
    const purgeToggle = () => document.querySelectorAll('.pilot-window-sidebar-toggle, .pilot-window-content, .pilot-window-menu').forEach(el => el.remove());
    purgeToggle();
    window.setTimeout(purgeToggle, 400);
  } catch { /* ignore */ }
  // 标题栏「更多操作」菜单里的「反馈」项（session-log-export 贡献）没有稳定类名。
  // 之前用 MutationObserver 监听所有 DOM 变化，打开会话时会被大量节点变更拖慢；
  // 改成只在「点开某个菜单按钮」后扫一次，避免主线程抖。
  ctx.effect(() => {
    const hideFeedbackRows = () => {
      for (const el of document.querySelectorAll('button, [role="menuitem"], li')) {
        if (!el.querySelector('svg')) continue;
        const text = (el.textContent ?? '').trim();
        if (text === '反馈' || text === 'Feedback') el.style.display = 'none';
      }
    };
    let timer = 0;
    const onPointerDown = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[aria-haspopup="menu"]') === null) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(hideFeedbackRows, 60);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.clearTimeout(timer);
    };
  }, 'pilot: hide feedback menu row');
  // 把宿主的会话/工作区能力交给 agent 菜单（会话/项目 两段列表用）。
  try {
    const services = ctx as unknown as {
      uiWorkspace?: {
        startSession(workspaceId?: string): void;
        openSession(sessionId: string): void;
        pickDirectory(): Promise<string | null>;
        forkSession?(sessionId: string, onCreated?: (childId: string) => void): Promise<unknown>;
      };
      workspaces?: {
        list: { getSnapshot(): unknown; subscribe(listener: () => void): () => void };
        create(input: { path: string }): Promise<unknown>;
        delete?(workspaceId: string): Promise<unknown>;
        pinSession?(sessionId: string): Promise<unknown>;
        unpinSession?(sessionId: string): Promise<unknown>;
        archiveSession?(sessionId: string): Promise<unknown>;
        unarchiveSession?(sessionId: string): Promise<unknown>;
      };
      sessions?: { list: { getSnapshot(): unknown; subscribe(listener: () => void): () => void } };
      remote?: { session?: { rename?(request: { sessionId: string; title: string }): Promise<unknown> } };
    };
    const ui = services.uiWorkspace;
    const workspaces = services.workspaces;
    const sessions = services.sessions;
    if (ui && workspaces && sessions) {
      const ws = workspaces;
      bindWorkspaceApi({
        startSession: (workspaceId?: string) => ui.startSession(workspaceId),
        openSession: (sessionId: string) => ui.openSession(sessionId),
        pickDirectory: () => ui.pickDirectory(),
        createWorkspace: (path: string) => ws.create({ path }),
        deleteWorkspace: (workspaceId: string) => {
          if (!ws.delete) throw new Error('宿主未提供 workspace 删除能力');
          return ws.delete(workspaceId);
        },
        pinSession: (sessionId: string, pinned: boolean) => { void (pinned ? ws.pinSession?.(sessionId) : ws.unpinSession?.(sessionId)); },
        archiveSession: (sessionId: string, archived: boolean) => { void (archived ? ws.archiveSession?.(sessionId) : ws.unarchiveSession?.(sessionId)); },
        forkSession: (sessionId: string) => { void ui.forkSession?.(sessionId); },
        copySessionId: (sessionId: string) => { void navigator.clipboard?.writeText(sessionId).catch(() => undefined); },
        renameSession: (sessionId: string, title: string) => { void services.remote?.session?.rename?.({ sessionId, title }); },
        workspaces: ws.list,
        sessions: sessions.list,
      });
    }
  } catch { /* 宿主服务缺失时列表保持空态 */ }
  // 工作台的费用概览直接读 dsh-cost-meter 的 remote.costMeter；插件未安装时这里只留空绑定，
  // 页面自己显示安装提示，不影响其它页面。
  try {
    bindCostMeter(ctx as unknown as { get?(name: string): unknown; remote?: Record<string, unknown> });
  } catch (error) {
    console.warn('Pilot cost-meter binding:', error instanceof Error ? error.message : String(error));
  }
  // Pilot opens directly into its workbench; credentials remain user-configurable.
  for (const id of ['welcome-notice', 'deepseek-official']) {
    ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
      name: 'settings.onboarding', id, priority: -100,
    }, () => null));
  }
  ctx.slots.inject('settings.launcher', () => ctx.slots.register({ name: 'settings.launcher', priority: -100 }, ({ openSettings }: { openSettings(): void }) => <button type="button" aria-label="设置" title="设置" onClick={openSettings} style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer' }}><Icon kind="settings" /></button>));
  ctx.effect(() => {
    const previous = document.title;
    document.title = 'Pilot';
    return () => { if (document.title === 'Pilot') document.title = previous; };
  }, 'pilot: page title');
  // Match official plugins: declaration-aware injections own their registrations.
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({ name: 'sidebar.brand.mark' }, PilotMark));
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({ name: 'sidebar.brand.name' }, PilotName));
  // The workbench is a real panel seat: the host renders the `main` entry whose key
  // matches the active panel, so the pages only appear once this seat exists.
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: 'pilot-home', inject: () => ({ openConversation: () => ctx.layout.selectPanel(null) }),
  }, WorkbenchApp));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: 'pilot-home', order: -100, label: '工作台',
  }, WorkbenchIcon));
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'pilot-version', order: 100,
  }, PilotVersion));
}
