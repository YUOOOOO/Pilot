import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import vm from 'node:vm'

// Render the actual sidebar component with deterministic hook state and inert external services.
// Event handlers are exercised directly; no Host data is changed by these regressions.
async function sidebar({ projects = [], sessions = [], archived = [], projectIds = [] } = {}) {
  const cells = new Map()
  let scope = '', cursor = 0
  const react = {
    createElement(type, props, ...children) { return { type, props: { ...props, children } } },
    useState(initial) {
      const key = `${scope}:${cursor++}`
      if (!cells.has(key)) cells.set(key, typeof initial === 'function' ? initial() : initial)
      return [cells.get(key), value => cells.set(key, typeof value === 'function' ? value(cells.get(key)) : value)]
    },
    useRef(value) { return { current: value } },
    useEffect() {},
  }
  const result = await build({
    stdin: { contents: "export { MuseChats } from './src/client/MuseChats.tsx'; export { peekWin } from './src/client/win.ts'", resolveDir: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), loader: 'tsx' },
    bundle: true, write: false, format: 'cjs', platform: 'node',
    plugins: [{ name: 'sidebar-services', setup(b) {
      b.onResolve({ filter: /^(react|\.\/live\.ts|\.\/rooms\.ts|\.\/PilotListMenus\.tsx)$/ }, a => ({ path: a.path, namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: a.path === 'react'
        ? 'module.exports=globalThis.fixtureReact'
        : a.path.endsWith('live.ts') ? 'exports.useLive=()=>({})'
        : a.path.endsWith('rooms.ts') ? 'exports.useRooms=()=>({batches:[]});exports.roomsCall=async()=>({createdAt:{}})'
        : 'exports.LIST_MENU_STYLES="";exports.useNavigationPreferences=()=>[{sort:"updated",pinnedProjects:[],archivedProjects:[],showArchived:false},()=>{}];exports.ProjectActions=()=>null;exports.NewSessionIcon=()=>null;exports.SortIcon=()=>null;exports.SortMenu=()=>null' }))
    } }],
  })
  const storage = new Map([['nanomuse.mainChat', 'main'], ['pilot.projects.v1', JSON.stringify(projectIds)]])
  // Use the exported key rather than depending on the storage key's spelling.
  const { PROJECTS_KEY } = await import('../src/client/pilot-projects.ts')
  storage.set(PROJECTS_KEY, JSON.stringify(projectIds))
  const context = { module: { exports: {} }, fixtureReact: react, window: { localStorage: { getItem: key => storage.get(key) ?? null }, innerHeight: 900 }, console }
  vm.runInNewContext(result.outputFiles[0].text, context)
  const calls = []
  const actions = Object.fromEntries(['openSession', 'archiveSession', 'restoreSession', 'pinSession', 'unpinSession', 'renameSession'].map(name => [name, id => { calls.push([name, id]); return Promise.resolve() }]))
  actions.startSession = () => calls.push(['startSession'])
  const main = { id: 'main', displayTitle: 'Main', blank: false, updatedAt: 1, retainedBy: {}, running: false }
  const state = { phase: 'ready', ids: ['main', ...sessions.map(s => s.id)], byId: Object.fromEntries([main, ...sessions].map(s => [s.id, s])) }
  function expand(node, path = 'root') {
    if (Array.isArray(node)) return node.flatMap((n, i) => expand(n, `${path}/${i}`))
    if (!node || typeof node !== 'object') return []
    if (typeof node.type === 'function') {
      scope = path; cursor = 0
      return expand(node.type(node.props), `${path}/component`)
    }
    return [{ ...node, children: expand(node.props.children, `${path}/children`) }]
  }
  function render() {
    return expand(react.createElement(context.module.exports.MuseChats, {
      t: key => key, useSessions: select => select(state),
      useWorkspaces: select => select({ items: projects, archivedSessionIds: archived, pinnedSessionIds: [] }), actions,
    }))
  }
  const flatten = nodes => nodes.flatMap(n => [n, ...flatten(n.children)])
  return { render: () => flatten(render()), calls, editor: () => context.module.exports.peekWin().editor }
}
const blank = id => ({ id, displayTitle: '', blank: true, updatedAt: 2, retainedBy: {}, running: false })
test('all blank ordinary sessions stay in the sidebar, including inactive ones', async () => {
  const fixture = await sidebar({ sessions: ['a', 'b', 'c'].map(blank) })
  assert.deepEqual(fixture.render().filter(n => n.props['data-session-id']).map(n => n.props['data-session-id']).sort(), ['a', 'b', 'c', 'main'])
})
test('archived row remains visible; clicking only opens; its menu restores instead of archiving', async () => {
  const fixture = await sidebar({ sessions: [blank('a')], archived: ['a'] })
  const row = fixture.render().find(n => n.props['data-session-id'] === 'a')
  assert.match(row.props.className, /nm-archived/)
  row.children.find(n => n.props.className === 'nm-chat-open').props.onClick()
  assert.deepEqual(fixture.calls, [['openSession', 'a']])
  const more = row.children.find(n => n.props.className === 'nm-chat-more')
  more.props.ref({ getBoundingClientRect: () => ({ left: 20, top: 20, bottom: 40 }) })
  more.props.onClick()
  const menu = fixture.render().filter(n => n.props.role === 'menuitem')
  assert.ok(menu.some(n => n.props.children[0]?.props.children[0] === 'chRestore'))
  assert.ok(!menu.some(n => n.props.children[0]?.props.children[0] === 'chArchive'))
  menu.find(n => n.props.children[0]?.props.children[0] === 'chRestore').props.onClick()
  assert.deepEqual(fixture.calls.at(-1), ['restoreSession', 'a'])
})
test('empty projects have a hint, and registered projects replace it', async () => {
  const empty = await sidebar()
  assert.ok(empty.render().some(n => n.props.className === 'nm-chats-empty pilot-projects-empty'))
  const populated = await sidebar({ projects: [{ workspaceId: 'p', title: 'P', path: '/p', sessionIds: ['a'] }], projectIds: ['p'], sessions: [blank('a')], archived: ['a'] })
  const nodes = populated.render()
  assert.ok(!nodes.some(n => n.props.className === 'nm-chats-empty pilot-projects-empty'))
  assert.equal(nodes.filter(n => n.props['data-session-id'] === 'a').length, 1)
  assert.match(nodes.find(n => n.props['data-session-id'] === 'a').props.className, /nm-archived/)
})
test('main row is fixed-label navigation without a duplicate group heading or rename entry', async () => {
  const fixture = await sidebar({ sessions: [blank('a')] })
  const nodes = fixture.render()
  const main = nodes.find(n => n.props['data-session-id'] === 'main')
  assert.ok(!nodes.some(n => n.props.className === 'nm-chats-section' && n.props.children.some(child => child?.props?.children?.includes('nexo'))))
  assert.ok(main.children.some(n => n.props.className === 'nm-chat-more'))
  main.children.find(n => n.props.className === 'nm-chat-open').props.onDoubleClick()
  assert.ok(!fixture.render().some(n => n.props.className === 'nm-chat-edit'))
  assert.deepEqual(fixture.calls, [])
  const side = fixture.render().find(n => n.props['data-session-id'] === 'a')
  side.children.find(n => n.props.className === 'nm-chat-open').props.onDoubleClick()
  assert.ok(fixture.render().some(n => n.props.className === 'nm-chat-edit'))
})
test('ordinary session menu omits the make-main action', async () => {
  const fixture = await sidebar({ sessions: [blank('a')] })
  const row = fixture.render().find(n => n.props['data-session-id'] === 'a')
  const more = row.children.find(n => n.props.className === 'nm-chat-more')
  more.props.ref({ getBoundingClientRect: () => ({ left: 20, top: 20, bottom: 40 }) })
  more.props.onClick()
  const menu = fixture.render().filter(n => n.props.role === 'menuitem')
  assert.ok(menu.some(n => n.props.children[0]?.props.children[0] === 'chRename'))
  assert.ok(!menu.some(n => n.props.children[0]?.props.children[0] === 'chMakeMain'))
})
test('nexo menu opens the three existing personal document editors without session mutations', async () => {
  const fixture = await sidebar()
  for (const doc of ['identity', 'soul', 'memory']) {
    const main = fixture.render().find(n => n.props['data-session-id'] === 'main')
    const more = main.children.find(n => n.props.className === 'nm-chat-more')
    more.props.ref({ getBoundingClientRect: () => ({ left: 20, top: 20, bottom: 40 }) })
    more.props.onClick()
    const menu = fixture.render().filter(n => n.props.role === 'menuitem')
    assert.deepEqual(menu.map(n => n.props.children[0]?.props.children[0]), ['IDENTITY.md', 'SOUL.md', 'MEMORY.md'])
    menu.find(n => n.props.children[0]?.props.children[0] === `${doc.toUpperCase()}.md`).props.onClick()
    assert.equal(fixture.editor().kind, 'own')
    assert.equal(fixture.editor().doc, doc)
  }
  assert.deepEqual(fixture.calls, [])
})
