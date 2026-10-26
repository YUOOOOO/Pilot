/** Pilot's presentation layer. Execution, approval and settings services remain upstream. */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import type { Translate } from './api.ts'
import { createPortal } from 'react-dom'

export function PilotHome({ t }: { t: Translate }): ReactNode {
  const [bounds, setBounds] = useState({ left: 280, width: Math.max(0, window.innerWidth - 280), top: window.innerHeight / 2 })
  useEffect(() => {
    const update = () => {
      const content = document.querySelector('[data-conversation-content]')?.getBoundingClientRect()
      const composer = document.querySelector('[class*="_composerSeat"]')?.getBoundingClientRect()
      if (content) setBounds({ left: content.left, width: content.width, top: (content.top + (composer && composer.top > content.top ? composer.top : content.bottom)) / 2 })
    }
    const observer = new ResizeObserver(update)
    for (const element of document.querySelectorAll('[data-conversation-content], [class*="_composerSeat"], .nm-sidebar')) observer.observe(element)
    update()
    window.addEventListener('resize', update)
    return () => { observer.disconnect(); window.removeEventListener('resize', update) }
  }, [])
  return createPortal(h('div', { className: 'pilot-home', style: { position: 'fixed', left: bounds.left, width: bounds.width, top: bounds.top, transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', pointerEvents: 'none', zIndex: 0, color: 'var(--dsw-alias-label-primary)' } },
    h('div', { style: { marginBottom: 22, display: 'flex', justifyContent: 'center' } }, h(PilotMark, { size: 40 })),
    h('h1', { className: 'pilot-home-title' }, t('pilotWelcome')),
    h('p', { className: 'pilot-home-sub' }, t('pilotWelcomeSub'))), document.body)
}


export function PilotMark({ size = 28 }: { size?: number }): ReactNode {
  return h('svg', { width: size, height: size, viewBox: '0 0 32 32', fill: 'none', role: 'img', 'aria-label': 'Pilot' },
    h('rect', { x: 1, y: 1, width: 30, height: 30, rx: 9, fill: 'currentColor' }),
    h('path', { d: 'M10 22V10h7a4 4 0 0 1 0 8h-3', stroke: 'var(--pilot-mark-ink, white)', strokeWidth: 2.3, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    h('path', { d: 'm18 22 4-4', stroke: 'var(--pilot-mark-ink, white)', strokeWidth: 2.3, strokeLinecap: 'round' }))
}

export const PILOT_STYLES = `
.nm-sidebar.pilot-sidebar { --pilot-mark-ink: #fff; --nm-rail-w: 52px; --pilot-list-bg: #f3f3f3; --pilot-list-text: #404040; --pilot-list-muted: #626262; --pilot-list-selected: #e2e2e2; --pilot-list-selected-text: #242424; --pilot-list-hover: #eaeaea; background: var(--pilot-list-bg); border-right: 1px solid var(--nm-border, #e5e5e2); font-family: 'Segoe UI', 'Microsoft YaHei UI', system-ui, sans-serif; }
.pilot-sidebar .nm-rail { width: 52px; min-width: 52px; padding: 12px 6px 10px; gap: 7px; background: transparent; border-right: 1px solid var(--nm-border, #e5e5e2); }
html[data-nanomuse] [class*='_frame'] > [data-side='sidebar'] { display: block; -webkit-app-region: no-drag; }
.pilot-sidebar { box-sizing: border-box; }
.pilot-sidebar .nm-rail { box-sizing: border-box; flex: 0 0 52px; }
.pilot-sidebar .nm-rail-top { height: 12px; }
.pilot-rail-brand { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; color: var(--dsw-alias-label-primary, #252525); margin: 3px 0 14px; }
.pilot-sidebar .nm-rail-btn { width: 38px; height: 38px; border-radius: 10px; color: var(--dsw-alias-label-secondary, #666); }
.pilot-sidebar .nm-rail-btn[aria-current='page'] { background: var(--pilot-list-selected); color: var(--pilot-list-selected-text); }
.pilot-sidebar .nm-col { background: transparent; min-width: 0; color: var(--pilot-list-text); }
.pilot-sidebar .nm-col-top { height: 0; }
.pilot-column-brand { display: flex; align-items: center; justify-content: space-between; height: 62px; padding: 0 20px; font-size: 16px; font-weight: 650; letter-spacing: -.35px; color: var(--dsw-alias-label-primary); -webkit-app-region: drag; }
.pilot-column-brand span:last-child { font-size: 10px; letter-spacing: 1.2px; font-weight: 500; color: var(--dsw-alias-label-tertiary, #969691); }
.pilot-sidebar .nm-chats-head { padding: 0 10px; justify-content: flex-end; height: 24px; }
.pilot-sidebar .nm-chats-list { padding: 0 5px 20px; }
.pilot-sidebar .nm-chats-section { padding: 12px 6px 5px; min-height: 24px; font-size: 12px; line-height: 18px; font-weight: 400; letter-spacing: 0; color: var(--pilot-list-muted); }
.pilot-sidebar .nm-chat-row { height: 28px; min-height: 28px; border-radius: 14px; margin: 0; color: var(--pilot-list-text); background: transparent; }
.pilot-sidebar .nm-chats-list > .nm-chat-row { margin-left: 14px; }
.pilot-sidebar .nm-chat-row:hover { background: var(--pilot-list-hover); }
.pilot-sidebar .nm-chat-open { height: 28px; min-height: 28px; padding: 0 9px; gap: 6px; font-family: inherit; font-size: 12px; line-height: 28px; font-weight: 400; letter-spacing: 0; color: inherit; }
.pilot-sidebar .nm-chat-title, .pilot-sidebar .nm-chat-row.nm-main .nm-chat-title { font-size: 12px; line-height: 18px; font-weight: 400; letter-spacing: 0; color: inherit; }
.pilot-sidebar .nm-chat-row.nm-selected, .pilot-sidebar .nm-chat-row.nm-selected:hover { background: var(--pilot-list-selected); color: var(--pilot-list-selected-text); }
.pilot-sidebar .nm-chat-more { width: 22px; height: 24px; color: var(--pilot-list-muted); }
.pilot-sidebar .nm-chat-edit { height: 26px; font-family: inherit; font-size: 12px; font-weight: 400; color: var(--pilot-list-text); }
.pilot-sidebar .nm-chats-empty { padding: 4px 9px 8px 20px; font-size: 12px; line-height: 20px; font-weight: 400; color: var(--pilot-list-muted); opacity: 1; }
.pilot-sidebar .nm-col-foot { border-top: 0; padding: 12px 18px; font-size: 11px; color: var(--dsw-alias-label-tertiary, #969691); }
.pilot-sidebar div.pilot-project-toggle { display: flex; align-items: center; width: 100%; height: 28px; min-width: 0; gap: 0; padding: 0; color: var(--pilot-list-text); }
.pilot-sidebar button.pilot-project-toggle { display: flex; flex: 1; align-items: center; min-width: 0; height: 28px; gap: 6px; border: 0; background: transparent; color: inherit; text-align: left; padding: 0 6px; border-radius: 7px; font-family: inherit; font-size: 12px; line-height: 28px; font-weight: 400; letter-spacing: 0; cursor: pointer; }
.pilot-sidebar button.pilot-project-toggle:hover { background: var(--pilot-list-hover); }
.pilot-sidebar .pilot-project-toggle span:nth-child(2) { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; flex: 1; }
.pilot-sidebar .pilot-project-toggle > span:first-child { color: var(--pilot-list-muted); font-size: 11px; }
.pilot-sidebar .pilot-project-toggle .nm-icon-btn { margin-left: auto; color: var(--pilot-list-muted); }
.pilot-sidebar .pilot-project-sessions { padding-left: 0; border-left: 0; margin-left: 17px; }
.pilot-project-error { font-size: 12px; padding: 7px 11px; color: #b42318; }
body[data-ds-dark-theme] .pilot-sidebar { --pilot-list-bg: #252525; --pilot-list-text: #d1d1d1; --pilot-list-muted: #ababab; --pilot-list-selected: #3b3b3b; --pilot-list-selected-text: #ededed; --pilot-list-hover: #303030; }
.pilot-header.nm-header { position: static; transform: none; width: auto; min-height: 58px; flex-direction: row; align-items: center; gap: 10px; padding: 0 22px; text-align: left; color: var(--dsw-alias-label-primary); }
.pilot-header .nm-header-name { font-size: 13px; font-weight: 550; margin: 0; }
.pilot-header .nm-header-status { position: static; transform: none; width: auto; font-size: 11px; margin: 0 0 0 7px; }
html[data-nm-muse] [data-slot='conversation.header']:has(.pilot-header) { min-height: 58px; background: var(--dsw-alias-bg-base); border-bottom: 1px solid var(--nm-border); }
html[data-nm-muse] [data-slot='conversation.header']:has(.pilot-header) ~ [data-conversation-content] > [data-conversation-scroll] { padding-top: 20px; }
html[data-nm-muse] [data-conversation-content] { position: relative; }
html[data-nm-muse] [class*="_composerHero"] > [class*="_root"]:first-child:has(.pilot-home-title) { display: flex; position: fixed; top: 29vh; left: var(--pilot-sidebar-width, 280px); width: calc(100vw - var(--pilot-sidebar-width, 280px)); justify-content: center; pointer-events: none; }
html[data-nm-muse] [class*="_composerHero"] [class*="_titleGroup"] { display: none; }
.pilot-home-title { font-size: 28px; font-weight: 550; letter-spacing: -.7px; margin: 0 0 12px; }
.pilot-home-sub { font-size: 13px; color: var(--dsw-alias-label-secondary); margin: 0; line-height: 1.8; }
@media screen { html[data-nanomuse] .nm-doc { inset: max(40px, env(titlebar-area-height, 40px)) 0 0 var(--pilot-sidebar-width, 280px); min-width: 0; } }
html[data-nanomuse]:is([data-nm-platform='darwin'], [data-nm-platform='win32']) .nm-doc-bar { -webkit-app-region: no-drag; }
/* Keep the upstream turn navigator interactive on the left, including narrower content columns. */
html[data-nanomuse] [data-conversation-content] nav[class*='_frame']:has(> [class*='_scroller']) { display: block; left: 12px; right: auto; -webkit-app-region: no-drag; }
html[data-nanomuse] [data-conversation-content] nav[class*='_frame']:has(> [class*='_scroller']) [class*='_mark']::before { left: 0; right: auto; transform-origin: 0%; }
html[data-nanomuse] [data-conversation-content] nav[class*='_frame']:has(> [class*='_scroller']) [role='tooltip'] { left: calc(100% + 10px); right: auto; }
body[data-ds-dark-theme], body[data-ds-dark-theme] .pilot-sidebar { --pilot-mark-ink: #202020; }
`
