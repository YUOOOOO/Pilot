import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveMainSessionId, sessionRowLabel } from '../src/client/pilot-session-label.ts'

const labels = { mainLabel: 'nexo', blankLabel: '新聊天', synced: false, placeholderTitle: true }

test('nexo stays nexo even when the session has a content title', () => {
  assert.equal(sessionRowLabel({ id: 'm', displayTitle: '帮我改布局', blank: false, updatedAt: 1 }, { ...labels, main: true }), 'nexo')
})

test('a new side session uses the list blank title instead of the workspace name', () => {
  assert.equal(sessionRowLabel({ id: 's', displayTitle: 'default-workspace', blank: true, updatedAt: 2 }, { ...labels, main: false }), '新聊天')
  assert.equal(sessionRowLabel({ id: 's', displayTitle: 'default-workspace', blank: false, updatedAt: 2 }, { ...labels, main: false }), '新聊天')
})

test('a named side session keeps the same title as the list', () => {
  assert.equal(sessionRowLabel({ id: 's', displayTitle: '修登录', blank: false, updatedAt: 3 }, { ...labels, main: false, synced: true }), '修登录')
})

test('the synced main session is nexo ahead of a newer chat', () => {
  const rows = [
    { id: 'old', displayTitle: '旧', blank: false, updatedAt: 1 },
    { id: 'main', displayTitle: '内容标题', blank: false, updatedAt: 9 },
  ]
  assert.equal(resolveMainSessionId(rows, 'main', 'old', 'old', new Set()), 'main')
})
