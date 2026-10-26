/**
 * Pilot's two-column sidebar over nanoMuse/DSH services.
 * Keeps the upstream child slots, settings, session actions and task status.
 * Pilot adaptation: chat/search rail and a bottom-corner menu; no Muse rooms or avatar.
 */
import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Translate } from './api.ts'
import { openLink } from './bridge.ts'
import { IconCalendar, IconChat, IconMenu, IconPanelLeft, IconPlus, IconPuzzle, IconSearch, IconBug, IconSettings } from './icons.tsx'
import { pressSettingsChord } from './keys.ts'
import { MuseChats, type ChatActions, type UseSessionList, type UseStatusMap, type UseWorkspaceList } from './MuseChats.tsx'
import { PILOT_STYLES, PilotMark } from './PilotBrand.tsx'
import { useSidebarDragCollapse } from './useSidebarDragCollapse.ts'
import { NewSessionIcon } from './PilotListMenus.tsx'

const SCHEDULES_PANEL = 'schedules'
const PLUGINS_PANEL = 'plugins'
const COLLAPSE_SETTLE_MS = 150
const RAIL = 52

export interface PanelMeta { id: string; order: number; label: string }
export type RenderSlot = (name: string, props: Record<string, unknown>, options?: { only?: string; fallback?: ReactNode }) => ReactNode
export interface MuseSidebarProps {
  collapsed: boolean
  width: number
  t: Translate
  renderSlot: RenderSlot
  startSession(): void
  toggleSidebar(): void
  selectPanel(id: string | null): void
  openSettings?: (() => boolean) | undefined
  openProfile(): void
  openSearch?: (() => void) | undefined
  openSection?: ((id: string) => void) | undefined
  issuesUrl: string
  chatActions: ChatActions
  usePanels<S>(selector: (panels: readonly PanelMeta[]) => S): S
  usePanelInfo<S>(selector: (info: { activePanelId: string | null }) => S): S
  useShortcuts<S>(selector: (rows: readonly { id: string; keys: readonly string[]; aria?: string }[]) => S): S
  useSessions?: UseSessionList | undefined
  useSessionStatus?: UseStatusMap | undefined
  useWorkspaces?: UseWorkspaceList | undefined
}
interface RailButtonProps {
  label: string
  active?: boolean | undefined
  expanded?: boolean | undefined
  dot?: boolean | undefined
  onClick(): void
  children?: ReactNode
  buttonRef?: ((el: HTMLButtonElement | null) => void) | undefined
}
function RailButton({ label, active, expanded, dot, onClick, children, buttonRef }: RailButtonProps): ReactNode {
  return h('button', { type: 'button', className: 'nm-rail-btn', title: label, 'aria-label': label, 'aria-current': active ? 'page' : undefined, 'aria-expanded': expanded, onClick, ref: buttonRef },
    children, dot ? h('span', { className: 'nm-rail-dot', 'aria-hidden': true }) : null)
}
interface MenuItem { id: string; label: string; icon: ReactNode; hint?: string | undefined; onSelect(): void }
function CornerMenu({ anchor, items, onClose }: { anchor: HTMLElement; items: (MenuItem | 'sep')[]; onClose(): void }): ReactNode {
  const menu = useRef<HTMLDivElement>(null)
  const rect = anchor.getBoundingClientRect()
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!menu.current?.contains(target) && !anchor.contains(target)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      if (!buttons.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
      buttons[next]?.focus()
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey)
    menu.current?.querySelector('button')?.focus()
    return () => { document.removeEventListener('pointerdown', onPointer, true); document.removeEventListener('keydown', onKey); anchor.focus() }
  }, [anchor, onClose])
  return h('div', { ref: menu, className: 'nm-menu', role: 'menu', style: { left: rect.right + 6, bottom: Math.max(8, window.innerHeight - rect.bottom) } },
    items.map((item, index) => item === 'sep'
      ? h('div', { key: `sep-${index}`, className: 'nm-menu-sep', role: 'separator' })
      : h('button', { key: item.id, type: 'button', role: 'menuitem', className: 'nm-menu-item', onClick: () => { onClose(); item.onSelect() } },
          item.icon, h('span', { className: 'nm-menu-item-label' }, item.label), item.hint ? h('span', { className: 'nm-menu-hint' }, item.hint) : null)))
}

export function MuseSidebar(props: MuseSidebarProps): ReactNode {
  const { collapsed, t, renderSlot, startSession, toggleSidebar, selectPanel, openSettings: openSettingsHook, openSearch, issuesUrl, chatActions, usePanels, usePanelInfo, useShortcuts, useSessions, useSessionStatus, useWorkspaces } = props
  useSidebarDragCollapse(collapsed, toggleSidebar)
  const panels = usePanels((rows) => rows)
  const active = usePanelInfo((info) => info.activePanelId)
  useEffect(() => {
    if (active !== null) document.documentElement.dataset['nmRoom'] = ''
    else delete document.documentElement.dataset['nmRoom']
    return () => { delete document.documentElement.dataset['nmRoom'] }
  }, [active])
  const settingsShortcut = useShortcuts((rows) => rows.find((row) => row.id === 'settings.open'))
  const searchShortcut = useShortcuts((rows) => rows.find((row) => row.id === 'session.search'))
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const menuButton = useRef<HTMLButtonElement | null>(null)
  const column = useRef<HTMLDivElement>(null)
  const searchField = useRef<HTMLInputElement | null>(null)
  const settingsSeat = useRef<HTMLDivElement>(null)
  const [settled, setSettled] = useState(collapsed)
  useEffect(() => {
    if (!collapsed) { setSettled(false); return undefined }
    const timer = window.setTimeout(() => setSettled(true), COLLAPSE_SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [collapsed])
  const wide = !collapsed || !settled
  const width = props.width
  const lastWideWidth = useRef(width)
  if (!collapsed) lastWideWidth.current = width
  useEffect(() => {
    document.documentElement.style.setProperty('--pilot-sidebar-width', `${wide ? (collapsed ? lastWideWidth.current : width) : RAIL}px`)
    return () => { document.documentElement.style.removeProperty('--pilot-sidebar-width') }
  }, [wide, collapsed, width])
  const schedules = panels.find((p) => p.id === SCHEDULES_PANEL)
  const plugins = panels.find((p) => p.id === PLUGINS_PANEL)
  const openSettings = () => {
    if (openSettingsHook?.()) return
    const trigger = settingsSeat.current?.querySelector<HTMLButtonElement>('button')
    if (trigger) { trigger.click(); return }
    pressSettingsChord()
  }
  const search = () => {
    if (openSearch) { openSearch(); return }
    selectPanel(null)
    if (collapsed) toggleSidebar()
    window.setTimeout(() => { (searchField.current ?? column.current?.querySelector<HTMLInputElement>('input'))?.focus() }, collapsed ? 200 : 0)
  }
  const items: (MenuItem | 'sep')[] = [
    { id: 'settings', label: t('menuSettings'), icon: h(IconSettings, { size: 16 }), hint: keysHint(settingsShortcut?.keys), onSelect: openSettings },
    'sep',
    ...(schedules ? [{ id: 'schedules', label: schedules.label, icon: h(IconCalendar, { size: 16 }), onSelect: () => selectPanel(SCHEDULES_PANEL) }] : []),
    ...(plugins ? [{ id: 'plugins', label: plugins.label, icon: h(IconPuzzle, { size: 16 }), onSelect: () => selectPanel(PLUGINS_PANEL) }] : []),
    { id: 'toggle', label: collapsed ? t('menuExpand') : t('menuCollapse'), icon: h(IconPanelLeft, { size: 16 }), onSelect: toggleSidebar },
  ]
  const busy = typeof useSessions === 'function' ? useSessions((state) => state.ids.some((id) => state.byId[id]?.running === true)) : false
  return h('div', { className: 'nm-sidebar pilot-sidebar', style: { width: wide ? (collapsed ? lastWideWidth.current : width) : RAIL } },
    h('style', null, PILOT_STYLES),
    h('nav', { className: 'nm-rail', 'aria-label': t('railLabel') },
      h('div', { className: 'nm-rail-top', 'data-window-drag': true }),
      h('div', { className: 'pilot-rail-brand', title: 'Pilot' }, h(PilotMark, { size: 29 })),
      // Preserve the upstream brand seat's preference/accent effects without showing its avatar.
      h('div', { className: 'nm-hidden' }, renderSlot('sidebar.brand.mark', { size: 24 })),
      h(RailButton, { label: t('railChats'), active: active === null, dot: busy, onClick: () => selectPanel(null) }, h(IconChat, { size: 20 })),
      h(RailButton, { label: withKeys(t('railSearch'), searchShortcut?.keys), onClick: search }, h(IconSearch, { size: 20 })),
      h('div', { className: 'nm-rail-spacer' }),
      collapsed ? h(RailButton, { label: t('menuExpand'), onClick: toggleSidebar }, h(IconPanelLeft, { size: 20 })) : null,
      collapsed ? h(RailButton, { label: t('railNew'), onClick: startSession }, h(NewSessionIcon, { size: 18 })) : null,
      h(RailButton, { label: t('railMore'), expanded: menuAnchor !== null, onClick: () => setMenuAnchor((current) => current ? null : menuButton.current), buttonRef: (el) => { menuButton.current = el } }, h(IconMenu, { size: 20 })),
      h('div', { ref: settingsSeat, className: 'nm-hidden' }, renderSlot('sidebar.settings', { wide: false })),
      h('div', { className: 'nm-hidden' }, renderSlot('sidebar.toggle.badge', {}))),
    wide ? h('div', { ref: column, className: `nm-col${collapsed ? ' nm-fading' : ''}`, style: { width: (collapsed ? lastWideWidth.current : width) - RAIL } },
      h('div', { className: 'pilot-column-brand' }, h('span', null, 'Pilot'), h('span', null, 'WORKSPACE')),
      h('div', { className: 'nm-col-body' },
        typeof useSessions === 'function'
          ? h(MuseChats, { t, useSessions, useSessionStatus, useWorkspaces, actions: chatActions, searchRef: (el) => { searchField.current = el } })
          : renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => { if (collapsed) toggleSidebar() } }))) : null,
    menuAnchor ? h(CornerMenu, { anchor: menuAnchor, items, onClose: () => setMenuAnchor(null) }) : null)
}
function keysHint(keys: readonly string[] | undefined): string | undefined { return keys?.length ? keys.join(' ') : undefined }
function withKeys(label: string, keys: readonly string[] | undefined): string { const hint = keysHint(keys); return hint ? `${label} ${hint}` : label }
