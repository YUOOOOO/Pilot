/** Pilot composer presentation. All submission, permission and model actions stay in DSH. */
import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Translate } from './api.ts'
import { IconCpu } from './icons.tsx'
import { ListMenu } from './PilotListMenus.tsx'
import type { PilotAgentPreset, UseAgentSessions } from './pilot-agent-presets.ts'

interface AgentControlProps {
  t: Translate
  sessionId: string
  useAgentSessions: UseAgentSessions
  load(): Promise<PilotAgentPreset[]>
  select(presetId: string): Promise<string>
}
export function PilotAgentControl({ t, sessionId, useAgentSessions, load, select }: AgentControlProps): ReactNode {
  const session = useAgentSessions(state => state.byId[sessionId])
  const projected = typeof session?.projectionValues?.agentPreset === 'string' ? session.projectionValues.agentPreset : undefined
  const [selected, setSelected] = useState<string>()
  const current = selected ?? projected
  const [options, setOptions] = useState<PilotAgentPreset[]>([])
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { setSelected(undefined) }, [projected])
  useEffect(() => {
    let active = true
    setLoading(true)
    load().then(rows => { if (active) { setOptions(rows); setError('') } }).catch(e => { if (active) setError(String(e instanceof Error ? e.message : e)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [load])
  const keys = { standard: 'pilotAgentStandard', ptc: 'pilotAgentPtc', minimal: 'pilotAgentMinimal', cordis: 'pilotAgentCreator' } as const
  const label = (preset: PilotAgentPreset): string => preset.name ?? (preset.id in keys ? t(keys[preset.id as keyof typeof keys]) : preset.id)
  const chosen = options.find(option => option.id === current)
  const locked = !session || !session.blank || session.running === true
  const pick = async (id: string) => {
    if (pending.current || locked || id === current) return
    pending.current = true; setBusy(true); setError('')
    try { const applied = await select(id); if (alive.current) setSelected(applied) }
    catch (e) { if (alive.current) setError(String(e instanceof Error ? e.message : e)) }
    finally { pending.current = false; if (alive.current) setBusy(false) }
  }
  return h('div', { className: 'pilot-agent-control' },
    h('button', { type: 'button', className: 'pilot-composer-agent', title: locked ? t('pilotAgentLocked') : t('pilotComposerAgentSettings'), 'aria-label': t('pilotComposerAgentSettings'), 'aria-haspopup': 'menu', 'aria-expanded': !!anchor, 'aria-busy': busy || loading, disabled: busy || loading, onClick: (event: React.MouseEvent<HTMLButtonElement>) => setAnchor(anchor ? null : event.currentTarget) }, h(IconCpu, { size: 14 }), h('span', { className: 'pilot-agent-label' }, chosen ? label(chosen) : current ?? t('pilotComposerAgent')), h('svg', { className: 'pilot-agent-chevron', width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'm4 6 4 4 4-4' }))),
    anchor ? h(ListMenu, { anchor, title: locked ? t('pilotAgentLocked') : t('pilotAgentCurrent'), close: () => setAnchor(null), items: options.map(option => ({ id: option.id, label: label(option), checked: current === option.id, disabled: locked, run: () => { void pick(option.id) } })) }) : null,
    error ? h('span', { role: 'alert', className: 'pilot-agent-error', title: error }, error) : null)
}
interface Pressure { projectedTokens?: number; pressureTokens?: number; contextWindow?: number }
export function PilotContextUsage({ t, useProjection }: { t: Translate; useProjection?: ((key: string) => unknown) | undefined }): ReactNode {
  const pressure = typeof useProjection === 'function' ? useProjection('contextPressure') as Pressure | undefined : undefined
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const click = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', click, true)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', click, true); document.removeEventListener('keydown', key) }
  }, [open])
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  const capacity = pressure?.contextWindow
  if (typeof used !== 'number' || typeof capacity !== 'number' || !Number.isFinite(used) || !Number.isFinite(capacity) || capacity <= 0) return null
  const percent = Math.max(0, Math.min(100, Math.round(used / capacity * 100)))
  const label = t('pilotComposerUsage', { percent })
  return h('div', { className: 'pilot-context-control', ref: root },
    h('button', { type: 'button', className: 'pilot-context-trigger', 'aria-label': label, title: label, 'aria-expanded': open, onClick: () => setOpen(!open) },
      h('svg', { width: 15, height: 15, viewBox: '0 0 16 16', 'aria-hidden': true },
        h('circle', { cx: 8, cy: 8, r: 6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, opacity: .18 }),
        h('circle', { cx: 8, cy: 8, r: 6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeDasharray: `${percent * .377} 37.7`, transform: 'rotate(-90 8 8)' })), h('span', null, `${percent}%`)),
    open ? h('div', { className: 'pilot-context-popover', role: 'status' }, h('strong', null, label), h('div', null, t('pilotComposerTokens', { used: Math.round(used).toLocaleString(), total: Math.round(capacity).toLocaleString() }))) : null)
}

export const PILOT_COMPOSER_STYLES = `
html[data-nanomuse] { --dsh-composer-card-max-width: 1120px; --dsh-composer-side-clearance: 24px; --dsh-composer-text-max-height: 260px; }
html[data-nanomuse] [data-slot='conversation.hero.agentPreset'] { display: none !important; }
html[data-nanomuse] [class*='_heroWorkspaceRow'] { display: none !important; }
/* Synced chat bubbles outside the view must not consume the trajectory overlay's flex space. */
[data-conversation-content]:has([data-conversation-composer-overlay]) .nm-remote { display: none !important; }
[data-conversation-content] [class*='_composerStack'] { width: 100%; max-width: none; }
[data-conversation-content] [data-composer-seat] { width: 100%; }
[data-conversation-content] [data-composer-card] { display: flex !important; flex-direction: column !important; flex-wrap: nowrap !important; align-items: stretch !important; gap: 8px !important; width: 100%; max-width: min(1120px, 100%) !important; box-sizing: border-box; padding: 12px 10px 8px !important; border-radius: 20px !important; background: var(--dsw-specific-input-major, #fff) !important; box-shadow: 0 2px 14px #0000000d, 0 0 0 1px var(--nm-field-border, #ededed) !important; }
[data-conversation-content] [data-composer-card] > [data-input-scroll] { width: 100%; flex: 0 1 auto !important; order: 0 !important; min-width: 0; min-height: 56px; margin: 0 !important; }
[data-conversation-content] [data-composer-card] [data-composer-input] { min-height: 56px !important; padding: 0 3px !important; font-size: 13px; line-height: 22px; }
[data-conversation-content] [data-composer-card] [data-composer-placeholder] { inset: 0 3px auto !important; font-size: 13px; line-height: 22px; color: transparent !important; }
[data-conversation-content] [data-composer-card] [data-composer-placeholder]::before { content: var(--pilot-composer-placeholder) !important; position: absolute; inset: 0; color: var(--dsw-alias-label-tertiary); white-space: normal; }
[data-conversation-content] [data-composer-card] > [class*='_row']:last-child { display: flex !important; flex-direction: row; flex-wrap: wrap; width: 100%; order: 1; align-items: center; justify-content: space-between; gap: 6px 12px; padding: 0; box-sizing: border-box; }
[data-conversation-content] [data-composer-card] > [class*='_row'] > [class*='_tools'] { display: flex; align-items: center; order: 0 !important; gap: 10px !important; min-width: 0; }
[data-conversation-content] [data-composer-card] > [class*='_row'] > [class*='_trailing'] { display: flex; align-items: center; order: 1 !important; margin-left: auto !important; gap: 10px; }
[data-conversation-content] [data-composer-card] [class*='_modes'] { display: flex !important; align-items: center; gap: 8px; }
[data-conversation-content] [data-composer-card] [class*='_standardControls']:not([hidden]) { display: flex; gap: 10px !important; align-items: center; }
[data-conversation-content] [data-composer-card] [class*='_standardControls'][hidden] { display: none !important; }
[data-conversation-content] [data-composer-card] [class*='_activity'] { display: flex !important; }
[data-conversation-content] [data-composer-card] [class*='_activity']:empty { display: none !important; }
[data-conversation-content] [data-composer-card] [class*='_add'] { order: 0; width: 28px !important; height: 28px !important; background: transparent; border-radius: 7px; color: var(--dsw-alias-label-secondary); }
[data-conversation-content] [data-composer-card] [class*='_tools'] > [class*='_modes'] { order: 2; }
[data-conversation-content] [data-composer-card] [data-slot='conversation.input.left'] { order: 1; }
[data-conversation-content] [data-composer-card] [class*='_primary'] { width: 30px !important; height: 30px !important; transform: none !important; background: var(--nm-send, #252525) !important; color: var(--nm-ink-fg, white) !important; }
[data-conversation-content] [data-composer-card] [class*='_primary']:disabled { background: #e4e4e4 !important; color: #878787 !important; opacity: 1 !important; }
[data-conversation-content] [data-composer-card] [data-slot='conversation.input.permission'] button, [data-conversation-content] [data-composer-card] [data-slot='conversation.input.model'] button { font-size: 12px; font-weight: 400; height: 28px; }
[data-conversation-content] [data-composer-card] [data-slot='conversation.input.model'] { --dsh-composer-model-text-display: inline; --dsh-composer-model-icon-display: block; }
[data-conversation-content] [data-composer-card] > [class*='_accessory'], [data-conversation-content] [data-composer-card] > [class*='_rail'] { order: -1; width: 100%; flex-basis: auto; }
[data-conversation-content][data-content-phase='active'] [data-composer-card] { margin-bottom: 16px !important; }
[data-conversation-content] [data-composer-card] ~ [class*='_dock'] > :has(svg [class*='_track']) { display: none !important; }
.pilot-agent-control { display: inline-flex; align-items: center; position: relative; min-width: 0; }
.pilot-agent-error { position: absolute; bottom: 36px; left: 0; width: max-content; max-width: 300px; padding: 8px 10px; border: 1px solid #d6a5a5; border-radius: 8px; background: var(--dsw-alias-bg-base, white); color: #b42318; font-size: 12px; white-space: normal; overflow-wrap: anywhere; z-index: 180; }
.pilot-composer-agent:disabled { opacity: .55; cursor: wait; }

.pilot-composer-agent { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 4px; border: 0; border-radius: 6px; font: inherit; font-size: 12px; line-height: 16px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.pilot-composer-agent > svg { display: block; flex: none; }
.pilot-agent-label { display: block; line-height: 16px; }
.pilot-composer-agent:hover, .pilot-context-trigger:hover { background: var(--nm-hover, #f3f3f3); }
.pilot-context-control { position: relative; display: inline-flex; align-items: center; }
.pilot-context-trigger { display: inline-flex; align-items: center; gap: 6px; height: 28px; border: 0; padding: 0 4px; background: transparent; border-radius: 6px; color: var(--dsw-alias-label-secondary); font-size: 11px; cursor: pointer; }
.pilot-context-popover { position: absolute; bottom: 38px; right: 0; min-width: 210px; padding: 12px; border: 1px solid var(--nm-border, #ddd); border-radius: 9px; background: var(--dsw-alias-bg-base, white); color: var(--dsw-alias-label-primary); box-shadow: 0 6px 24px #0002; font-size: 12px; line-height: 1.8; z-index: 40; }
[data-conversation-content] [data-composer-card] .nm-mic { width: 26px; height: 28px; }
@media (max-width: 1050px) { html[data-nanomuse] { --dsh-composer-side-clearance: 16px; } [data-conversation-content] [data-composer-card] > [class*='_row'] { gap: 4px 6px; } [data-conversation-content] [data-composer-card] [class*='_standardControls']:not([hidden]) { gap: 5px !important; } }
`.replaceAll('[data-conversation-content]', 'html[data-nanomuse] [data-conversation-content]')
