/** Navigation grouping only; DSH remains the authority for paths, sessions and persistence. */
export const PROJECTS_KEY = 'pilot.project-workspaces'
export interface PilotWorkspace { workspaceId: string; path: string; title: string; sessionIds: readonly string[]; createdAt?: string; updatedAt?: string }
export function readProjectIds(storage: Pick<Storage, 'getItem'>): string[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(PROJECTS_KEY) ?? '[]')
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))] : []
  } catch { return [] }
}
export function projectSessions(items: readonly PilotWorkspace[], projectIds: readonly string[]): Set<string> {
  const selected = new Set(projectIds)
  return new Set(items.filter((item) => selected.has(item.workspaceId)).flatMap((item) => item.sessionIds))
}
