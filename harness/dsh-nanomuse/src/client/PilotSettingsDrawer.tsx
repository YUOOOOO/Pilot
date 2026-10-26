import { useModalLayer } from '@deepseek-ai/dsh-client-ui-primitives'
import { createElement as h, useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { IconClose } from './icons.tsx'

export function PilotSettingsDrawer({ title, closeLabel, onClose, children }: { title: string; closeLabel: string; onClose(): void; children: ReactNode }): ReactNode {
  const panel = useRef<HTMLDivElement>(null)
  const initialFocus = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useLayoutEffect(() => { initialFocus.current?.focus({ preventScroll: true }) }, [])
  useModalLayer(panel, true, onClose)
  return h('div', { className: 'pilot-settings-drawer-layer' },
    h('div', { className: 'pilot-settings-drawer-mask', 'aria-hidden': true, onClick: onClose }),
    h('div', { ref: panel, className: 'pilot-settings-drawer', tabIndex: -1, role: 'dialog', 'aria-modal': true, 'aria-labelledby': titleId },
      h('div', { ref: initialFocus, tabIndex: -1, 'data-modal-autofocus': '', className: 'pilot-settings-drawer-sentinel' }),
      h('div', { className: 'pilot-settings-drawer-head' },
        h('h2', { id: titleId }, title),
        h('button', { type: 'button', className: 'nm-close', 'aria-label': closeLabel, onClick: onClose }, h(IconClose, { size: 16 }))),
      h('div', { className: 'pilot-settings-drawer-body' }, children)))
}
export const SETTINGS_DRAWER_STYLES = `
.nm-settings-content { position: relative; isolation: isolate; }
.pilot-settings-drawer-layer { position: absolute; inset: 0; z-index: 30; overflow: hidden; border-radius: inherit; }
.pilot-settings-drawer-mask { position: absolute; inset: 0; background: #00000020; }
.pilot-settings-drawer-sentinel { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); border: 0; }
.pilot-settings-drawer { position: absolute; inset: 0 0 0 auto; width: min(560px, 94%); display: flex; flex-direction: column; min-width: 0; background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-primary); box-shadow: -8px 0 32px #00000018; border-left: 1px solid var(--nm-border, #e5e5e5); animation: pilot-settings-slide-in 180ms ease-out both; }
.pilot-settings-drawer-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; flex: none; border-bottom: 1px solid var(--nm-border, #e5e5e5); }
.pilot-settings-drawer-head h2 { font-size: 15px; font-weight: 600; margin: 0; }
.pilot-settings-drawer-body { flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; padding: 20px; }
.pilot-settings-drawer-body > .nm-section { max-width: none; }
.pilot-settings-drawer-body :is(.nm-page, .nm-page-inner) { height: auto; max-width: none; margin: 0; overflow: visible; }
.pilot-settings-drawer-body .nm-page { padding: 0; }
.pilot-settings-drawer-body .nm-page h1 { display: none; }
@keyframes pilot-settings-slide-in { from { transform: translate3d(100%, 0, 0); } to { transform: translate3d(0, 0, 0); } }
@media (prefers-reduced-motion: reduce) { .pilot-settings-drawer { animation: none; } }
@media (max-width: 700px) { .pilot-settings-drawer { width: 100%; } .pilot-settings-drawer-body { padding: 14px; } }
`
