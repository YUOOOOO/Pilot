import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readProjectIds, projectSessions } from '../src/client/pilot-projects.ts'

test('Pilot project preference rejects malformed data and deduplicates ids', () => {
  assert.deepEqual(readProjectIds({ getItem: () => '{broken' }), [])
  assert.deepEqual(readProjectIds({ getItem: () => '{"workspaceId":"x"}' }), [])
  assert.deepEqual(readProjectIds({ getItem: () => '["a","a",null,3,"","b"]' }), ['a', 'b'])
})

test('project grouping follows DSH membership without taking the default or another workspace', () => {
  const workspaces = [
    { workspaceId: 'default', path: 'C:/default', title: 'Default', sessionIds: ['main', 'side'] },
    { workspaceId: 'a', path: 'C:/a', title: 'A', sessionIds: ['a-1', 'a-2'] },
    { workspaceId: 'b', path: 'C:/b', title: 'B', sessionIds: ['b-1'] },
  ]
  assert.deepEqual([...projectSessions(workspaces, ['a'])], ['a-1', 'a-2'])
  assert.deepEqual([...projectSessions(workspaces, ['a', 'b'])], ['a-1', 'a-2', 'b-1'])
  assert.deepEqual([...projectSessions(workspaces, ['removed'])], [])
  assert.equal(projectSessions(workspaces, ['a', 'b']).has('main'), false)
})
