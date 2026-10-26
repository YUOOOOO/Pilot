/** Local navigation preferences; DSH remains the source of session/workspace data. */
export type ListSort = 'updated' | 'oldest' | 'name' | 'created'
export interface NavPreferences { sort: ListSort; showArchived: boolean; pinnedProjects: string[]; archivedProjects: string[] }
export const NAV_KEY = 'pilot.navigation-preferences.v1'
export function readNav(raw: string | null): NavPreferences {
  const initial: NavPreferences = { sort: 'updated', showArchived: false, pinnedProjects: [], archivedProjects: [] }
  try {
    const value = JSON.parse(raw ?? '{}') as Partial<NavPreferences>
    if (!value || typeof value !== 'object') return initial
    const ids = (v: unknown) => Array.isArray(v) ? [...new Set(v.filter((id): id is string => typeof id === 'string' && !!id))] : []
    return { sort: ['updated', 'oldest', 'name', 'created'].includes(String(value.sort)) ? value.sort! : 'updated', showArchived: value.showArchived === true, pinnedProjects: ids(value.pinnedProjects), archivedProjects: ids(value.archivedProjects) }
  } catch { return initial }
}
export function sortSessions<T extends { id: string; displayTitle: string; updatedAt: number }>(rows: readonly T[], mode: ListSort, created: Readonly<Record<string, number>>, pinned: ReadonlySet<string>): T[] {
  return [...rows].sort((a,b) => {
    const pin = Number(pinned.has(b.id)) - Number(pinned.has(a.id))
    if (pin) return pin
    if (mode === 'name') return a.displayTitle.localeCompare(b.displayTitle, undefined, { numeric: true }) || a.id.localeCompare(b.id)
    if (mode === 'updated') return b.updatedAt-a.updatedAt || a.id.localeCompare(b.id)
    const ac=created[a.id], bc=created[b.id]
    if (ac === undefined || bc === undefined) return Number(bc !== undefined)-Number(ac !== undefined) || a.id.localeCompare(b.id)
    return (mode === 'oldest' ? ac-bc : bc-ac) || a.id.localeCompare(b.id)
  })
}
