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
