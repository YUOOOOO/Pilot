// 「会话 / 项目」菜单列（带行内悬停操作）：
//   会话段 = 默认工作区（默认文件夹）下的会话；项目段 = 每个工作区 + 其会话，项目可展开收起。
//   两段都每页 5 条；标题行/项目行/会话行悬停出现 ＋ 与 ⋯。
//   ⋯ 两级：标题级 = 排序/分组/归档筛选（插件自维护，写 localStorage）；
//            会话级 = 置顶/重命名/分叉/归档/复制 ID。
import * as React from 'react';
import { readGroupchatGroups, type GroupchatGroup } from './core/host-api';

type Store<T> = { getSnapshot(): T; subscribe(listener: () => void): () => void };
export interface WorkspaceView { workspaceId: string; path: string; title: string; sessionIds: readonly string[]; createdAt?: string }
export interface SessionSummary { id: string; title?: string; displayTitle?: string; cwd?: string; blank?: boolean; updatedAt?: number; running?: boolean }
interface WorkspaceSnapshot { items?: readonly WorkspaceView[]; archivedSessionIds?: readonly string[]; pinnedSessionIds?: readonly string[] }
interface SessionListState { ids?: readonly string[]; byId?: Record<string, SessionSummary> }
/** 宿主 ui-session 的会话状态：running / pendingInteraction / completionUnread */
export interface SessionStatusEntry { running?: boolean; pendingInteraction?: unknown; completionUnread?: boolean }
export type SessionStatusMap = ReadonlyMap<string, SessionStatusEntry>;

export interface WorkspaceApi {
  startSession(workspaceId?: string): void;
  openSession(sessionId: string): void;
  pickDirectory(): Promise<string | null>;
  createWorkspace(path: string): Promise<WorkspaceView | undefined>;
  /** 把工作区从列表里移除：宿主的语义是「只删登记」，磁盘目录与会话日志都保留 */
  deleteWorkspace?(workspaceId: string): Promise<unknown> | void;
  pinSession(sessionId: string, pinned: boolean): void;
  renameSession(sessionId: string, title: string): void;
  archiveSession(sessionId: string, archived: boolean): void;
  forkSession(sessionId: string): void;
  copySessionId(sessionId: string): void;
  workspaces: Store<WorkspaceSnapshot>;
  sessions: Store<SessionListState>;
  /** 会话状态（等待审批等）；宿主没提供时为空 Map */
  sessionStatus?: Store<SessionStatusMap>;
}

let api: WorkspaceApi | null = null;
export function bindWorkspaceApi(next: unknown): void { api = (next as WorkspaceApi | undefined) ?? null; }
export function workspaceApi(): WorkspaceApi | null { return api; }

// ── 当前会话（列表选中态）─────────────────────────────────────────────
const CURRENT_KEY = 'pilot:current-session';
let currentSessionId: string | null = readCurrentSession();
const currentListeners = new Set<() => void>();
function readCurrentSession(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try { return localStorage.getItem(CURRENT_KEY); } catch { return null; }
}
export function setCurrentSession(id: string | null): void {
  if (currentSessionId === id) return;
  currentSessionId = id;
  try {
    if (typeof localStorage !== 'undefined') {
      if (id) localStorage.setItem(CURRENT_KEY, id); else localStorage.removeItem(CURRENT_KEY);
    }
  } catch { /* ignore */ }
  for (const listener of currentListeners) listener();
}
function useCurrentSession(): string | null {
  return React.useSyncExternalStore(
    listener => { currentListeners.add(listener); return () => { currentListeners.delete(listener); }; },
    () => currentSessionId,
    () => currentSessionId,
  );
}

// ── 刚跑完的会话（running true → false）：显示绿色 ✓，打开后清除 ─────────
const completedIds = new Set<string>();
let completionVersion = 0;
const completionListeners = new Set<() => void>();
function emitCompletion(): void {
  completionVersion += 1;
  for (const listener of completionListeners) listener();
}
/** 对比上一次的 running 集合，找出「运行→停止」的会话。 */
function trackCompletion(byId: Record<string, SessionSummary> | undefined): void {
  const next = new Set<string>();
  for (const [id, summary] of Object.entries(byId ?? {})) if (summary.running) next.add(id);
  let changed = false;
  for (const id of runningIds) if (!next.has(id)) { completedIds.add(id); changed = true; }
  for (const id of next) if (completedIds.delete(id)) changed = true;
  runningIds.clear();
  for (const id of next) runningIds.add(id);
  if (changed) emitCompletion();
}
let runningIds = new Set<string>();
function markSeen(id: string): void {
  if (completedIds.delete(id)) emitCompletion();
}
function useCompletion(): number {
  return React.useSyncExternalStore(
    listener => { completionListeners.add(listener); return () => { completionListeners.delete(listener); }; },
    () => completionVersion,
    () => completionVersion,
  );
}

const PAGE = 5;
const DEFAULT_TITLE = '默认工作区';
const EMPTY_WORKSPACES: WorkspaceSnapshot = {};
const EMPTY_SESSIONS: SessionListState = {};
const EMPTY_STATUS: SessionStatusMap = new Map();

// ── 视图状态（Pilot 自己一份，不再和宿主浏览器共用）──────────────────────
// 以前读的是宿主的 `dsh.workspace.view.v5`：宿主为它自己的会话浏览器强行改成「平铺」，
// 我们的选择也会反过来写进宿主那份状态。现在菜单用独立 key。
// 注意：项目文件夹（workspace 分组）是必须保留的结构，不提供「隐藏项目」的开关。
export interface ViewState { orderBy: 'updated' | 'created'; groupBy: 'workspace' | 'flat'; archivedFilter: 'default' | 'show' | 'only' }
const VIEW_KEY = 'pilot:agent-view.v1';
const VIEW_DEFAULT: ViewState = { orderBy: 'updated', groupBy: 'workspace', archivedFilter: 'default' };

function loadView(): ViewState {
  if (typeof localStorage === 'undefined') return VIEW_DEFAULT;
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<ViewState>) : {};
    return {
      orderBy: parsed.orderBy === 'created' ? 'created' : 'updated',
      groupBy: parsed.groupBy === 'flat' ? 'flat' : 'workspace',
      archivedFilter: parsed.archivedFilter === 'show' || parsed.archivedFilter === 'only' ? parsed.archivedFilter : 'default',
    };
  } catch { return VIEW_DEFAULT; }
}
function saveView(view: ViewState): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* ignore */ }
}
function useView(): { view: ViewState; setView(next: ViewState): void } {
  const [view, setView] = React.useState<ViewState>(loadView);
  const update = React.useCallback((next: ViewState) => { setView(next); saveView(next); }, []);
  return { view, setView: update };
}

// ── 单个项目的视图覆盖：项目行的 ⋯ 只改这个项目，不动全局 ────────────────
// 以前项目行和「会话」标题行共用同一份 ViewState，所以在任意一个项目里改排序/归档，
// 所有项目和会话列表都跟着变 —— 这里给每个 workspace 单独存一份覆盖值。
const PROJECT_VIEW_PREFIX = 'pilot:workspace-view:';
function projectViewKey(workspaceId: string): string { return `${PROJECT_VIEW_PREFIX}${workspaceId}`; }
function loadProjectView(workspaceId: string): Partial<ViewState> | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(projectViewKey(workspaceId));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<ViewState>;
    return {
      ...(parsed.orderBy === 'created' || parsed.orderBy === 'updated' ? { orderBy: parsed.orderBy } : {}),
      ...(parsed.archivedFilter === 'show' || parsed.archivedFilter === 'only' || parsed.archivedFilter === 'default' ? { archivedFilter: parsed.archivedFilter } : {}),
    };
  } catch { return null; }
}
function saveProjectView(workspaceId: string, patch: Partial<ViewState>): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(projectViewKey(workspaceId), JSON.stringify(patch)); } catch { /* ignore */ }
}
/** 项目行用：项目自己的覆盖值优先，没设过就跟随全局默认。 */
function useProjectView(workspaceId: string, fallback: ViewState): { view: ViewState; setView(next: ViewState): void } {
  const [override, setOverride] = React.useState<Partial<ViewState> | null>(() => loadProjectView(workspaceId));
  const update = React.useCallback((next: ViewState) => {
    const patch: Partial<ViewState> = { orderBy: next.orderBy, archivedFilter: next.archivedFilter };
    setOverride(patch);
    saveProjectView(workspaceId, patch);
  }, [workspaceId]);
  return { view: { ...fallback, ...(override ?? {}) }, setView: update };
}
function useStore<T>(store: Store<T> | undefined, fallback: T): T {
  const subscribe = React.useCallback((listener: () => void) => store?.subscribe(listener) ?? (() => {}), [store]);
  const read = React.useCallback(() => (store ? store.getSnapshot() : fallback), [store, fallback]);
  return React.useSyncExternalStore(subscribe, read, read);
}

// ── 数据整理 ────────────────────────────────────────────────────────
function workspaceName(workspace: WorkspaceView): string {
  return (workspace.title ?? '').trim() || DEFAULT_TITLE;
}
/** 默认工作区 = 最早创建的那个（宿主初始化时建的默认文件夹）；新加项目创建时间更晚，不会被误认。 */
function defaultWorkspace(items: readonly WorkspaceView[]): WorkspaceView | undefined {
  if (items.length === 0) return undefined;
  return [...items].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))[0];
}
export function defaultWorkspaceId(): string | undefined {
  try { return defaultWorkspace(api?.workspaces.getSnapshot().items ?? [])?.workspaceId; } catch { return undefined; }
}
function sessionLabel(summary: SessionSummary | undefined): string {
  return (summary?.displayTitle ?? summary?.title ?? '').trim() || '未命名会话';
}
function orderedIds(workspace: WorkspaceView | undefined, sessions: SessionListState, archivedAll: readonly string[], view: ViewState): string[] {
  if (!workspace) return [];
  const byId = sessions.byId ?? {};
  const archivedSet = new Set(archivedAll);
  const ids = (workspace.sessionIds ?? []).filter(id => {
    const summary = byId[id];
    if (summary === undefined || summary.blank) return false;
    const archived = archivedSet.has(id);
    if (view.archivedFilter === 'default') return !archived;
    if (view.archivedFilter === 'only') return archived;
    return true;
  });
  if (view.orderBy === 'updated') ids.sort((a, b) => (byId[b]?.updatedAt ?? 0) - (byId[a]?.updatedAt ?? 0));
  return ids;
}

// ── 图标 ────────────────────────────────────────────────────────────
function Glyph({ kind }: { kind: 'plus' | 'more' | 'folder' | 'chevron' }) {
  if (kind === 'plus') return <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>;
  if (kind === 'more') return <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><circle cx="3.5" cy="8" r="1.25" /><circle cx="8" cy="8" r="1.25" /><circle cx="12.5" cy="8" r="1.25" /></svg>;
  if (kind === 'folder') return <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M2 4.5h4l1.2 1.5H14v6.5H2z" /><path d="M2 6h12" /></svg>;
  return <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m6 4 4 4-4 4" /></svg>;
}

/** 弹层定位：固定定位并夹在视口内（菜单列有滚动容器，absolute 会被裁剪）。 */
function popStyle(anchor: DOMRect): React.CSSProperties {
  const width = 210;
  const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
  const top = Math.min(anchor.bottom + 4, Math.max(8, window.innerHeight - 300));
  return { position: 'fixed', top: Math.max(8, top), left, right: 'auto' };
}

/** 菜单关闭：只在点菜单外部时关（原来的 onMouseLeave 太敏感，鼠标一抖菜单就消失）。 */
function useDismiss(onClose: () => void) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const onPointerDown = (event: Event) => {
      const target = event.target;
      if (ref.current && target instanceof Node && ref.current.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [onClose]);
  return ref;
}

// ── 标题级 ⋯：排序 / 归档筛选 ──────────────────────────────────────
// 会话标题行的菜单改的是全局默认值；项目行的菜单只改那一个项目（见 useProjectView）。
// 分组（项目文件夹）是固定结构，不再提供开关 —— 项目段始终显示，空项目也保留「暂无会话」占位。
// 项目行额外带「从列表移除」，确认后调宿主 workspaces.delete（只删登记，不动磁盘）。
function ViewMenu({ view, setView, anchor, onClose, onDelete }: {
  view: ViewState; setView(next: ViewState): void; anchor: DOMRect; onClose(): void; onDelete?(): void;
}) {
  const ref = useDismiss(onClose);
  const pick = (next: ViewState) => { setView(next); onClose(); };
  return (
    <div ref={ref} className="pilot-agent-pop" role="menu" style={popStyle(anchor)}>
      <div className="pilot-agent-pop-label">排序</div>
      <button type="button" role="menuitemradio" aria-checked={view.orderBy === 'updated'} className="pilot-agent-pop-item" onClick={() => pick({ ...view, orderBy: 'updated' })}>按更新时间</button>
      <button type="button" role="menuitemradio" aria-checked={view.orderBy === 'created'} className="pilot-agent-pop-item" onClick={() => pick({ ...view, orderBy: 'created' })}>按创建时间</button>
      <div className="pilot-agent-pop-label">归档</div>
      <button type="button" role="menuitemradio" aria-checked={view.archivedFilter === 'default'} className="pilot-agent-pop-item" onClick={() => pick({ ...view, archivedFilter: 'default' })}>隐藏归档</button>
      <button type="button" role="menuitemradio" aria-checked={view.archivedFilter === 'show'} className="pilot-agent-pop-item" onClick={() => pick({ ...view, archivedFilter: 'show' })}>显示归档</button>
      <button type="button" role="menuitemradio" aria-checked={view.archivedFilter === 'only'} className="pilot-agent-pop-item" onClick={() => pick({ ...view, archivedFilter: 'only' })}>只看归档</button>
      {onDelete === undefined ? null : (
        <>
          <div className="pilot-agent-pop-sep" aria-hidden="true" />
          <button type="button" role="menuitem" className="pilot-agent-pop-item pilot-agent-pop-danger" onClick={() => { onClose(); onDelete(); }}>从列表移除此项目…</button>
        </>
      )}
    </div>
  );
}

/** 通用确认弹窗（目前用于「从列表移除项目」）。 */
function ConfirmDialog({ title, text, confirmLabel, anchor, onCancel, onConfirm }: {
  title: string; text: string; confirmLabel: string; anchor: DOMRect; onCancel(): void; onConfirm(): void;
}) {
  const ref = useDismiss(onCancel);
  return (
    <div ref={ref} className="pilot-agent-dialog pilot-agent-dialog-wide" role="dialog" aria-label={title} style={popStyle(anchor)}>
      <div className="pilot-agent-dialog-title">{title}</div>
      <p className="pilot-agent-dialog-text">{text}</p>
      <div className="pilot-agent-dialog-actions">
        <button type="button" className="pilot-agent-dialog-cancel" onClick={onCancel}>取消</button>
        <button type="button" className="pilot-agent-dialog-ok" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  );
}

// ── 会话级 ⋯：置顶 / 重命名 / 分叉 / 归档 / 复制 ID ─────────────────
function SessionMenu({ id, pinned, archived, anchor, onRename, onClose }: { id: string; pinned: boolean; archived: boolean; anchor: DOMRect; onRename(): void; onClose(): void }) {
  const ref = useDismiss(onClose);
  const service = api;
  const run = (action: () => void) => { action(); onClose(); };
  return (
    <div ref={ref} className="pilot-agent-pop" role="menu" style={popStyle(anchor)}>
      <button type="button" role="menuitem" className="pilot-agent-pop-item" onClick={() => run(() => service?.pinSession(id, !pinned))}>{pinned ? '取消置顶' : '置顶'}</button>
      <button type="button" role="menuitem" className="pilot-agent-pop-item" onClick={() => { onClose(); onRename(); }}>重命名</button>
      <button type="button" role="menuitem" className="pilot-agent-pop-item" onClick={() => run(() => service?.archiveSession(id, !archived))}>{archived ? '取消归档' : '归档'}</button>
      <button type="button" role="menuitem" className="pilot-agent-pop-item" onClick={() => run(() => service?.forkSession(id))}>分叉会话</button>
      <button type="button" role="menuitem" className="pilot-agent-pop-item" onClick={() => run(() => service?.copySessionId(id))}>复制会话 ID</button>
    </div>
  );
}

/** 重命名弹窗：输入框 + 取消/确定，Enter 提交、Esc 取消。 */
function RenameDialog({ id, label, anchor, onDone }: { id: string; label: string; anchor: DOMRect; onDone(): void }) {
  const ref = useDismiss(onDone);
  const [value, setValue] = React.useState(label);
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  const submit = () => {
    const next = value.trim();
    if (next && next !== label) api?.renameSession(id, next);
    onDone();
  };
  return (
    <div ref={ref} className="pilot-agent-dialog" role="dialog" aria-label="重命名会话" style={popStyle(anchor)}>
      <input
        ref={inputRef}
        className="pilot-agent-dialog-input"
        value={value}
        onChange={event => setValue(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); submit(); }
          else if (event.key === 'Escape') { event.preventDefault(); onDone(); }
        }}
      />
      <div className="pilot-agent-dialog-actions">
        <button type="button" className="pilot-agent-dialog-cancel" onClick={onDone}>取消</button>
        <button type="button" className="pilot-agent-dialog-ok" onClick={submit}>确定</button>
      </div>
    </div>
  );
}

// ── 会话行 ──────────────────────────────────────────────────────────
function SessionRow({ id, label, pinned, archived, running, approval, onOpen }: { id: string; label: string; pinned: boolean; archived: boolean; running: boolean; approval?: boolean; onOpen(id: string): void }) {
  const [open, setOpen] = React.useState<DOMRect | null>(null);
  const [editing, setEditing] = React.useState<DOMRect | null>(null);
  return (
    <div className="pilot-agent-row-wrap" data-archived={archived || undefined}>
      <button type="button" className="pilot-agent-row" aria-current={id === currentSessionId ? 'page' : undefined} title={archived ? '已归档，不可打开' : approval === true ? `${label}（等待审批）` : label} onClick={() => { if (archived) return; onOpen(id); }}>
        {pinned ? <span className="pilot-agent-pin" aria-hidden="true" /> : null}
        {/* 有交互在等用户处理（审批就是其中一种）：沿用「运行中」那颗点，颜色转紫 */}
        {approval === true ? <span className="pilot-agent-running" data-approval="true" aria-hidden="true" title="等待审批" />
          : running ? <span className="pilot-agent-running" aria-hidden="true" title="运行中" /> : null}
        {completedIds.has(id) ? <span className="pilot-agent-done" aria-hidden="true" title="已完成">✓</span> : null}
        <span className="pilot-agent-row-label">{label}</span>
      </button>
      <div className="pilot-agent-row-actions">
        <button type="button" className="pilot-agent-icon" title="更多" aria-label="更多" aria-haspopup="menu" aria-expanded={open !== null} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setOpen(value => value ? null : rect); }}><Glyph kind="more" /></button>
      </div>
      {open ? <SessionMenu id={id} pinned={pinned} archived={archived} anchor={open} onRename={() => setEditing(open)} onClose={() => setOpen(null)} /> : null}
      {editing ? <RenameDialog id={id} label={label} anchor={editing} onDone={() => setEditing(null)} /> : null}
    </div>
  );
}

function SessionRows({ ids, sessions, pinnedSet, archivedSet, approvalSet, onOpen }: { ids: string[]; sessions: SessionListState; pinnedSet: Set<string>; archivedSet: Set<string>; approvalSet?: Set<string>; onOpen(id: string): void }) {
  const key = ids.join('\u0000');
  const [limit, setLimit] = React.useState(PAGE);
  React.useEffect(() => { setLimit(PAGE); }, [key]);
  if (ids.length === 0) return <div className="pilot-agent-empty">暂无会话</div>;
  return (
    <>
      {ids.slice(0, limit).map(id => (
        <SessionRow key={id} id={id} label={sessionLabel((sessions.byId ?? {})[id])} pinned={pinnedSet.has(id)} archived={archivedSet.has(id)} running={Boolean((sessions.byId ?? {})[id]?.running)} approval={approvalSet?.has(id) === true} onOpen={onOpen} />
      ))}
      {ids.length > limit ? (
        <button type="button" className="pilot-agent-more" onClick={() => setLimit(value => value + PAGE)}>更多会话（{ids.length - limit}）</button>
      ) : null}
    </>
  );
}

// ── 标题行（悬停操作）────────────────────────────────────────────────
function HeadingRow({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="pilot-agent-heading-row">
      <span className="pilot-agent-heading">{title}</span>
      <div className="pilot-agent-heading-actions">{action}</div>
    </div>
  );
}

// ── 项目行（可展开收起）──────────────────────────────────────────────
function ProjectRow({ workspace, sessions, defaultView, pinnedSet, archivedSet, approvalSet, onOpen, onNew }: {
  workspace: WorkspaceView; sessions: SessionListState; defaultView: ViewState;
  pinnedSet: Set<string>; archivedSet: Set<string>; approvalSet: Set<string>; onOpen(id: string): void; onNew(workspaceId: string): void;
}) {
  const [expanded, setExpanded] = React.useState(true);
  const [menu, setMenu] = React.useState<DOMRect | null>(null);
  const [removing, setRemoving] = React.useState<DOMRect | null>(null);
  // 每个项目自己一份视图（排序 / 归档），不跟「会话」标题行和其他项目互相影响。
  const { view, setView } = useProjectView(workspace.workspaceId, defaultView);
  const ids = orderedIds(workspace, sessions, [...archivedSet], view);
  // 宿主的 workspaces.delete 只删「工作区登记」：磁盘目录和会话日志都保留在磁盘上，
  // 这个项目从列表消失即止（不再单独做「未分组」这种兜底分组）。
  const remove = () => {
    setRemoving(null);
    try {
      const result = api?.deleteWorkspace?.(workspace.workspaceId);
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        void (result as Promise<unknown>).catch(() => { /* 宿主失败时会自己报错，保留列表原状 */ });
      }
    } catch { /* 同上 */ }
  };
  return (
    <div className="pilot-agent-project">
      <div className="pilot-agent-project-row">
        <button type="button" className="pilot-agent-project-title" title={workspace.path || workspaceName(workspace)} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
          <span className="pilot-agent-chevron" data-open={expanded || undefined}><Glyph kind="chevron" /></span>
          <span className="pilot-agent-project-name">{workspaceName(workspace)}</span>
        </button>
        <div className="pilot-agent-row-actions">
          <button type="button" className="pilot-agent-icon" title="新建会话" aria-label="新建会话" onClick={() => onNew(workspace.workspaceId)}><Glyph kind="plus" /></button>
          <button type="button" className="pilot-agent-icon" title="视图选项" aria-label="视图选项" aria-haspopup="menu" aria-expanded={menu !== null} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setMenu(value => value ? null : rect); }}><Glyph kind="more" /></button>
        </div>
      </div>
      {expanded ? <SessionRows ids={ids} sessions={sessions} pinnedSet={pinnedSet} archivedSet={archivedSet} approvalSet={approvalSet} onOpen={onOpen} /> : null}
      {menu ? <ViewMenu view={view} setView={setView} anchor={menu} onClose={() => setMenu(null)} onDelete={() => setRemoving(menu)} /> : null}
      {removing ? (
        <ConfirmDialog
          title="从列表移除项目"
          text={`将把“${workspaceName(workspace)}”从列表里移除。文件夹和会话记录都会保留在磁盘上，只是这个项目不再出现在列表里。`}
          confirmLabel="移除"
          anchor={removing}
          onCancel={() => setRemoving(null)}
          onConfirm={remove}
        />
      ) : null}
    </div>
  );
}

// ── 群聊行 ──────────────────────────────────────────────────────────
/** 群聊行的 ⋯ 菜单：管理 / 导出都走插件自己的管理抽屉（同一个弹窗，两个 tab）。 */
function GroupMenu({ anchor, onAction, onClose }: { anchor: DOMRect; onAction(action: 'manage' | 'export'): void; onClose(): void }) {
  const ref = useDismiss(onClose);
  const pick = (action: 'manage' | 'export') => { onAction(action); onClose(); };
  return (
    <div ref={ref} className="pilot-agent-pop" role="menu" style={popStyle(anchor)}>
      <button type="button" role="menuitem" className="pilot-agent-pop-item" onClick={() => pick('manage')}>管理群聊</button>
      <button type="button" role="menuitem" className="pilot-agent-pop-item" onClick={() => pick('export')}>导出聊天记录</button>
    </div>
  );
}

function GroupRow({ group, unread, selected, onOpen, onAction }: {
  group: GroupchatGroup; unread: boolean; selected: boolean;
  onOpen(group: GroupchatGroup): void;
  onAction(group: GroupchatGroup, action: 'manage' | 'export'): void;
}) {
  const [menu, setMenu] = React.useState<DOMRect | null>(null);
  return (
    <div className="pilot-agent-row-wrap">
      <button
        type="button"
        className="pilot-agent-row"
        aria-current={selected ? 'page' : undefined}
        title={group.brief || group.name}
        onClick={() => onOpen(group)}
      >
        {unread ? <span className="pilot-agent-unread" aria-label="有未读消息" title="有未读消息" /> : null}
        <span className="pilot-agent-row-label">{group.name}</span>
        <span className="pilot-agent-row-meta">{group.members} 人</span>
      </button>
      <div className="pilot-agent-row-actions">
        <button
          type="button"
          className="pilot-agent-icon"
          title="更多"
          aria-label="更多"
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setMenu(value => value ? null : rect); }}
        ><Glyph kind="more" /></button>
      </div>
      {menu ? <GroupMenu anchor={menu} onAction={action => onAction(group, action)} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

// ── 主组件 ──────────────────────────────────────────────────────────
export function AgentMenu({ onNewSession, onOpenGroupchat, groupchatActive, sessionStatus }: {
  onNewSession(workspaceId?: string): void;
  /** 打开「多角色群聊」面板；create=true 时直接拉起它的「新建群聊」流程，groupName 指定时切到该群 */
  onOpenGroupchat?(create: boolean, groupName?: string): void;
  /** 当前主区显示的是不是群聊面板（决定群聊行要不要挂选中态） */
  groupchatActive?: boolean;
  /** 宿主 ui-session 的会话状态表（sidebar 从槽位标准 props 的 useSessionStatus 取来） */
  sessionStatus?: SessionStatusMap;
}) {
  const workspaceState = useStore(api?.workspaces, EMPTY_WORKSPACES);
  const sessions = useStore(api?.sessions, EMPTY_SESSIONS);
  // pendingInteraction 带 kind 判别（"approval" 就是审批卡在等人）。
  // 只认审批，别把「等你回答问题」之类的交互也算成审批。
  const approvalSet = React.useMemo(() => {
    const set = new Set<string>();
    for (const [id, entry] of sessionStatus ?? EMPTY_STATUS) {
      const interaction = entry?.pendingInteraction as { kind?: unknown } | undefined;
      if (interaction !== undefined && interaction !== null && interaction.kind === 'approval') set.add(id);
    }
    return set;
  }, [sessionStatus]);
  const { view, setView } = useView();
  useCurrentSession();
  useCompletion();
  React.useEffect(() => { trackCompletion(sessions.byId); }, [sessions]);
  const [headingMenu, setHeadingMenu] = React.useState<DOMRect | null>(null);
  // 群聊列表：宿主从多角色群聊插件的数据目录里读，插件未装时为空数组
  const [groups, setGroups] = React.useState<GroupchatGroup[]>([]);
  // 群聊的「当前选中」真值在插件自己的 localStorage 里（切群时由它写入），
  // 这里镜像一份，用来给 agent 里的群聊行挂和会话行一样的选中态。
  const GROUPSEL_KEY = 'dsh.groupchat.selected.v1';
  const readSelectedGroup = (): string | null => {
    try { return window.localStorage.getItem(GROUPSEL_KEY); } catch { return null; }
  };
  const [activeGroup, setActiveGroup] = React.useState<string | null>(readSelectedGroup);
  // 未读：按群的 events 行数（seq）与本地记录的已读数比较；首次加载把当前值都记为已读
  const SEEN_KEY = 'pilot:groupchat:seen';
  const readSeen = (): Record<string, number> => {
    try {
      const raw = window.localStorage.getItem(SEEN_KEY);
      const parsed = raw === null ? null : JSON.parse(raw);
      return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, number> : {};
    } catch { return {}; }
  };
  const [seen, setSeen] = React.useState<Record<string, number>>(readSeen);
  const markGroupRead = (group: GroupchatGroup) => {
    const next = { ...readSeen(), [group.id]: group.seq };
    try { window.localStorage.setItem(SEEN_KEY, JSON.stringify(next)); } catch { /* 忽略 */ }
    setSeen(next);
  };
  React.useEffect(() => {
    if (onOpenGroupchat === undefined) return;
    let live = true;
    const store = (list: GroupchatGroup[]) => {
      if (!live) return;
      setGroups(list);
      setActiveGroup(readSelectedGroup());
      // 第一次拿到列表时把现有消息都标记为已读，避免一进来全是未读红点
      const current = readSeen();
      if (Object.keys(current).length === 0 && list.length > 0) {
        const seeded = Object.fromEntries(list.map(group => [group.id, group.seq]));
        try { window.localStorage.setItem(SEEN_KEY, JSON.stringify(seeded)); } catch { /* 忽略 */ }
        setSeen(seeded);
      }
    };
    const load = () => { void readGroupchatGroups().then(store); };
    load();
    const timer = window.setInterval(load, 5000);
    return () => { live = false; window.clearInterval(timer); };
  }, [onOpenGroupchat]);
  const items = workspaceState.items ?? [];
  const archived = workspaceState.archivedSessionIds ?? [];
  const archivedSet = new Set(archived);
  const pinnedSet = new Set(workspaceState.pinnedSessionIds ?? []);
  const main = defaultWorkspace(items);
  // 项目段永远完整显示：包含还没有会话的空项目（显示「暂无会话」占位），不做过滤。
  const projects = items.filter(workspace => workspace !== main);
  const listIds = orderedIds(main, sessions, archived, view);
  const open = (id: string) => { api?.openSession(id); setCurrentSession(id); markSeen(id); };
  // 点群聊行：切到该群并标记已读；会话的选中态让位（主区已经被群聊占着）
  const openGroup = (group: GroupchatGroup) => {
    markGroupRead(group);
    setCurrentSession(null);
    setActiveGroup(group.id);
    onOpenGroupchat?.(false, group.name);
  };
  // ⋯ 里的管理 / 导出：直接弹插件挂在窗口级浮层上的管理弹窗，不切主区、也不动会话
  const groupAction = (group: GroupchatGroup, action: 'manage' | 'export') => {
    window.dispatchEvent(new CustomEvent('dsh-groupchat:manage', { detail: { groupId: group.id, tab: action } }));
  };
  const newSession = onNewSession;
  const addProject = () => {
    if (!api) return;
    void api.pickDirectory()
      .then(path => (path ? api?.createWorkspace(path) : undefined))
      .then(workspace => { if (workspace?.workspaceId) newSession(workspace.workspaceId); })
      .catch(() => { /* 宿主会提示失败 */ });
  };

  return (
    <div className="pilot-agent-menu">
      <section className="pilot-agent-section">
        <HeadingRow
          title="会话"
          action={(
            <>
              <button type="button" className="pilot-agent-icon" title="新增会话" aria-label="新增会话" onClick={() => newSession(main?.workspaceId)}><Glyph kind="plus" /></button>
              <button type="button" className="pilot-agent-icon" title="视图选项" aria-label="视图选项" aria-haspopup="menu" aria-expanded={headingMenu !== null} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setHeadingMenu(value => value ? null : rect); }}><Glyph kind="more" /></button>
            </>
          )}
        />
        {headingMenu ? <ViewMenu view={view} setView={setView} anchor={headingMenu} onClose={() => setHeadingMenu(null)} /> : null}
        <SessionRows ids={listIds} sessions={sessions} pinnedSet={pinnedSet} archivedSet={archivedSet} approvalSet={approvalSet} onOpen={open} />
      </section>

      {/* 项目段固定显示（含没有会话的空项目，「暂无会话」占位保留） */}
      <section className="pilot-agent-section">
        <HeadingRow
          title="项目"
          action={<button type="button" className="pilot-agent-icon" title="选择项目" aria-label="选择项目" onClick={addProject}><Glyph kind="folder" /></button>}
        />
        {projects.length === 0 ? <div className="pilot-agent-empty">暂无项目</div> : null}
        {projects.map(workspace => (
          <ProjectRow
            key={workspace.workspaceId}
            workspace={workspace}
            sessions={sessions}
            defaultView={view}
            pinnedSet={pinnedSet}
            archivedSet={archivedSet}
            approvalSet={approvalSet}
            onOpen={open}
            onNew={newSession}
          />
        ))}
      </section>

      {/* 群聊：入口放在 agent 里；行样式与会话行一致，二级列表缩进，未读用圆点标记 */}
      {onOpenGroupchat !== undefined ? <section className="pilot-agent-section">
        <HeadingRow
          title="群聊"
          action={<button type="button" className="pilot-agent-icon" title="新建群聊" aria-label="新建群聊" onClick={() => onOpenGroupchat?.(true)}><Glyph kind="plus" /></button>}
        />
        {groups.length === 0
          ? <div className="pilot-agent-empty">暂无群聊</div>
          : <div className="pilot-agent-group-list">
            {groups.map(group => (
              <GroupRow
                key={group.id}
                group={group}
                unread={group.seq > (seen[group.id] ?? group.seq)}
                selected={groupchatActive === true && group.id === activeGroup}
                onOpen={openGroup}
                onAction={groupAction}
              />
            ))}
          </div>}
      </section> : null}
    </div>
  );
}
