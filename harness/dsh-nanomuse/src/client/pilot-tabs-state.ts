/** Pilot UI tabs only. Session data and running work remain owned by DSH. */
export const TABS_KEY = 'pilot.session-tabs.v1'
export interface SessionTabsState { ids: readonly string[]; active: string | null }
export type CloseTabs = 'current' | 'others' | 'right' | 'all'
export type TabsAction =
  | { type: 'open'; id: string }
  | { type: 'close'; id: string; mode: CloseTabs }
  | { type: 'move'; id: string; target: string; after: boolean }
  | { type: 'retain'; ids: readonly string[] }

export function readTabs(raw: string | null): SessionTabsState {
  try {
    const parsed: unknown = JSON.parse(raw ?? 'null')
    if (!parsed || typeof parsed !== 'object') return { ids: [], active: null }
    const value = parsed as { ids?: unknown; active?: unknown }
    const ids = Array.isArray(value.ids) ? [...new Set(value.ids.filter((id): id is string => typeof id === 'string' && id.length > 0))] : []
    return { ids, active: typeof value.active === 'string' && ids.includes(value.active) ? value.active : ids[0] ?? null }
  } catch { return { ids: [], active: null } }
}

export function reduceTabs(state: SessionTabsState, action: TabsAction): SessionTabsState {
  if (action.type === 'open') return { ids: state.ids.includes(action.id) ? state.ids : [...state.ids, action.id], active: action.id }
  if (action.type === 'move') {
    if (action.id === action.target || !state.ids.includes(action.id) || !state.ids.includes(action.target)) return state
    const ids = state.ids.filter((id) => id !== action.id)
    ids.splice(ids.indexOf(action.target) + (action.after ? 1 : 0), 0, action.id)
    return { ...state, ids }
  }
  let ids: readonly string[]
  if (action.type === 'retain') {
    const allowed = new Set(action.ids)
    ids = state.ids.filter((id) => allowed.has(id))
  } else {
    const index = state.ids.indexOf(action.id)
    if (action.mode !== 'all' && index < 0) return state
    ids = state.ids.filter((id, i) => action.mode === 'current' ? id !== action.id : action.mode === 'others' ? id === action.id : action.mode === 'right' ? i <= index : false)
  }
  if (state.active !== null && ids.includes(state.active)) return { ids, active: state.active }
  const oldIndex = state.active === null ? 0 : state.ids.indexOf(state.active)
  const next = state.ids.slice(Math.max(0, oldIndex + 1)).find((id) => ids.includes(id))
    ?? [...state.ids.slice(0, Math.max(0, oldIndex))].reverse().find((id) => ids.includes(id))
    ?? ids[0] ?? null
  return { ids, active: next }
}
