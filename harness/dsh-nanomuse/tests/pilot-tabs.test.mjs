import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readTabs, reduceTabs } from '../src/client/pilot-tabs-state.ts'

const state = { ids: ['a', 'b', 'c', 'd'], active: 'b' }

test('tab preferences sanitize duplicate and invalid ids without inventing sessions', () => {
  assert.deepEqual(readTabs('bad'), { ids: [], active: null })
  assert.deepEqual(readTabs('{"ids":["a",null,"a","b",3,""],"active":"removed"}'), { ids: ['a', 'b'], active: 'a' })
})

test('opening an existing tab activates it without changing the order', () => {
  assert.deepEqual(reduceTabs(state, { type: 'open', id: 'c' }), { ids: ['a', 'b', 'c', 'd'], active: 'c' })
  assert.deepEqual(reduceTabs(state, { type: 'open', id: 'e' }), { ids: ['a', 'b', 'c', 'd', 'e'], active: 'e' })
})

test('dragging inserts on the requested side while preserving active selection', () => {
  assert.deepEqual(reduceTabs(state, { type: 'move', id: 'd', target: 'a', after: false }), { ids: ['d', 'a', 'b', 'c'], active: 'b' })
  assert.deepEqual(reduceTabs(state, { type: 'move', id: 'a', target: 'c', after: true }), { ids: ['b', 'c', 'a', 'd'], active: 'b' })
  assert.equal(reduceTabs(state, { type: 'move', id: 'outside', target: 'c', after: false }), state)
})

test('closing current falls right, then left, and preserves the other tabs', () => {
  assert.deepEqual(reduceTabs(state, { type: 'close', id: 'b', mode: 'current' }), { ids: ['a', 'c', 'd'], active: 'c' })
  assert.deepEqual(reduceTabs({ ...state, active: 'd' }, { type: 'close', id: 'd', mode: 'current' }), { ids: ['a', 'b', 'c'], active: 'c' })
  assert.deepEqual(reduceTabs(state, { type: 'close', id: 'd', mode: 'current' }), { ids: ['a', 'b', 'c'], active: 'b' })
})

test('right-click bulk actions are relative to clicked tab, not necessarily active tab', () => {
  assert.deepEqual(reduceTabs(state, { type: 'close', id: 'c', mode: 'others' }), { ids: ['c'], active: 'c' })
  assert.deepEqual(reduceTabs(state, { type: 'close', id: 'a', mode: 'right' }), { ids: ['a'], active: 'a' })
  assert.deepEqual(reduceTabs(state, { type: 'close', id: 'c', mode: 'right' }), { ids: ['a', 'b', 'c'], active: 'b' })
  assert.deepEqual(reduceTabs(state, { type: 'close', id: 'a', mode: 'all' }), { ids: [], active: null })
  assert.deepEqual(state, { ids: ['a', 'b', 'c', 'd'], active: 'b' })
})

test('last-tab close is empty and removed sessions are pruned safely', () => {
  assert.deepEqual(reduceTabs({ ids: ['a'], active: 'a' }, { type: 'close', id: 'a', mode: 'current' }), { ids: [], active: null })
  assert.deepEqual(reduceTabs(state, { type: 'retain', ids: ['a', 'c'] }), { ids: ['a', 'c'], active: 'c' })
})
