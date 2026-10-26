/**
 * The chats column, the way the Muse desktop lays it out: a search field with
 * a small menu beside it, **Main chat** — the one long conversation with the
 * agent — and **Side chats** with a + for the things that do not belong in it.
 * Behind the names are the harness's sessions: the main chat is the session
 * this computer remembers as such (the oldest one until the person picks
 * another), and side chats include blank and archived top-level sessions.
 * Archived titles stay muted and their menu explicitly restores them;
 * opening a row never changes its archive state. Subagent sessions stay
 * inside their parents. Running and waiting marks use the Host status.
 *
 * Signed in, the chats are the account's (C8, one thread): the main chat is the
 * session the account's main conversation lives in, a conversation from another
 * device is a chat here from the moment it is pulled, and nothing in the column
 * says where a chat was written — the bubbles do (`RemoteBubbles.ts`).
 */
import { createElement as h, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { call, type Translate } from './api.ts'
import { IconMore, IconPlus, IconSearch, IconFolder } from './icons.tsx'
import { LIST_MENU_STYLES, NewSessionIcon, ProjectActions, SortIcon, SortMenu, useNavigationPreferences } from './PilotListMenus.tsx'
import { sortSessions } from './pilot-list-preferences.ts'
import { resolveMainSessionId, sessionRowLabel } from './pilot-session-label.ts'
import { roomsCall } from './rooms.ts'
import { composing } from './keys.ts'
import { useLive } from './live.ts'
import { PROJECTS_KEY, projectSessions, readProjectIds, type PilotWorkspace } from './pilot-projects.ts'
import { useRooms } from './rooms.ts'
import { win } from './win.ts'

const MAIN_KEY = 'nanomuse.mainChat'

/**
 * Conversation sync as the chats column needs it (contract C8, one thread): the session the
 * account's main conversation lives in, the sessions that hold a synced conversation (listed
 * though no turn ran here yet), and the sessions whose conversation was deleted on another
 * device, which the column archives (the host has no archive) and reports back.
 */
interface SyncList {
  enabled: boolean
  mainSession: string
  sessions: Set<string>
  /** Sessions of another account than the one signed in (C10): not listed, not searched; empty when signed out. */
  foreign: Set<string>
  toArchive: string[]
}
const NO_SYNC: SyncList = { enabled: true, mainSession: '', sessions: new Set(), foreign: new Set(), toArchive: [] }

/** The host's sync view; read again whenever the host's sync revision moves. */
export function useSyncList(): SyncList {
  const rev = useLive().sync?.rev ?? 0
  const [list, setList] = useState<SyncList>(NO_SYNC)
  useEffect(() => {
    let alive = true
    call<{ enabled: boolean; mainSession?: string; sessions?: string[]; foreign?: string[]; toArchive?: string[] }>('sync/state')
      .then((v) => { if (alive) setList({ enabled: v.enabled, mainSession: v.mainSession ?? '', sessions: new Set(v.sessions ?? []), foreign: new Set(v.foreign ?? []), toArchive: v.toArchive ?? [] }) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [rev])
  return list
}

export interface ChatSummary {
  id: string
  displayTitle: string
  parentId?: string | undefined
  origin?: 'subagent' | undefined
  running: boolean
  retainedBy: { mainView?: number | undefined }
  blank: boolean
  updatedAt: number
}
export interface ChatListState {
  ids: string[]
  byId: Record<string, ChatSummary>
  phase: string
}
export interface ChatStatus {
  running?: boolean | undefined
  pendingInteraction?: unknown
  completionUnread?: boolean | undefined
}
export type UseSessionList = <S>(selector: (state: ChatListState) => S) => S
export type UseStatusMap = <S>(selector: (snapshot: ReadonlyMap<string, ChatStatus>) => S) => S
export type UseWorkspaceList = <S>(selector: (snapshot: { items: readonly PilotWorkspace[]; archivedSessionIds: readonly string[]; pinnedSessionIds: readonly string[] }) => S) => S

export interface ChatActions {
  openSession(id: string): void
  startSession(): void
  archiveSession(id: string): Promise<void>
  pinSession(id: string): Promise<void>
  unpinSession(id: string): Promise<void>
  renameSession(id: string, title: string): Promise<void>
  openArchived(): void
  openProject?(): Promise<string | undefined>
  startProjectSession?(workspaceId: string): Promise<void>
  renameProject?(workspaceId: string, title: string): Promise<void>
  deleteProject?(workspaceId: string): Promise<void>
  openProjectFolder?(path: string): Promise<void>
  restoreSession?(id: string): Promise<void>
}

export interface MuseChatsProps {
  t: Translate
  useSessions: UseSessionList
  useSessionStatus?: UseStatusMap | undefined
  useWorkspaces?: UseWorkspaceList | undefined
  actions: ChatActions
  /** The search field is focused from outside (the rail's Search). */
  searchRef?: ((el: HTMLInputElement | null) => void) | undefined
}

function readMain(): string | undefined {
  try {
    return window.localStorage.getItem(MAIN_KEY) ?? undefined
  } catch {
    return undefined
  }
}
/** The session this computer treats as the main chat, if it has picked one. */
export function mainChatId(): string | undefined {
  return readMain()
}
const mainListeners = new Set<() => void>()
/** The first run names the main chat before the list has seen it; the list is told. */
export function setMainChatId(id: string): void {
  writeMain(id)
  for (const listener of mainListeners) listener()
}
function writeMain(id: string | undefined): void {
  try {
    if (id) window.localStorage.setItem(MAIN_KEY, id)
    else window.localStorage.removeItem(MAIN_KEY)
  } catch {
    // private mode: the oldest session stays the main chat
  }
}

interface MenuItem { id: string; label: string; onSelect(): void }

/** The row's small menu, anchored under its button. */
function RowMenu({ anchor, items, onClose }: { anchor: HTMLElement; items: MenuItem[]; onClose(): void }): ReactNode {
  const menu = useRef<HTMLDivElement>(null)
  const rect = anchor.getBoundingClientRect()
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (menu.current?.contains(target) || anchor.contains(target)) return
      onClose()
    }
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchor, onClose])
  useEffect(() => { menu.current?.querySelector('button')?.focus() }, [])
  const below = rect.bottom + 180 < window.innerHeight
  const style = below ? { left: rect.left, top: rect.bottom + 4 } : { left: rect.left, bottom: window.innerHeight - rect.top + 4 }
  return h('div', { ref: menu, className: 'nm-menu', role: 'menu', style },
    items.map((item) => h('button', { key: item.id, type: 'button', role: 'menuitem', className: 'nm-menu-item', onClick: () => { onClose(); item.onSelect() } },
      h('span', { className: 'nm-menu-item-label' }, item.label))))
}

interface RowProps {
  t: Translate
  chat: ChatSummary
  label: string
  main: boolean
  archived?: boolean
  pinned: boolean
  selected: boolean
  useSessionStatus: UseStatusMap | undefined
  actions: ChatActions
}

function ChatRow({ t, chat, label, main, archived = false, pinned, selected, useSessionStatus, actions }: RowProps): ReactNode {
  const status = typeof useSessionStatus === 'function' ? useSessionStatus((map) => map.get(chat.id)) : undefined
  const running = status?.running ?? chat.running
  const waiting = status?.pendingInteraction !== undefined
  const unread = status?.completionUnread === true
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label)
  const more = useRef<HTMLButtonElement | null>(null)

  // One outcome per edit: Enter commits (the blur that follows must not commit again), Escape
  // discards (the blur that follows must not commit at all); an IME's Enter picks a candidate.
  const settled = useRef(false)
  const begin = () => { if (main) return; settled.current = false; setDraft(chat.displayTitle || label); setEditing(true) }
  const commit = () => {
    if (settled.current) return
    settled.current = true
    const title = draft.trim()
    setEditing(false)
    if (!main && title && title !== label) void actions.renameSession(chat.id, title).catch(() => undefined)
  }
  const cancel = () => {
    settled.current = true
    setEditing(false)
  }
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !composing(event)) { event.preventDefault(); commit() }
    if (event.key === 'Escape') { event.preventDefault(); cancel() }
  }
  // Archived rows stay in the list in a muted state; their menu restores them instead of archiving again.
  const items: MenuItem[] = [
    ...(main ? (['identity', 'soul', 'memory'] as const).map(doc => ({ id: doc, label: `${doc.toUpperCase()}.md`, onSelect: () => { win.openDoc({ kind: 'own', doc }); win.touchRecent(`own:${doc}`, `${doc.toUpperCase()}.md`) } })) : []),
    ...(main || archived ? [] : [{ id: 'pin', label: pinned ? t('chUnpin') : t('chPin'), onSelect: () => { void (pinned ? actions.unpinSession(chat.id) : actions.pinSession(chat.id)).catch(() => undefined) } }]),
    ...(main ? [] : [{ id: 'rename', label: t('chRename'), onSelect: begin }]),
    ...(archived
      ? [{ id: 'restore', label: t('chRestore'), onSelect: () => { void actions.restoreSession?.(chat.id).catch(() => undefined) } }]
      : (main ? [] : [{ id: 'archive', label: t('chArchive'), onSelect: () => { void actions.archiveSession(chat.id).catch(() => undefined) } }])),
  ]
  return h('div', { className: `nm-chat-row${selected ? ' nm-selected' : ''}${main ? ' nm-main' : ''}${archived ? ' nm-archived' : ''}`, 'data-session-id': chat.id },
    editing
      ? h('input', { className: 'nm-chat-edit', value: draft, autoFocus: true, 'aria-label': t('chRename'), onChange: (e: FormEvent<HTMLInputElement>) => setDraft(e.currentTarget.value), onBlur: commit, onKeyDown: onKey })
      : h('button', { type: 'button', className: 'nm-chat-open', 'aria-current': selected ? 'page' : undefined, onClick: () => actions.openSession(chat.id), onDoubleClick: begin },
          h('span', { className: 'nm-chat-title' }, label),
          waiting
            ? h('span', { className: 'nm-chat-mark nm-wait', title: t('chWaiting'), 'aria-label': t('chWaiting') }, 'ℹ')
            : running
              ? h('span', { className: 'nm-chat-dot nm-live', title: t('chRunning'), 'aria-label': t('chRunning') })
              : unread ? h('span', { className: 'nm-chat-dot', 'aria-hidden': true }) : null),
    editing || items.length === 0 ? null : h('button', { type: 'button', className: 'nm-chat-more', 'aria-label': t('chMore'), 'aria-haspopup': 'menu', 'aria-expanded': menuAnchor !== null, ref: (el: HTMLButtonElement | null): void => { more.current = el }, onClick: () => setMenuAnchor((current) => (current ? null : more.current)) }, h(IconMore, { size: 16 })),
    menuAnchor ? h(RowMenu, { anchor: menuAnchor, items, onClose: () => setMenuAnchor(null) }) : null)
}

export function MuseChats({ t, useSessions, useSessionStatus, useWorkspaces, actions, searchRef }: MuseChatsProps): ReactNode {
  const state = useSessions((s) => s)
  const archived = typeof useWorkspaces === 'function' ? useWorkspaces((w) => w.archivedSessionIds) : []
  const pinned = typeof useWorkspaces === 'function' ? useWorkspaces((w) => w.pinnedSessionIds) : []
  const workspaceItems = typeof useWorkspaces === 'function' ? useWorkspaces((w) => w.items) : []
  const [projectIds, setProjectIds] = useState<string[]>(() => readProjectIds(window.localStorage))
  const [folded, setFolded] = useState<Set<string>>(() => new Set())
  const [projectError, setProjectError] = useState('')
  const [projectBusy, setProjectBusy] = useState(false)
  const [preferences, updatePreferences] = useNavigationPreferences()
  const [createdAt, setCreatedAt] = useState<Record<string, number>>({})
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null)
  const projectPreferences = new Set(preferences.pinnedProjects)
  const archivedProjectIds = new Set(preferences.archivedProjects)
  const projects = workspaceItems.filter((item) => projectIds.includes(item.workspaceId) && (preferences.showArchived || !archivedProjectIds.has(item.workspaceId))).sort((a,b) => {
    const pinned = Number(projectPreferences.has(b.workspaceId)) - Number(projectPreferences.has(a.workspaceId))
    if (pinned) return pinned
    if (preferences.sort === 'name') return a.title.localeCompare(b.title, undefined, {numeric:true})
    if (preferences.sort === 'oldest' || preferences.sort === 'created') {
      const delta = Date.parse(a.createdAt ?? '')-Date.parse(b.createdAt ?? '')
      return Number.isFinite(delta) ? preferences.sort==='oldest'?delta:-delta : 0
    }
    const updated=(p:PilotWorkspace)=>Math.max(Date.parse(p.updatedAt ?? '')||0,...p.sessionIds.map(id=>state.byId[id]?.updatedAt??0))
    return updated(b)-updated(a)
  })
  useEffect(() => {
    if (preferences.sort !== 'oldest' && preferences.sort !== 'created') return
    let alive = true
    const missing=state.ids.filter(id=>createdAt[id]===undefined)
    if (!missing.length) return
    void (async()=>{for(let i=0;i<missing.length;i+=100){const next=await roomsCall<{createdAt:Record<string,number>}>('pilot/session-dates',{sessionIds:missing.slice(i,i+100)});if(alive)setCreatedAt(before=>({...before,...next.createdAt}))}})().catch(error=>{if(alive)setProjectError(String(error))})
    return ()=>{alive=false}
  },[preferences.sort,state.ids])
  const projectSessionIds = projectSessions(workspaceItems, projectIds)
  const openProject = async () => {
    setProjectBusy(true)
    setProjectError('')
    try {
      const id = await actions.openProject?.()
      if (id) setProjectIds((before) => {
        const next = [...new Set([...before, id])]
        try { window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(next)) } catch { /* navigation preference only */ }
        return next
      })
    } catch (error) { setProjectError(String(error)) }
    finally { setProjectBusy(false) }
  }
  const [query, setQuery] = useState('')
  const [mainStored, setMainStored] = useState<string | undefined>(readMain)
  useEffect(() => {
    const listener = () => setMainStored(readMain())
    mainListeners.add(listener)
    return () => { mainListeners.delete(listener) }
  }, [])

  const archivedSet = new Set(archived)
  const pinnedSet = new Set(pinned)
  const sync = useSyncList()
  // the rooms' running batches (the feed being written) are the agent's work, not chats of the person's
  const batches = new Set(useRooms().batches)
  // signed in, the column shows this account's chats and the ones never synced (C10); another account's stay, hidden
  const visible = state.ids
    .map((id) => state.byId[id])
    .filter((s): s is ChatSummary => s !== undefined && s.origin !== 'subagent' && !s.parentId && !sync.foreign.has(s.id) && !batches.has(s.id))
  const regular = visible.filter((s) => !projectSessionIds.has(s.id))
  const mainCandidates = regular.filter(s=>!archivedSet.has(s.id))
  const current = Object.values(state.byId).find((s) => (s.retainedBy.mainView ?? 0) > 0)?.id

  // The main chat: the one the account's main conversation lives in (C8) while it exists, else
  // the remembered one, else the oldest, else the one on screen (a first session being created
  // becomes the main chat).
  const mainId = resolveMainSessionId(mainCandidates, sync.mainSession, mainStored, current, sync.sessions)
  useEffect(() => {
    if (state.phase !== 'ready') return
    if (mainId !== mainStored) { writeMain(mainId); setMainStored(mainId) }
  }, [mainId, mainStored, state.phase])
  // The host syncs the main chat as the account's one main conversation (C7, C8): it is told
  // which session that is, and answers with the one the conversation already lives in.
  useEffect(() => {
    if (state.phase !== 'ready' || !mainId) return
    void call<{ sessionId?: string } | undefined>('sync/main', { sessionId: mainId })
      .then((r) => { if (r?.sessionId && r.sessionId !== mainId && !projectSessionIds.has(r.sessionId)) { writeMain(r.sessionId); setMainStored(r.sessionId) } })
      .catch(() => undefined)
  }, [mainId, state.phase])
  // A chat deleted on another device goes to the archive here, and the host is told.
  const archiving = useRef(new Set<string>())
  useEffect(() => {
    const due = sync.toArchive.filter((id) => !archiving.current.has(id))
    if (due.length === 0) return
    for (const id of due) archiving.current.add(id)
    void Promise.all(due.map((id) => (archivedSet.has(id) || !state.byId[id] ? Promise.resolve() : actions.archiveSession(id).catch(() => undefined))))
      .then(() => call('sync/archived', { sessionIds: due }))
      .catch(() => undefined)
      .finally(() => { for (const id of due) archiving.current.delete(id) })
  }, [sync.toArchive])

  const main = visible.find((s) => s.id === mainId)
  const q = query.trim().toLowerCase()
  // Every ordinary session remains listed, including earlier blank sessions and archived rows.
  const side = sortSessions(regular
    .filter((s) => s.id !== mainId)
    .filter((s) => q === '' || s.displayTitle.toLowerCase().includes(q)), preferences.sort, createdAt, pinnedSet)
  const mainMatches = q === '' || t('chMain').toLowerCase().includes(q) || (main?.displayTitle.toLowerCase().includes(q) ?? false)

  const openMain = () => {
    if (main) actions.openSession(main.id)
    else actions.startSession()
  }

  return h('div', { className: 'nm-chats' },
    h('style',null,LIST_MENU_STYLES),
    h('div', { className: 'nm-chats-list' },
      mainMatches
        ? (main
            ? h(ChatRow, { t, chat: main, label: t('chMain'), main: true, pinned: false, selected: current === main.id, useSessionStatus, actions })
            : h('div', { className: 'nm-chat-row nm-main' },
                h('button', { type: 'button', className: 'nm-chat-open', onClick: openMain }, h('span', { className: 'nm-chat-title' }, t('chMain')))))
        : null,
      h('div', { className: 'nm-chats-section pilot-session-section' },
        h('span', null, t('chSide')),
        h('div',{className:'pilot-hover-actions'},
          h('button',{type:'button',className:'nm-icon-btn nm-icon-btn-sm','aria-label':t('pilotSortTitle'),title:t('pilotSortTitle'),'aria-haspopup':'menu','aria-expanded':!!sortAnchor,onClick:(e:React.MouseEvent<HTMLButtonElement>)=>setSortAnchor(sortAnchor?null:e.currentTarget)},h(SortIcon)),
          h('button', { type: 'button', className: 'nm-icon-btn nm-icon-btn-sm', 'aria-label': t('chNewSide'), title: t('chNewSide'), onClick: actions.startSession }, h(NewSessionIcon)))),
      sortAnchor?h(SortMenu,{t,anchor:sortAnchor,value:preferences,update:updatePreferences,close:()=>setSortAnchor(null)}):null,
      side.length === 0
        ? h('div', { className: 'nm-chats-empty' }, q === '' ? t('chEmpty') : t('chNoMatch'))
        : side.map((chat) => h(ChatRow, {
            key: chat.id,
            t,
            chat,
            label: sessionRowLabel(chat, { main: false, synced: sync.sessions.has(chat.id), mainLabel: t('chMain'), blankLabel: t('chBlank') }),
            main: false,
            archived: archivedSet.has(chat.id),
            pinned: pinnedSet.has(chat.id),
            selected: current === chat.id,
            useSessionStatus,
            actions,
          })),
      h('div', { className: 'nm-chats-section' },
        h('span', null, t('pilotProjects')),
        h('div',{className:'pilot-hover-actions'},actions.openProject ? h('button', { type: 'button', className: 'nm-icon-btn nm-icon-btn-sm', disabled: projectBusy, 'aria-label': t('pilotOpenProject'), title: t('pilotOpenProject'), onClick: () => { void openProject() } }, h(IconPlus, { size: 16 })) : null)),
      projectError ? h('div', { className: 'pilot-project-error', role: 'alert' }, projectError) : null,
      projects.length === 0 ? h('div', { className: 'nm-chats-empty pilot-projects-empty' }, t('pilotProjectsEmpty')) : null,
      projects.map((project) => h('div', { key: project.workspaceId, 'data-project-id':project.workspaceId,className:archivedProjectIds.has(project.workspaceId)?'pilot-archived-project':undefined },
        h('div', { className: 'pilot-project-toggle' },
          h('button', { type: 'button', className: 'pilot-project-toggle', title: project.path, 'aria-expanded': !folded.has(project.workspaceId), onClick: () => setFolded((before) => { const next = new Set(before); if (next.has(project.workspaceId)) next.delete(project.workspaceId); else next.add(project.workspaceId); return next }) }, h('span', { 'aria-hidden': true }, folded.has(project.workspaceId) ? '▸' : '▾'),h(IconFolder,{size:14}), h('span', {className:'pilot-project-name'}, project.title || project.path.split(/[\\/]/).pop()),projectPreferences.has(project.workspaceId)?h('i',{className:'pilot-project-pin-mark','aria-label':t('pilotProjectPin')}):null),
          h(ProjectActions,{t,project,pinned:projectPreferences.has(project.workspaceId),archived:archivedProjectIds.has(project.workspaceId),busy:projectBusy,
            rename:async(title)=>{if(!actions.renameProject)throw new Error('Workspace service unavailable');await actions.renameProject(project.workspaceId,title)},
            remove:async()=>{if(!actions.deleteProject)throw new Error('Workspace service unavailable');await actions.deleteProject(project.workspaceId);setProjectIds(before=>{const next=before.filter(id=>id!==project.workspaceId);try{localStorage.setItem(PROJECTS_KEY,JSON.stringify(next))}catch{}return next});updatePreferences(before=>({...before,pinnedProjects:before.pinnedProjects.filter(id=>id!==project.workspaceId),archivedProjects:before.archivedProjects.filter(id=>id!==project.workspaceId)}))},
            openFolder:async()=>{if(!actions.openProjectFolder)throw new Error('Desktop folder capability unavailable');await actions.openProjectFolder(project.path)},
            pin:()=>updatePreferences(before=>({...before,pinnedProjects:before.pinnedProjects.includes(project.workspaceId)?before.pinnedProjects.filter(id=>id!==project.workspaceId):[project.workspaceId,...before.pinnedProjects]})),
            archive:()=>updatePreferences(before=>({...before,archivedProjects:before.archivedProjects.includes(project.workspaceId)?before.archivedProjects.filter(id=>id!==project.workspaceId):[...before.archivedProjects,project.workspaceId]})),
            ...(actions.startProjectSession?{newSession:()=>actions.startProjectSession!(project.workspaceId)}:{}),
          })),
        !folded.has(project.workspaceId) ? h('div', { className: 'pilot-project-sessions' },
          sortSessions(visible.filter((chat) => project.sessionIds.includes(chat.id) && (q === '' || chat.displayTitle.toLowerCase().includes(q))),preferences.sort,createdAt,pinnedSet).map((chat) => h(ChatRow, { key: chat.id, t, chat, label: sessionRowLabel(chat, { main: false, synced: true, mainLabel: t('chMain'), blankLabel: t('chBlank') }), main: false, archived: archivedSet.has(chat.id), pinned: pinnedSet.has(chat.id), selected: current === chat.id, useSessionStatus, actions }))) : null))))
}
