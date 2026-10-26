import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Translate } from './api.ts'
import { IconCheck, IconFolder, IconMore, IconPin, IconSettings } from './icons.tsx'
import { Sheet } from './ui.tsx'
import { NAV_KEY, readNav, type ListSort, type NavPreferences } from './pilot-list-preferences.ts'
import type { PilotWorkspace } from './pilot-projects.ts'

export function NewSessionIcon({ size = 16 }: { size?: number }): ReactNode {
  return h('svg', { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'M3 3.5h14v11H9l-4 3v-3H3z' }), h('path', { d: 'M10 6v6M7 9h6' }))
}
export function SortIcon(): ReactNode { return h('svg', { width: 16, height: 16, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'M6 16V4M3 7l3-3 3 3M14 4v12M11 13l3 3 3-3' })) }
interface Item { id: string; label: string; icon?: ReactNode; checked?: boolean; danger?: boolean; toggle?: boolean; disabled?: boolean; run(): void }
export function ListMenu({ anchor, title, items, close }: { anchor: HTMLElement; title?: string; items: Item[]; close(): void }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const rect = anchor.getBoundingClientRect()
  useEffect(() => {
    const pointer = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) close() }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); anchor.focus(); return }
      if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return
      const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
      if (!buttons.length) return
      event.preventDefault()
      const i=buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+(event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length]?.focus()
    }
    document.addEventListener('pointerdown',pointer,true);document.addEventListener('keydown',key,true)
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    return () => { document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('keydown',key,true) }
  }, [anchor, close])
  return createPortal(h('div',{ref,className:'pilot-list-menu',role:'menu','aria-label':title,style:{left:Math.max(8,Math.min(rect.right-216,window.innerWidth-224)),top:Math.max(8,Math.min(rect.bottom+5,window.innerHeight-(title?235:200)))}},
    title?h('div',{className:'pilot-list-menu-caption'},title):null,
    items.map(item=>h('button',{key:item.id,type:'button',role:item.toggle?'menuitemcheckbox':item.checked!==undefined?'menuitemradio':'menuitem','aria-checked':item.toggle||item.checked!==undefined?!!item.checked:undefined,disabled:item.disabled,className:`pilot-list-menu-item${item.danger?' pilot-menu-danger':''}${item.toggle?' pilot-menu-toggle':''}`,onClick:()=>{close();item.run()}},item.icon??null,h('span',null,item.label),item.toggle?h('span',{className:`pilot-list-switch${item.checked?' pilot-switch-on':''}`,'aria-hidden':true}):item.checked?h(IconCheck,{size:14}):null))),document.body)
}
export function useNavigationPreferences(): [NavPreferences,(update:(before:NavPreferences)=>NavPreferences)=>void] {
  const [value,setValue]=useState(()=>{try{return readNav(window.localStorage.getItem(NAV_KEY))}catch{return readNav(null)}})
  return [value,update=>setValue(before=>{const next=update(before);try{localStorage.setItem(NAV_KEY,JSON.stringify(next))}catch{}return next})]
}
export function SortMenu({ t, anchor, value, update, close }: { t:Translate;anchor:HTMLElement;value:NavPreferences;update:(update:(before:NavPreferences)=>NavPreferences)=>void;close():void }):ReactNode {
  const keys={updated:'pilotSortUpdated',oldest:'pilotSortOldest',name:'pilotSortName',created:'pilotSortCreated'} as const
  return h(ListMenu,{anchor,title:t('pilotSortTitle'),close,items:[...(['updated','oldest','name','created'] as ListSort[]).map(sort=>({id:sort,label:t(keys[sort]),checked:value.sort===sort,run:()=>update(before=>({...before,sort}))})),{id:'archived',label:t('pilotShowArchived'),checked:value.showArchived,toggle:true,run:()=>update(before=>({...before,showArchived:!before.showArchived}))}]})
}
export function ProjectActions({t,project,pinned,archived,busy,rename,remove,openFolder,pin,archive,newSession}:{t:Translate;project:PilotWorkspace;pinned:boolean;archived:boolean;busy:boolean;rename(title:string):Promise<void>;remove():Promise<void>;openFolder():Promise<void>;pin():void;archive():void;newSession?:()=>Promise<void>}):ReactNode {
  const [anchor,setAnchor]=useState<HTMLElement|null>(null)
  const [dialog,setDialog]=useState<'edit'|'delete'|null>(null)
  const [title,setTitle]=useState(project.title)
  const [error,setError]=useState('')
  const [pending,setPending]=useState(false)
  const run=async(work:()=>Promise<void>)=>{setPending(true);setError('');try{await work();setDialog(null)}catch(e){setError(String(e))}finally{setPending(false)}}
  const deleteIcon=h('svg',{width:15,height:15,viewBox:'0 0 20 20',fill:'none',stroke:'currentColor',strokeWidth:1.3,'aria-hidden':true},h('path',{d:'M4 5h12M8 3h4M6 5v12h8V5M9 8v6M11 8v6'}))
  const archiveIcon=h('svg',{width:15,height:15,viewBox:'0 0 20 20',fill:'none',stroke:'currentColor',strokeWidth:1.2,'aria-hidden':true},h('path',{d:'M3 3h14v4H3zM5 7v10h10V7M8 10h4'}))
  return h('div',{className:'pilot-project-actions pilot-hover-actions'},
    h('button',{type:'button',className:'nm-icon-btn nm-icon-btn-sm','aria-label':t('pilotProjectMenu'),'aria-haspopup':'menu','aria-expanded':!!anchor,disabled:busy||pending,onClick:(e:React.MouseEvent<HTMLButtonElement>)=>setAnchor(anchor?null:e.currentTarget)},h(IconMore,{size:16})),
    newSession&&!archived?h('button',{type:'button',className:'nm-icon-btn nm-icon-btn-sm','aria-label':t('pilotNewProjectChat'),title:t('pilotNewProjectChat'),disabled:busy||pending,onClick:()=>{void run(newSession)}},h(NewSessionIcon,{size:16})):null,
    anchor?h(ListMenu,{anchor,close:()=>setAnchor(null),items:[
      {id:'folder',label:t('pilotProjectFolder'),icon:h(IconFolder,{size:15}),run:()=>{void run(openFolder)}},
      {id:'edit',label:t('pilotProjectEdit'),icon:h(IconSettings,{size:15}),run:()=>{setTitle(project.title);setError('');setDialog('edit')}},
      {id:'pin',label:t(pinned?'pilotProjectUnpin':'pilotProjectPin'),icon:h(IconPin,{size:15}),run:pin},
      {id:'archive',label:t(archived?'pilotProjectRestore':'pilotProjectArchive'),icon:archiveIcon,run:archive},
      {id:'delete',label:t('pilotProjectDelete'),icon:deleteIcon,danger:true,run:()=>{setError('');setDialog('delete')}},
    ]}):null,
    dialog?h(Sheet,{title:t(dialog==='edit'?'pilotProjectEdit':'pilotProjectDelete'),closeLabel:t('close'),onClose:()=>{if(!pending)setDialog(null)},footer:h('div',{className:'pilot-project-dialog-actions'},h('button',{type:'button',className:'nm-pill nm-pill-ghost',disabled:pending,onClick:()=>setDialog(null)},t('pilotCancel')),h('button',{type:'button',className:`nm-pill${dialog==='delete'?' pilot-delete-confirm':''}`,disabled:pending||(dialog==='edit'&&!title.trim()),onClick:()=>{void run(dialog==='edit'?()=>rename(title.trim()):remove)}},t(dialog==='edit'?'pilotSave':'pilotProjectDelete')))},
      dialog==='edit'?h('label',{className:'pilot-project-edit-label'},t('pilotProjectName'),h('input',{className:'nm-field',autoFocus:true,value:title,disabled:pending,onChange:(e:React.ChangeEvent<HTMLInputElement>)=>setTitle(e.currentTarget.value)}),h('p',{className:'pilot-project-path'},project.path))
      :h('p',null,t('pilotProjectDeleteConfirm',{name:project.title})),
      error?h('div',{role:'alert',className:'pilot-project-error'},error):null):null,
    !dialog&&error?h('span',{role:'alert',className:'pilot-project-action-error',title:error},'!'):null)
}
export const LIST_MENU_STYLES=`
.pilot-hover-actions{display:inline-flex;align-items:center;gap:2px;opacity:0;pointer-events:none;transition:opacity 100ms ease}
.nm-chats-section:hover>.pilot-hover-actions,.nm-chats-section:focus-within>.pilot-hover-actions,.pilot-project-toggle:hover>.pilot-hover-actions,.pilot-project-toggle:focus-within>.pilot-hover-actions,.pilot-hover-actions:has([aria-expanded=true]){opacity:1;pointer-events:auto}
.pilot-hover-actions button{color:var(--pilot-list-muted,#737373);width:23px;height:23px;flex:none}
.pilot-hover-actions button:focus-visible{opacity:1;outline:2px solid #8ca8cd;outline-offset:-2px}
.pilot-list-menu{position:fixed;z-index:180;min-width:216px;padding:6px;border:1px solid #e8e8e8;border-radius:14px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#333);box-shadow:0 8px 28px #00000014;font-family:'Segoe UI','Microsoft YaHei UI',system-ui,sans-serif}
.pilot-list-menu-caption{padding:3px 7px 6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#777)}
.pilot-list-menu-item{display:flex;align-items:center;gap:8px;width:100%;min-height:32px;padding:6px 8px;border:0;border-radius:9px;background:transparent;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer}
.pilot-list-menu-item>span:first-of-type{flex:1}.pilot-list-menu-item:hover,.pilot-list-menu-item:focus-visible,.pilot-list-menu-item[aria-checked=true]:not(.pilot-menu-toggle){background:var(--nm-hover,#f3f3f3);outline:none}
.pilot-list-menu-item:disabled{opacity:.45;cursor:default}.pilot-menu-danger{color:#e13d36}.pilot-menu-toggle{margin-top:7px;border-top:1px solid var(--nm-border,#eee);border-radius:0 0 9px 9px;padding-top:9px}
.pilot-list-switch{width:26px;height:15px;border-radius:8px;background:#dedede;position:relative;flex:none!important}.pilot-list-switch::after{content:'';position:absolute;width:11px;height:11px;left:2px;top:2px;background:white;border-radius:50%;box-shadow:0 1px 2px #0002}.pilot-switch-on{background:#4d76a4}.pilot-switch-on::after{left:13px}
.pilot-sidebar .pilot-project-toggle .pilot-project-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pilot-sidebar button.pilot-project-toggle>svg{flex:none;color:var(--pilot-list-muted)}
.pilot-project-toggle>.pilot-project-actions{flex:none;margin-left:2px}.pilot-project-dialog-actions{display:flex;justify-content:flex-end;gap:8px}.pilot-project-edit-label{display:flex;flex-direction:column;gap:8px;font-size:13px}.pilot-project-path{font-size:12px;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}.pilot-delete-confirm{background:#d6453d!important;color:white!important}.pilot-project-action-error{color:#c13030}
.pilot-archived-project{opacity:.65}.pilot-project-pin-mark{width:5px;height:5px;flex:none;border-radius:50%;background:var(--pilot-list-muted,#737373)}
.pilot-sidebar .nm-chat-row.nm-archived .nm-chat-title{color:#999}
body[data-ds-dark-theme] .pilot-sidebar .nm-chat-row.nm-archived .nm-chat-title{color:#858585}
@media(hover:none){.pilot-hover-actions{opacity:1;pointer-events:auto}}
`
