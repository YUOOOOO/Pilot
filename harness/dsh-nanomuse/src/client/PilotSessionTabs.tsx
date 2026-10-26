/** A presentation-only tab strip over the existing DSH conversation. */
import { createElement as h, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Translate } from './api.ts'
import { useSyncList, type UseSessionList, type UseStatusMap } from './MuseChats.tsx'
import { IconClose, IconPlus } from './icons.tsx'
import { readTabs, reduceTabs, TABS_KEY, type CloseTabs, type SessionTabsState, type TabsAction } from './pilot-tabs-state.ts'

let saved: string | null = null
try { saved = window.localStorage.getItem(TABS_KEY) } catch { /* memory-only navigation */ }
let state = readTabs(saved)
const listeners = new Set<() => void>()
function dispatch(action: TabsAction): SessionTabsState {
  state = reduceTabs(state, action)
  saved = JSON.stringify(state)
  try { window.localStorage.setItem(TABS_KEY, saved) } catch { /* memory-only navigation */ }
  for (const listener of listeners) listener()
  return state
}
export function openPilotTab(id: string): void { dispatch({ type: 'open', id }) }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const snapshot = () => state

interface TabActions { openSession(id: string): void; startSession(): void }
interface Props { t: Translate; useSessions: UseSessionList; useSessionStatus?: UseStatusMap | undefined; actions: TabActions }
interface Menu { id: string; x: number; y: number }

export function PilotSessionTabs({ t, useSessions, useSessionStatus, actions }: Props): ReactNode {
  const sessions = useSessions((s) => s)
  const sync = useSyncList()
  const tabs = useSyncExternalStore(subscribe, snapshot, snapshot)
  const current = Object.values(sessions.byId).find((s) => (s.retainedBy.mainView ?? 0) > 0)?.id
  const statuses = typeof useSessionStatus === 'function' ? useSessionStatus((s) => s) : new Map()
  const [menu, setMenu] = useState<Menu | null>(null)
  const dragged = useRef<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null)
  const menuElement = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const initial = useRef(true)
  useEffect(() => {
    if (sessions.phase !== 'ready' || !current || sync.foreign.has(current)) return
    const first = initial.current
    initial.current = false
    if (first && saved !== null) {
      if (state.ids.length === 0) return
      if (state.active && state.active !== current && !sync.foreign.has(state.active)) { actions.openSession(state.active); return }
    }
    openPilotTab(current)
  }, [current, sessions.phase])
  useEffect(() => {
    if (sessions.phase !== 'ready') return
    // Catalog updates lag session creation and may omit locally blank sessions.
    // Only an explicit account visibility exclusion removes an open tab here.
    const allowed = state.ids.filter((id) => !sync.foreign.has(id))
    const next = reduceTabs(state, { type: 'retain', ids: allowed })
    if (state.ids.some((id) => sync.foreign.has(id))) {
      dispatch({ type: 'retain', ids: allowed })
      if (next.active && next.active !== current) actions.openSession(next.active)
    }
  }, [sessions.phase, sync.foreign])
  useEffect(() => {
    document.documentElement.toggleAttribute('data-pilot-tabs-empty', tabs.ids.length === 0)
    return () => { document.documentElement.removeAttribute('data-pilot-tabs-empty') }
  }, [tabs.ids.length])
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [tabs.active])

  const activate = (id: string) => { openPilotTab(id); actions.openSession(id) }
  const close = (id: string, mode: CloseTabs) => {
    const before = state.active
    const next = dispatch({ type: 'close', id, mode })
    setMenu(null)
    if (next.active && next.active !== before) actions.openSession(next.active)
    requestAnimationFrame(() => strip.current?.querySelector<HTMLElement>('[aria-selected=true]')?.focus())
  }
  useEffect(() => {
    if (!menu) return
    menuElement.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const dismiss = (event: PointerEvent) => { if (!menuElement.current?.contains(event.target as Node)) setMenu(null) }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMenu(null); strip.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(menu.id)}"] [role=tab]`)?.focus(); return }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
      const buttons = [...(menuElement.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
      if (!buttons.length) return
      event.preventDefault()
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus()
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', key, true)
    const resize = () => setMenu(null)
    window.addEventListener('resize', resize)
    return () => { document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('keydown', key, true); window.removeEventListener('resize', resize) }
  }, [menu])

  return h('div', { className: 'pilot-session-tabs-shell' },
    h('style', null, TAB_STYLES),
    h('div', { className: 'pilot-session-tabs-row' },
      h('div', { ref: strip, className: 'pilot-session-tabs', role: 'tablist', 'aria-label': t('pilotTabsLabel') },
        tabs.ids.map((id) => {
          const session = sessions.byId[id]
          const title = session?.displayTitle || t('chBlank')
          const status = statuses.get(id)
          const running = status?.running ?? session?.running
          const waiting = status?.pendingInteraction !== undefined
          return h('div', {
            key: id, className: `pilot-session-tab${tabs.active === id ? ' pilot-tab-active' : ''}${drop?.id === id ? drop.after ? ' pilot-drop-after' : ' pilot-drop-before' : ''}`,
            'data-tab-id': id, draggable: true,
            onDragStart: (event: React.DragEvent) => { dragged.current = id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-pilot-session-tab', id); setMenu(null) },
            onDragOver: (event: React.DragEvent<HTMLDivElement>) => { if (!dragged.current) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; const rect = event.currentTarget.getBoundingClientRect(); setDrop({ id, after: event.clientX > rect.left + rect.width / 2 }) },
            onDrop: (event: React.DragEvent<HTMLDivElement>) => { event.preventDefault(); if (dragged.current) { const rect = event.currentTarget.getBoundingClientRect(); dispatch({ type: 'move', id: dragged.current, target: id, after: event.clientX > rect.left + rect.width / 2 }) } dragged.current = null; setDrop(null) },
            onDragEnd: () => { dragged.current = null; setDrop(null) },
            onContextMenu: (event: React.MouseEvent) => { event.preventDefault(); setMenu({ id, x: Math.min(Math.max(8, event.clientX), window.innerWidth - 216), y: Math.min(Math.max(8, event.clientY), window.innerHeight - 182) }) },
            onAuxClick: (event: React.MouseEvent) => { if (event.button === 1) { event.preventDefault(); close(id, 'current') } },
          },
          h('button', {
            type: 'button', role: 'tab', 'aria-selected': tabs.active === id, tabIndex: tabs.active === id ? 0 : -1, className: 'pilot-tab-select', title,
            onClick: () => activate(id),
            onKeyDown: (event: React.KeyboardEvent) => {
              if (event.key === 'Delete') { event.preventDefault(); close(id, 'current'); return }
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const index = tabs.ids.indexOf(id)
              const next = event.key === 'Home' ? tabs.ids[0] : event.key === 'End' ? tabs.ids.at(-1) : tabs.ids[(index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.ids.length) % tabs.ids.length]
              if (next) { activate(next); requestAnimationFrame(() => strip.current?.querySelector<HTMLElement>('[aria-selected=true]')?.focus()) }
            },
          }, h('span', { className: `pilot-tab-status${running ? ' pilot-tab-running' : ''}${waiting ? ' pilot-tab-waiting' : ''}`, title: waiting ? t('chWaiting') : running ? t('chRunning') : undefined, 'aria-label': waiting ? t('chWaiting') : running ? t('chRunning') : undefined }, waiting ? '!' : null), h('span', { className: 'pilot-tab-title' }, title)),
          h('button', { type: 'button', className: 'pilot-tab-close', title: t('pilotTabClose'), 'aria-label': t('pilotTabCloseNamed', { name: title }), onClick: () => close(id, 'current'), onMouseDown: (event: React.MouseEvent) => event.stopPropagation() }, h(IconClose, { size: 13 })))
        }))),
    menu ? createPortal(h('div', { ref: menuElement, className: 'pilot-tab-menu', role: 'menu', 'aria-label': t('pilotTabsMenu'), style: { left: menu.x, top: menu.y } },
      (['current', 'others', 'right', 'all'] as const).map((mode) => h('button', { key: mode, type: 'button', role: 'menuitem', disabled: mode === 'others' ? tabs.ids.length < 2 : mode === 'right' ? tabs.ids.indexOf(menu.id) === tabs.ids.length - 1 : false, onClick: () => close(menu.id, mode) }, t(mode === 'current' ? 'pilotTabClose' : mode === 'others' ? 'pilotTabsCloseOthers' : mode === 'right' ? 'pilotTabsCloseRight' : 'pilotTabsCloseAll')))), document.body) : null,
    tabs.ids.length === 0 ? createPortal(h('div', { className: 'pilot-tabs-empty' }, h('div', null, h('h2', null, t('pilotTabsEmpty')), h('p', null, t('pilotTabsEmptySub')), h('button', { type: 'button', className: 'pilot-empty-new', onClick: actions.startSession }, h(IconPlus, { size: 16 }), t('chNewSide')))), document.body) : null)
}

const TAB_STYLES = `
.pilot-conversation-header { width: 100%; min-width: 0; --pilot-tabs-titlebar-height: max(40px, env(titlebar-area-height, 40px)); --pilot-tabs-caption-inset: 0px; }
html[data-nm-platform='win32']:not([data-nm-fullscreen]) .pilot-conversation-header { --pilot-tabs-caption-inset: max(138px, var(--nm-caption-inset, 138px)); }
/* Keep native scrolling interactive; only the unused titlebar tail is draggable. */
.pilot-session-tabs-shell { width: 100%; min-width: 0; }
.pilot-session-tabs-row { display: flex; min-width: 0; height: var(--pilot-tabs-titlebar-height); box-sizing: border-box; align-items: stretch; padding: 0 calc(var(--pilot-tabs-caption-inset) + 128px) 0 8px; border-bottom: 1px solid var(--nm-border, #e5e5e2); background: var(--dsw-alias-bg-base); -webkit-app-region: drag; }
.pilot-session-tabs { display: flex; flex: 0 1 auto; min-width: 0; max-width: 100%; overflow-x: auto; scrollbar-width: thin; gap: 3px; align-items: stretch; -webkit-app-region: no-drag; }
.pilot-session-tab { display: flex; position: relative; flex: 0 0 auto; max-width: 220px; min-width: 112px; align-items: center; margin: 4px 0 0; border: 1px solid transparent; border-radius: 7px 7px 0 0; color: var(--dsw-alias-label-secondary); -webkit-app-region: no-drag; }
.pilot-session-tab:hover { background: var(--nm-hover, #f2f2ef); }
.pilot-session-tab.pilot-tab-active { background: var(--nm-selected, #ebebe7); color: var(--dsw-alias-label-primary); border-color: var(--nm-border, #deded8); border-bottom-color: transparent; }
.pilot-tab-select { display: flex; gap: 7px; align-items: center; flex: 1; min-width: 0; height: 100%; box-sizing: border-box; border: 0; background: transparent; color: inherit; padding: 0 5px 0 10px; font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; -webkit-app-region: no-drag; }
.pilot-tab-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pilot-tab-status { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: currentColor; opacity: .35; }
.pilot-tab-running { opacity: 1; background: #298653; animation: nm-pulse 1.4s infinite; }
.pilot-tab-waiting { opacity: 1; background: #b76b19; color: white; font-size: 9px; width: 11px; height: 11px; flex-basis: 11px; text-align: center; line-height: 11px; }
.pilot-tab-close { display: inline-flex; align-items: center; justify-content: center; flex: none; border: 0; background: transparent; color: inherit; width: 24px; height: 25px; border-radius: 5px; margin: 0 4px; cursor: pointer; -webkit-app-region: no-drag; }
.pilot-tab-close:hover { background: var(--nm-hover, #ddd); }
.pilot-tab-select:focus-visible, .pilot-tab-close:focus-visible { outline: 2px solid #5687d6; outline-offset: -2px; }
.pilot-drop-before::before, .pilot-drop-after::after { content: ''; position: absolute; top: 3px; bottom: 3px; width: 2px; background: #5687d6; }
.pilot-drop-before::before { left: -2px; } .pilot-drop-after::after { right: -2px; }
.pilot-tab-menu { position: fixed; z-index: 150; min-width: 200px; padding: 5px; background: var(--dsw-alias-bg-base, white); color: var(--dsw-alias-label-primary); border: 1px solid var(--nm-border, #ddd); border-radius: 9px; box-shadow: 0 7px 24px #0002; }
.pilot-tab-menu button { display: block; width: 100%; padding: 9px 12px; text-align: left; border: 0; border-radius: 5px; background: transparent; color: inherit; font: inherit; font-size: 12px; cursor: pointer; }
.pilot-tab-menu button:hover, .pilot-tab-menu button:focus-visible { background: var(--nm-hover, #eee); outline: none; }
.pilot-tab-menu button:disabled { opacity: .4; cursor: default; }
[data-conversation-header-leading]:has(.pilot-session-tabs-shell) { display: block; flex: none; width: 100%; min-width: 0; max-width: none; padding: 0; margin: 0; }
header[data-window-drag]:has(.pilot-session-tabs-shell) { display: block; min-height: 0; height: auto; padding: 0; margin: 0; gap: 0; background: var(--dsw-alias-bg-base); }
/* Keep the original session controls and their bindings in a reserved titlebar area. */
html[data-nanomuse] header:has(.pilot-session-tabs-shell) [class*='_titleCluster'] { display: none !important; }
html[data-nanomuse] header:has(.pilot-session-tabs-shell) [class*='_titleRow'] { position: fixed; top: 0; right: 8px; width: 112px; height: max(40px, env(titlebar-area-height, 40px)); min-height: 0; display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 0 !important; margin: 0; box-sizing: border-box; container-type: normal; z-index: 20; -webkit-app-region: no-drag; }
html[data-nanomuse][data-nm-platform='win32']:not([data-nm-fullscreen]) header:has(.pilot-session-tabs-shell) [class*='_titleRow'] { right: calc(max(138px, var(--nm-caption-inset, 138px)) + 8px); }
/* The dock keeps its own controls. Reserve a separate global seat for the session utilities. */
html[data-nanomuse] { --pilot-window-caption-inset: 0px; }
html[data-nanomuse][data-nm-platform='win32']:not([data-nm-fullscreen]) { --pilot-window-caption-inset: max(138px, var(--nm-caption-inset, 138px)); }
html[data-nanomuse]:has([data-sidebar-right-session]:not([hidden]) [data-sidebar-right-panel='push'][data-sidebar-right-open]) header:has(.pilot-session-tabs-shell) [class*='_titleRow'] { right: calc(var(--pilot-window-caption-inset) + 116px); width: 72px; }
html[data-nanomuse]:has([data-sidebar-right-session]:not([hidden]) [data-sidebar-right-panel='push'][data-sidebar-right-open]) .pilot-session-tabs-row { padding-right: 8px; }
html[data-nanomuse]:has([data-sidebar-right-session]:not([hidden]) [data-sidebar-right-panel='fullscreen'][data-sidebar-right-open]) header:has(.pilot-session-tabs-shell) [class*='_titleRow'] { visibility: hidden; }
html[data-nanomuse] [data-dockkit-strip]:has([data-sidebar-right-toggle]) { box-sizing: border-box; height: max(40px, env(titlebar-area-height, 40px)); padding-top: 0; padding-bottom: 0; padding-right: calc(var(--pilot-window-caption-inset) + 5px) !important; -webkit-app-region: no-drag; }
/* Electron drag hit regions ignore visual z-order: keep the utility seat out of the dock's drag region too. */
html[data-nanomuse] [data-dockkit-strip]:has([data-sidebar-right-toggle]) > [data-dockkit-strip-fill] { min-width: 80px; position: relative; align-self: stretch; -webkit-app-region: no-drag; }
html[data-nanomuse] [data-dockkit-strip]:has([data-sidebar-right-toggle]) > [data-dockkit-strip-fill]::before { content: ''; position: absolute; inset: 0 80px 0 0; -webkit-app-region: drag; }
html[data-nanomuse] header:has(.pilot-session-tabs-shell) :is([class*='_headerUtilities'], [class*='_headerCorner']) { display: flex; align-items: center; gap: 8px; margin: 0; flex: none; -webkit-app-region: no-drag; }
html[data-nanomuse] header:has(.pilot-session-tabs-shell) [data-conversation-tabs] { margin-top: 0; padding-top: 8px; }
html[data-nanomuse] header:has(.pilot-session-tabs-shell):not(:has([data-conversation-tabs])) { padding-bottom: 0; border-bottom: 0; }
html[data-pilot-tabs-empty] header:has(.pilot-session-tabs-shell) [class*='_titleRow'] { visibility: hidden; }
.pilot-tabs-empty { position: fixed; z-index: 2; top: max(40px, env(titlebar-area-height, 40px)); bottom: 0; left: var(--pilot-sidebar-width, 280px); right: 0; display: flex; justify-content: center; align-items: center; text-align: center; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
.pilot-tabs-empty h2 { font-size: 23px; font-weight: 550; } .pilot-tabs-empty p { color: var(--dsw-alias-label-secondary); font-size: 13px; }
.pilot-empty-new { display: inline-flex; gap: 7px; align-items: center; padding: 9px 16px; margin-top: 12px; border: 1px solid var(--nm-border, #ddd); border-radius: 7px; background: var(--nm-hover, #eee); color: inherit; cursor: pointer; }
html[data-pilot-tabs-empty] [data-conversation-content], html[data-pilot-tabs-empty] .pilot-home { visibility: hidden; }
`
