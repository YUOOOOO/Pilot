/** Settings navigation only; all permission controls keep their original services. */
export const PERMISSION_DETAILS = ['nanomuse-computer', 'nanomuse-files', 'nanomuse-dictation', 'nanomuse-connectors', 'nanomuse-devices', 'nanomuse-wallet', 'nanomuse-storage'] as const
export const PERMISSION_SECTION = 'nanomuse-permissions'
const REMOVED_SECTIONS = new Set(['nanomuse-help', 'nanomuse-legal', 'nanomuse-media', 'nanomuse-harness', 'models'])
export function isPermissionDetail(id: string | undefined): boolean {
  return id !== undefined && (PERMISSION_DETAILS as readonly string[]).includes(id)
}
export function visibleSettingsRows<T extends { id: string }>(rows: readonly T[]): T[] {
  return rows.filter(row => !isPermissionDetail(row.id) && !REMOVED_SECTIONS.has(row.id))
}
export function settingsSurface(rows: readonly { id: string }[], requested: string | undefined): { active: string | undefined; detail: string | undefined } {
  if (requested === 'models' && rows.some(row => row.id === 'nanomuse-models')) return { active: 'nanomuse-models', detail: undefined }
  if (isPermissionDetail(requested) && rows.some(row => row.id === requested) && rows.some(row => row.id === PERMISSION_SECTION)) {
    return { active: PERMISSION_SECTION, detail: requested }
  }
  const visible = visibleSettingsRows(rows)
  return { active: visible.find(row => row.id === requested)?.id ?? visible[0]?.id, detail: undefined }
}
