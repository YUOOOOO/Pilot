// 宿主的会话浏览器有三种分组：workspace（默认，把普通会话套在「默认工作区」下）、
// workspace-tree 和 flat（平铺，标题为「会话」）。普通会话本来就落在默认工作区里，
// 再套一层分组只是噪音，所以启动时把视图模式改成 flat。
const VIEW_KEY = 'dsh.workspace.view.v5';
// 宿主还没写过这份状态时，用它其余字段的默认值补一份（groupBy 我们说了算）。
const REST_DEFAULTS = {
  orderBy: 'updated',
  groupExpansion: {},
  sessionOrderByAccount: {},
  archivedFilter: 'default',
};
const RELOAD_GUARD = 'pilot:view-flat-reload';

export function flattenWorkspaceGrouping(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    let view: Record<string, unknown>;
    if (raw) {
      const stored = JSON.parse(raw) as unknown;
      if (!stored || typeof stored !== 'object') return;
      view = stored as Record<string, unknown>;
    } else {
      view = { ...REST_DEFAULTS };
    }
    if (view.groupBy === 'flat') return;
    view.groupBy = 'flat';
    localStorage.setItem(VIEW_KEY, JSON.stringify(view));
    scheduleReload();
  } catch {
    /* 隐私模式或结构变化：保持宿主默认分组 */
  }
}

// 宿主浏览器在模块初始化时就缓存了分组模式，本次启动已经来不及：等页面 load
// 完成后再重载一次让它读到 flat。sessionStorage 的标记保证最多重载一次。
function scheduleReload(): void {
  if (typeof sessionStorage === 'undefined') return;
  const reloadOnce = (): void => {
    if (sessionStorage.getItem(RELOAD_GUARD)) return;
    sessionStorage.setItem(RELOAD_GUARD, '1');
    setTimeout(() => location.reload(), 300);
  };
  if (document.readyState === 'complete') reloadOnce();
  else window.addEventListener('load', reloadOnce, { once: true });
}
