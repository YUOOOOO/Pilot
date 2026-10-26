import { mainCandidates, resolveMainSessionId } from './pilot-session-label.ts'

/** Session-only preset operations. Defaults remain owned by DSH settings. */
export interface PilotAgentPreset { id: string; name?: string; description?: string }
export type PresetResult<T> = { ok: true; value: T } | { ok: false; error: { message: string; details?: { reason?: unknown } } }
export interface PilotAgentPresetRemote {
  list(): Promise<PresetResult<{ presets: PilotAgentPreset[] }>>
  select(sessionId: string, presetId: string): Promise<PresetResult<string>>
}
export interface PilotAgentSession { blank: boolean; running?: boolean; projectionValues?: { agentPreset?: unknown } }
export type UseAgentSessions = <T>(selector: (state: { byId: Record<string, PilotAgentSession> }) => T) => T

export async function listAgentPresets(remote: PilotAgentPresetRemote): Promise<PilotAgentPreset[]> {
  const result = await remote.list()
  if (!result.ok) throw new Error(result.error.message)
  return result.value.presets
}
export async function selectSessionAgentPreset(remote: PilotAgentPresetRemote, sessionId: string, presetId: string): Promise<string> {
  if (!sessionId || !presetId) throw new Error('A session and preset are required')
  const result = await remote.select(sessionId, presetId)
  if (!result.ok) throw new Error(typeof result.error.details?.reason === 'string' ? result.error.details.reason : result.error.message)
  return result.value
}

export const PILOT_AGENT_PRESET = 'pilot'
export const STANDARD_AGENT_PRESET = 'standard'
export const LEGACY_AGENT_PRESET = 'nanomuse'

export function hiddenAgentMode(sessionId: string, rows: readonly { id: string; updatedAt?: number | undefined; origin?: 'subagent' | undefined; parentId?: string | undefined; blank?: boolean | undefined }[], storedMain: string | undefined): boolean {
  const sessions = rows.map((row) => ({ id: row.id, updatedAt: row.updatedAt ?? 0, ...(row.origin === undefined ? {} : { origin: row.origin }), ...(row.parentId === undefined ? {} : { parentId: row.parentId }), ...(row.blank === undefined ? {} : { blank: row.blank }) }))
  return resolveMainSessionId(mainCandidates(sessions, new Set()), '', storedMain, sessionId, new Set()) === sessionId
}
