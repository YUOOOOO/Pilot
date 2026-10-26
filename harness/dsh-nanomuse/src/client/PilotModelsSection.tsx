import { createElement as h, useId, useState, type ReactNode } from 'react'
import type { Translate } from './api.ts'
import { errorStyle, muted } from './api.ts'
import type { RenderSlot } from './MuseSidebar.tsx'
import { makeModelsSection } from './ModelsSection.tsx'
import { useProviders, WaysOnRows } from './OwnKey.tsx'

type ModelTab = 'providers' | 'usage' | 'advanced'
function Providers({ t }: { t: Translate }): ReactNode {
  const { view, error, reload } = useProviders(t)
  if (error) return h('div', { role: 'alert', style: errorStyle }, error)
  if (!view) return h('div', { style: muted }, t('loading'))
  return h('div', { className: 'nm-section' }, h('p', null, t('pilotModelsProvidersLead')), h(WaysOnRows, { t, view, onChanged: () => reload() }))
}
export function makePilotModelsSection(t: Translate) {
  const Usage = makeModelsSection(t)
  return function PilotModelsSection({ renderSettingsSection, advanced = false }: { renderSettingsSection: RenderSlot; advanced?: boolean }): ReactNode {
    const [tab, setTab] = useState<ModelTab>(advanced ? 'advanced' : 'providers')
    const [visited, setVisited] = useState<Set<ModelTab>>(() => new Set([advanced ? 'advanced' : 'providers']))
    const id = useId()
    const tabs: { id: ModelTab; label: string }[] = [{ id: 'providers', label: t('pilotModelsProviders') }, { id: 'usage', label: t('pilotModelsUsage') }, { id: 'advanced', label: t('pilotModelsAdvanced') }]
    const activate = (next: ModelTab) => { setVisited(before => new Set([...before, next])); setTab(next) }
    return h('div', { className: 'pilot-models' },
      h('style', null, MODEL_TABS_STYLES),
      h('div', { className: 'pilot-model-tabs', role: 'tablist', 'aria-label': t('mlTitle') }, tabs.map((item, index) => h('button', { key: item.id, type: 'button', role: 'tab', id: `${id}-${item.id}`, 'aria-controls': `${id}-${item.id}-panel`, 'aria-selected': tab === item.id, tabIndex: tab === item.id ? 0 : -1, onClick: () => activate(item.id), onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
        activate(tabs[next]!.id)
        document.getElementById(`${id}-${tabs[next]!.id}`)?.focus()
      } }, item.label))),
      tabs.map(item => h('div', { key: item.id, role: 'tabpanel', id: `${id}-${item.id}-panel`, 'aria-labelledby': `${id}-${item.id}`, hidden: tab !== item.id },
        visited.has(item.id) ? item.id === 'providers' ? h(Providers, { t }) : item.id === 'usage' ? h(Usage, { active: tab === 'usage', onAddProvider: () => activate('providers') }) : h('div', null, h('p', { className: 'pilot-models-note' }, t('pilotModelsAdvancedLead')), renderSettingsSection('settings.section', {}, { only: 'models' })) : null)))
  }
}
const MODEL_TABS_STYLES = `
.pilot-model-tabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--nm-border,#e5e5e5);margin-bottom:20px;padding-bottom:8px}
.pilot-model-tabs button{padding:8px 14px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}
.pilot-model-tabs button[aria-selected=true]{background:var(--nm-hover,#eee);color:var(--dsw-alias-label-primary);font-weight:600}
.pilot-model-tabs button:focus-visible{outline:2px solid #8ca8cd;outline-offset:2px}
.pilot-models [role=tabpanel][hidden]{display:none!important}.pilot-models-note{font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:16px;line-height:1.7}
`
