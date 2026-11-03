/** @jsxRuntime classic */
import * as React from 'react';
import { product } from './product';
import { registerSidebar, Icon, type SidebarContext } from './sidebar';
import { PilotMark, PilotName } from './brand';
import { useDesktopInfo } from './core/desktop';
import { WorkbenchApp } from './workbench/shell';
import { flattenWorkspaceGrouping } from './workbench/workspace-view';
import { bindWorkspaceApi } from './agent-menu';
// 越早写越好：宿主的会话浏览器在模块初始化时读取这份视图状态
flattenWorkspaceGrouping();
// 页面模块自注册进注册表；顺序即 ⌘1..N 与侧轨顺序
import './pages/workbench';
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

export function apply(ctx: ClientContext) {
  try { registerSidebar(ctx); } catch (error) { console.error('Pilot sidebar activation:', error instanceof Error ? error.stack : String(error)); throw error; }
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
    name: 'main', key: 'pilot-home', inject: () => ({ openConversation: () => ctx.layout.selectPanel('conversation') }),
  }, WorkbenchApp));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: 'pilot-home', order: -100, label: '工作台',
  }, WorkbenchIcon));
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'pilot-version', order: 100,
  }, PilotVersion));
}
