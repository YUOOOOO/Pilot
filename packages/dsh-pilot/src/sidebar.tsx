/** @jsxRuntime classic */
import * as React from 'react';
import './styles/shell.css';
import { navGroups, pageById } from './workbench/registry';
import { go, setAgent, toggleSettings, useWorkbench } from './workbench/store';
import { bindSlotBridge } from './workbench/slots';
import { SettingsDialog } from './workbench/settings-dialog';
import { PilotMark } from './brand';
import { AgentMenu, defaultWorkspaceId } from './agent-menu';

type Dispose = () => void;
type Panel = { id: string; label: string; order: number };
export interface SidebarContext {
  slots: {
    inject(name: string, setup: () => Dispose): unknown;
    register(options: object, component: React.ComponentType<any>): Dispose;
    entriesOfSlot(name: string): { options: { id: string; label?: unknown; order?: number } }[];
    subscribe(name: string, listener: () => void): Dispose;
  };
  effect(setup: () => Dispose, label?: string): unknown;
  locale: { subscribe(listener: () => void): Dispose };
  uiWorkspace: { startSession(): void };
  layout: { selectPanel(id: string): void; toggleSidebar(): void };
}
interface SidebarProps {
  collapsed: boolean;
  width?: number;
  renderSlot: (name: string, props: object, options?: object) => React.ReactNode;
  usePanels: <T>(selector: (panels: readonly Panel[]) => T) => T;
  usePanelInfo: <T>(selector: (state: { activePanelId: string }) => T) => T;
  startSession(workspaceId?: string): void;
  selectPanel(id: string): void;
  toggleSidebar(): void;
}

export type IconKind = 'plus' | 'panel' | 'files' | 'robot' | 'code' | 'clock' | 'plug' | 'bell' | 'settings' | 'home' | 'wrench' | 'collapse' | 'expand';

export function Icon({ kind, size = 16 }: { kind: IconKind; size?: number }) {
  const paths: Record<IconKind, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
    files: <><path d="M8 3h9l4 4v13H8z" /><path d="M17 3v5h4M4 7H3v15h13" /></>,
    robot: <><rect x="4" y="7" width="16" height="13" rx="3" /><path d="M12 3v4M9 3h3M1 12v4m22-4v4M8 12h8M9 12v4m6-4v4" /></>,
    code: <><path d="m7 6-5 6 5 6m10-12 5 6-5 6M14 4l-4 16" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></>,
    plug: <><path d="M8 3v5m8-5v5M6 8h12v4a6 6 0 0 1-12 0V8Zm6 10v4" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    settings: <><path d="m9.3 3-.6 2.1-2 .9-2.1-.5-2 3.5L4 10.5v2.3l-1.4 1.5 2 3.5 2.1-.5 2 .9.6 2.1h4l.6-2.1 2-.9 2.1.5 2-3.5-1.4-1.5v-2.3L20 9l-2-3.5-2.1.5-2-.9-.6-2.1h-4Z" /><circle cx="11.3" cy="11.7" r="3" /></>,
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9.5V20h14V9.5" /><path d="M9.5 20v-6h5v6" /></>,
    wrench: <><path d="M15.5 3.5a5 5 0 0 0-6.4 6.4L3.5 15.5 8.5 20.5l5.6-5.6a5 5 0 0 0 6.4-6.4l-3 3-2.5-.5-.5-2.5 3-3Z" /></>,
    collapse: <><path d="M5 4v16" /><path d="m14 8-4 4 4 4" /></>,
    expand: <><path d="M5 4v16" /><path d="m10 8 4 4-4 4" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}

// 三栏结构：48px 图标轨（会话与项目 / 工作台 / 各面板 / 任务动态 / 底部设置）
// + 菜单列（当前图标对应的列表）+ 右侧内容区。类名保持全局，preload 与冒烟按名字量尺寸。
function PilotSidebar({ collapsed, width, renderSlot, usePanels, usePanelInfo, startSession, selectPanel, toggleSidebar }: SidebarProps) {
  const groups = navGroups();
  const flat = groups.flatMap(group => group.entries);
  const ownTitles = new Set(flat.map(entry => entry.meta.title));
  // 宿主面板与本地页面同名时只保留本地页面，避免侧轨出现两条同名入口。
  const panels = [...usePanels(value => value)]
    .filter(panel => panel.id !== 'pilot-home' && !ownTitles.has(panel.label))
    .sort((a, b) => {
      const rank = (id: string) => id === 'schedules' ? 0 : id === 'plugins' ? 1 : 2;
      return rank(a.id) - rank(b.id);
    });
  const active = usePanelInfo(value => value.activePanelId);
  const store = useWorkbench();
  // DSH clears the panel to null for the conversation surface; both spellings mean sessions.
  const agent = store.agent;
  const selectedPanel = panels.find(panel => panel.id === active);
  const ownPage = pageById(store.page) ?? flat[0];
  // 菜单列内容由显式的 agent 状态决定：agent 页 = 宿主的会话/项目浏览器，其余 = Pilot 页面列表。
  const onOwnPage = !agent && active === 'pilot-home';
  const title = agent ? 'agent' : ownPage?.meta.title || selectedPanel?.label || '工作台';
  // 按钮/导航触发的收起或展开也走过渡（宿主默认切换不一定触发动画）
  const animateToggle = () => {
    document.documentElement.setAttribute('data-pilot-collapsing', '');
    window.setTimeout(() => document.documentElement.removeAttribute('data-pilot-collapsing'), 520);
    toggleSidebar();
  };
  const activate = (id: string) => { selectPanel(id); if (collapsed) animateToggle(); };
  const openAgent = () => { setAgent(true); activate('conversation'); };
  const openPage = (id: string) => { setAgent(false); go(id); activate('pilot-home'); };
  // 启动落点由「默认页面」偏好决定：agent 直接进会话与项目，其余落到工作台。
  // 宿主可能在启动后恢复上次面板，所以等一小会儿再抢占一次座位。
  const activeRef = React.useRef(active);
  activeRef.current = active;
  const defaultPref = React.useRef(store.prefs.defaultPage);
  const claimed = React.useRef(false);
  React.useEffect(() => {
    // 用户在抢占窗口期内已经点过东西（比如点开一个会话）就不要再抢座位，
    // 否则会把正在打开的会话顶回工作台。
    const cancelOnInteraction = () => { claimed.current = true; };
    document.addEventListener('pointerdown', cancelOnInteraction, true);
    const timer = setTimeout(() => {
      document.removeEventListener('pointerdown', cancelOnInteraction, true);
      if (claimed.current) return;
      claimed.current = true;
      if (defaultPref.current === 'agent') { setAgent(true); selectPanel('conversation'); return; }
      if (!activeRef.current || activeRef.current === 'conversation') { setAgent(false); selectPanel('pilot-home'); }
    }, 300);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', cancelOnInteraction, true);
    };
  }, [selectPanel]);
  // 拖拽菜单栏缩到 min-width 后继续往左拉 → 带动画收起：宿主列宽卡在最小值后不再变化，
  // 用指针越过侧栏右边缘 60px 判断「还在往左拖」，这时直接收起，按钮随 collapsed 变成展开。
  const widthRef = React.useRef(width ?? 280);
  widthRef.current = width ?? widthRef.current;
  const toggleRef = React.useRef(toggleSidebar);
  toggleRef.current = toggleSidebar;
  React.useEffect(() => {
    if (collapsed) return;
    let active = false;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as Element | null;
      if (!target || !target.closest('[data-side="sidebar"]')) return;
      active = true;
    };
    const onMove = (event: PointerEvent) => {
      if (!active) return;
      if (event.clientX < widthRef.current - 60) {
        active = false;
        event.stopPropagation();
        // 强制列宽走过渡，产生「往左收起」的动画；宿主在拖拽态默认会关掉过渡
        document.documentElement.setAttribute('data-pilot-collapsing', '');
        window.setTimeout(() => document.documentElement.removeAttribute('data-pilot-collapsing'), 520);
        toggleRef.current();
      }
    };
    const stop = () => { active = false; };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', stop, true);
    document.addEventListener('pointercancel', stop, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', stop, true);
      document.removeEventListener('pointercancel', stop, true);
    };
  }, [collapsed]);
  const panelIcon = (panel: Panel) => panel.id === 'schedules' ? <Icon kind="clock" size={20} />
    : panel.id === 'plugins' ? <Icon kind="plug" size={20} />
      : <>{renderSlot('sidebar.panellist', { size: 20, active: active === panel.id }, { only: panel.id })}</>;
  return <aside className="pilot-sidebar" data-collapsed={collapsed} data-kbd={store.prefs.showKeys ? 'on' : 'off'} data-accent={store.prefs.accent} aria-label="Pilot 工作台侧边栏">
    <nav className="pilot-activitybar" aria-label="活动栏">
      <button type="button" className="pilot-brand" aria-label={collapsed ? '展开菜单栏' : '收起菜单栏'} title={collapsed ? '展开菜单栏' : '收起菜单栏'} onClick={animateToggle}><PilotMark size={26} /></button>
      <span className="pilot-rail-sep" aria-hidden="true" />
      <button type="button" className="pilot-activity" aria-label="工作台" title="工作台" aria-current={!agent ? 'page' : undefined} onClick={() => openPage(ownPage?.id ?? 'workbench')}>
        <Icon kind="home" size={20} />
      </button>
      <button type="button" className="pilot-activity" aria-label="agent" title="agent" aria-current={agent ? 'page' : undefined} onClick={openAgent}>
        <Icon kind="robot" size={20} />
      </button>
      <span className="pilot-rail-sep" aria-hidden="true" />
      {panels.map(panel => <button key={panel.id} type="button" className="pilot-activity" aria-label={panel.label} title={panel.label} aria-current={active === panel.id ? 'page' : undefined} onClick={() => activate(panel.id)}>
        {panelIcon(panel)}
      </button>)}
      <button type="button" className="pilot-activity" aria-label="任务动态" title="任务动态" onClick={() => activate('schedules')}>
        <Icon kind="bell" size={20} />
      </button>
      <div className="pilot-activity-bottom">
        <button type="button" className="pilot-activity pilot-collapse-trigger" aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'} title={collapsed ? '展开侧边栏' : '折叠侧边栏'} onClick={animateToggle}>
          <Icon kind={collapsed ? 'expand' : 'collapse'} size={20} />
        </button>
        <div className="pilot-footer-settings">
          <button type="button" className="pilot-activity pilot-settings-trigger" aria-label="设置" title="设置" onClick={() => toggleSettings(true)}><Icon kind="settings" size={20} /></button>
        </div>
        {renderSlot('sidebar.footer.action', { wide: false })}
      </div>
    </nav>
    <section className="pilot-menu" aria-label="功能菜单栏">
      <header className="pilot-menu-header">
        <span className="pilot-menu-title">{title}</span>
      </header>
      <div className="pilot-workspaces" hidden={!agent}><AgentMenu onNewSession={workspaceId => startSession(workspaceId)} /></div>
      <div className="pilot-page-list" hidden={agent}>
        {flat.map((entry, index) => <button
          key={entry.id}
          type="button"
          className="pilot-menu-item"
          aria-current={store.page === entry.id ? 'page' : undefined}
          title={`${entry.meta.title} — ${entry.meta.hint}`}
          onClick={() => openPage(entry.id)}
        >
          <Icon kind={entry.meta.icon} size={15} />
          <span>{entry.meta.title}</span>
          <kbd className="pilot-kbd">⌘{index + 1}</kbd>
        </button>)}
      </div>
      <div className="pilot-context-menu" hidden={agent || onOwnPage}>
        {selectedPanel && <button type="button" className="pilot-menu-item" aria-current="page" onClick={() => selectPanel(selectedPanel.id)}>{renderSlot('sidebar.panellist', { size: 15, active: true }, { only: selectedPanel.id })}<span>{selectedPanel.label}</span></button>}
      </div>
    </section>
    <SettingsDialog renderSlot={renderSlot} />
  </aside>;
}

export function registerSidebar(ctx: SidebarContext) {
  // 设置弹窗要自己枚举并渲染宿主的 settings.section 分组，先把 slots 能力交给它。
  bindSlotBridge(ctx.slots);
  // DSH rc.5 declares child seats exclusively on the original sidebar entry.
  // Keep that entry and its injected services; adapt only its presentation.
  const registry = ctx.slots as SidebarContext['slots'] & {
    entries(name: string): { component: React.ComponentType<any> }[];
  };
  ctx.effect(() => {
    const entry = registry.entries('sidebar')[0];
    if (!entry) throw new Error('Official sidebar registration is required');
    // 允许侧栏里的 Pilot 设置弹窗直接渲染宿主的 settings.section 分组：
    // 授权按注册条目的 children 判定，官方侧栏条目没有声明这个子槽，这里补上。
    const target = entry as unknown as { component: React.ComponentType<any>; children?: Record<string, unknown> };
    target.children = { ...(target.children ?? {}), 'settings.section': { kind: 'list', scope: 'root' } };
    const original = target.component;
    target.component = PilotSidebar;
    return () => { if (target.component === PilotSidebar) target.component = original; };
  }, 'pilot: sidebar presentation adapter');
}
