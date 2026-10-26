/** Labels shared by the session list and the tab strip. */
export interface LabelSession {
  id: string
  displayTitle?: string | undefined
  blank?: boolean | undefined
  updatedAt: number
  origin?: 'subagent' | undefined
  parentId?: string | undefined
}

const WORKSPACE_PLACEHOLDER = 'default-workspace'
const MAIN_KEY = 'nanomuse.mainChat'

export function readStoredMain(): string | undefined {
  try { return window.localStorage.getItem(MAIN_KEY) ?? undefined } catch { return undefined }
}

export function mainCandidates(sessions: readonly LabelSession[], excluded: ReadonlySet<string>): LabelSession[] {
  return sessions.filter((session) => session.origin !== 'subagent' && !session.parentId && !excluded.has(session.id))
}

/** The session the list shows as nexo: the synced main chat, the remembered one, else the oldest real chat. */
export function resolveMainSessionId(candidates: readonly LabelSession[], syncMain: string, storedMain: string | undefined, current: string | undefined, synced: ReadonlySet<string>): string | undefined {
  if (syncMain && candidates.some((session) => session.id === syncMain)) return syncMain
  if (storedMain && candidates.some((session) => session.id === storedMain)) return storedMain
  if (candidates.length === 0) return undefined
  const eligible = candidates.filter((session) => !session.blank || session.id === current || synced.has(session.id))
  return [...eligible].sort((a, b) => a.updatedAt - b.updatedAt)[0]?.id ?? candidates[0]!.id
}

export function sessionRowLabel(session: LabelSession | undefined, options: { main: boolean; synced: boolean; mainLabel: string; blankLabel: string; placeholderTitle?: boolean }): string {
  if (options.main) return options.mainLabel
  if (!session) return options.blankLabel
  if (session.blank && !options.synced) return options.blankLabel
  const title = session.displayTitle?.trim()
  if (!title || (options.placeholderTitle !== false && title === WORKSPACE_PLACEHOLDER)) return options.blankLabel
  return title
}
