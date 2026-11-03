// 「会话 / 项目」菜单列（带行内悬停操作）：
//   会话段 = 默认工作区（默认文件夹）下的会话；项目段 = 每个工作区 + 其会话，项目可展开收起。
//   两段都每页 5 条；标题行/项目行/会话行悬停出现 ＋ 与 ⋯。
//   ⋯ 两级：标题级 = 排序/分组/归档筛选（插件自维护，写 localStorage）；
//            会话级 = 置顶/重命名/分叉/归档/复制 ID。
import * as React from 'react';

type Store<T> = { getSnapshot(): T; subscribe(listener: () => void): () => void };
export interface WorkspaceView { workspaceId: string; path: string; title: string; sessionIds: readonly string[]; createdAt?: string }
export interface SessionSummary { id: string; title?: string; displayTitle?: string; cwd?: string; blank?: boolean; updatedAt?: number; running?: boolean }
interface WorkspaceSnapshot { items?: readonly WorkspaceView[]; archivedSessionIds?: readonly string[]; pinnedSessionIds?: readonly string[] }
interface SessionListState { ids?: readonly string[]; byId?: Record<string, SessionSummary> }

export interface WorkspaceApi {
  startSession(workspaceId?: string): void;
  openSession(sessionId: string): void;
  pickDirectory(): Promise<string | null>;
  createWorkspace(path: string): Promise<WorkspaceView | undefined>;
  pinSession(sessionId: string, pinned: boolean): void;
  renameSession(sessionId: string, title: string): void;
  archiveSession(sessionId: string, archived: boolean): void;
  forkSession(sessionId: string): void;
  copySessionId(sessionId: string): void;
  workspaces: Store<WorkspaceSnapshot>;
  sessions: Store<SessionListState>;
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

// ── 视图状态（插件自维护，和宿主共用同一份 localStorage key）──────────────
export interface ViewState { orderBy: 'updated' | 'created'; groupBy: 'workspace' | 'flat'; archivedFilter: 'default' | 'show' | 'only' }
const VIEW_KEY = 'dsh.workspace.view.v5';
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

// ── 标题级 ⋯：排序 / 分组 / 归档筛选 ────────────────────────────────
function ViewMenu({ view, setView, anchor, onClose }: { view: ViewState; setView(next: ViewState): void; anchor: DOMRect; onClose(): void }) {
  const pick = (next: ViewState) => { setView(next); onClose(); };
  return (
    <div className="pilot-agent-pop" role="menu" style={popStyle(anchor)} onMouseLeave={onClose}>
      <div className="pilot-agent-pop-label">排序</div>
      <button type="button" role="menuitemradio" aria-checked={view.orderBy === 'updated'} className="pilot-agent-pop-item" onClick={() => pick({ ...view, orderBy: 'updated' })}>按更新时间</button>
      <button type="button" role="menuitemradio" aria-checked={view.orderBy === 'created'} className="pilot-agent-pop-item" onClick={() => pick({ ...view, orderBy: 'created' })}>按创建时间</button>
      <div className="pilot-agent-pop-label">分组</div>
      <button type="button" role="menuitemradio" aria-checked={view.groupBy === 'workspace'} className="pilot-agent-pop-item" onClick={() => pick({ ...view, groupBy: 'workspace' })}>按项目分组</button>
      <button type="button" role="menuitemradio" aria-checked={view.groupBy === 'flat'} className="pilot-agent-pop-item" onClick={() => pick({ ...view, groupBy: 'flat' })}>平铺</button>
      <div className="pilot-agent-pop-label">归档</div>
      <button type="button" role="menuitemradio" aria-checked={view.archivedFilter === 'default'} className="pilot-agent-pop-item" onClick={() => pick({ ...view, archivedFilter: 'default' })}>隐藏归档</button>
      <button type="button" role="menuitemradio" aria-checked={view.archivedFilter === 'show'} className="pilot-agent-pop-item" onClick={() => pick({ ...view, archivedFilter: 'show' })}>显示归档</button>
      <button type="button" role="menuitemradio" aria-checked={view.archivedFilter === 'only'} className="pilot-agent-pop-item" onClick={() => pick({ ...view, archivedFilter: 'only' })}>只看归档</button>
    </div>
  );
}

// ── 会话级 ⋯：置顶 / 重命名 / 分叉 / 归档 / 复制 ID ─────────────────
function SessionMenu({ id, pinned, archived, anchor, onRename, onClose }: { id: string; pinned: boolean; archived: boolean; anchor: DOMRect; onRename(): void; onClose(): void }) {
  const service = api;
  const run = (action: () => void) => { action(); onClose(); };
  return (
    <div className="pilot-agent-pop" role="menu" style={popStyle(anchor)} onMouseLeave={onClose}>
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
  const [value, setValue] = React.useState(label);
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  const submit = () => {
    const next = value.trim();
    if (next && next !== label) api?.renameSession(id, next);
    onDone();
  };
  return (
    <div className="pilot-agent-dialog" role="dialog" aria-label="重命名会话" style={popStyle(anchor)} onMouseLeave={() => {}}>
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
function SessionRow({ id, label, pinned, archived, running, onOpen }: { id: string; label: string; pinned: boolean; archived: boolean; running: boolean; onOpen(id: string): void }) {
  const [open, setOpen] = React.useState<DOMRect | null>(null);
  const [editing, setEditing] = React.useState<DOMRect | null>(null);
  return (
    <div className="pilot-agent-row-wrap" data-archived={archived || undefined}>
      <button type="button" className="pilot-agent-row" aria-current={id === currentSessionId ? 'page' : undefined} title={archived ? '已归档，不可打开' : label} onClick={() => { if (archived) return; onOpen(id); }}>
        {pinned ? <span className="pilot-agent-pin" aria-hidden="true" /> : null}
        {running ? <span className="pilot-agent-running" aria-hidden="true" title="运行中" /> : null}
        {completedIds.has(id) ? <span className="pilot-agent-done" aria-hidden="true" title="已完成">✓</span> : null}
        <span className="pilot-agent-row-label">{label}</span>
      </button>
      <div className="pilot-agent-row-actions">
        <button type="button" className="pilot-agent-icon" title="更多" aria-label="更多" aria-haspopup="menu" aria-expanded={open !== null} onClick={event => setOpen(value => value ? null : event.currentTarget.getBoundingClientRect())}><Glyph kind="more" /></button>
      </div>
      {open ? <SessionMenu id={id} pinned={pinned} archived={archived} anchor={open} onRename={() => setEditing(open)} onClose={() => setOpen(null)} /> : null}
      {editing ? <RenameDialog id={id} label={label} anchor={editing} onDone={() => setEditing(null)} /> : null}
    </div>
  );
}

function SessionRows({ ids, sessions, pinnedSet, archivedSet, onOpen }: { ids: string[]; sessions: SessionListState; pinnedSet: Set<string>; archivedSet: Set<string>; onOpen(id: string): void }) {
  const key = ids.join('\u0000');
  const [limit, setLimit] = React.useState(PAGE);
  React.useEffect(() => { setLimit(PAGE); }, [key]);
  if (ids.length === 0) return <div className="pilot-agent-empty">暂无会话</div>;
  return (
    <>
      {ids.slice(0, limit).map(id => (
        <SessionRow key={id} id={id} label={sessionLabel((sessions.byId ?? {})[id])} pinned={pinnedSet.has(id)} archived={archivedSet.has(id)} running={Boolean((sessions.byId ?? {})[id]?.running)} onOpen={onOpen} />
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
function ProjectRow({ workspace, sessions, view, setView, pinnedSet, archivedSet, onOpen, onNew }: {
  workspace: WorkspaceView; sessions: SessionListState; view: ViewState; setView(next: ViewState): void;
  pinnedSet: Set<string>; archivedSet: Set<string>; onOpen(id: string): void; onNew(workspaceId: string): void;
}) {
  const [expanded, setExpanded] = React.useState(true);
  const [menu, setMenu] = React.useState<DOMRect | null>(null);
  const ids = orderedIds(workspace, sessions, [...archivedSet], view);
  return (
    <div className="pilot-agent-project">
      <div className="pilot-agent-project-row">
        <button type="button" className="pilot-agent-project-title" title={workspace.path || workspaceName(workspace)} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
          <span className="pilot-agent-chevron" data-open={expanded || undefined}><Glyph kind="chevron" /></span>
          <span className="pilot-agent-project-name">{workspaceName(workspace)}</span>
        </button>
        <div className="pilot-agent-row-actions">
          <button type="button" className="pilot-agent-icon" title="新建会话" aria-label="新建会话" onClick={() => onNew(workspace.workspaceId)}><Glyph kind="plus" /></button>
          <button type="button" className="pilot-agent-icon" title="视图选项" aria-label="视图选项" aria-haspopup="menu" aria-expanded={menu !== null} onClick={event => setMenu(value => value ? null : event.currentTarget.getBoundingClientRect())}><Glyph kind="more" /></button>
        </div>
      </div>
      {expanded ? <SessionRows ids={ids} sessions={sessions} pinnedSet={pinnedSet} archivedSet={archivedSet} onOpen={onOpen} /> : null}
      {menu ? <ViewMenu view={view} setView={setView} anchor={menu} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

// ── 主组件 ──────────────────────────────────────────────────────────
export function AgentMenu({ onNewSession }: { onNewSession(workspaceId?: string): void }) {
  const workspaceState = useStore(api?.workspaces, EMPTY_WORKSPACES);
  const sessions = useStore(api?.sessions, EMPTY_SESSIONS);
  const { view, setView } = useView();
  useCurrentSession();
  useCompletion();
  React.useEffect(() => { trackCompletion(sessions.byId); }, [sessions]);
  const [headingMenu, setHeadingMenu] = React.useState<DOMRect | null>(null);
  const items = workspaceState.items ?? [];
  const archived = workspaceState.archivedSessionIds ?? [];
  const archivedSet = new Set(archived);
  const pinnedSet = new Set(workspaceState.pinnedSessionIds ?? []);
  const main = defaultWorkspace(items);
  const projects = items.filter(workspace => workspace !== main);
  const open = (id: string) => { api?.openSession(id); setCurrentSession(id); markSeen(id); };
  const newSession = onNewSession;
  const mainIds = orderedIds(main, sessions, archived, view);
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
              <button type="button" className="pilot-agent-icon" title="视图选项" aria-label="视图选项" aria-haspopup="menu" aria-expanded={headingMenu !== null} onClick={event => setHeadingMenu(value => value ? null : event.currentTarget.getBoundingClientRect())}><Glyph kind="more" /></button>
            </>
          )}
        />
        {headingMenu ? <ViewMenu view={view} setView={setView} anchor={headingMenu} onClose={() => setHeadingMenu(null)} /> : null}
        <SessionRows ids={mainIds} sessions={sessions} pinnedSet={pinnedSet} archivedSet={archivedSet} onOpen={open} />
      </section>

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
            view={view}
            setView={setView}
            pinnedSet={pinnedSet}
            archivedSet={archivedSet}
            onOpen={open}
            onNew={newSession}
          />
        ))}
      </section>
    </div>
  );
}
