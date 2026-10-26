import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listAgentPresets, selectSessionAgentPreset } from '../src/client/pilot-agent-presets.ts'

test('agent mode choices come from the host including custom names', async () => {
  const presets = [{ id: 'standard' }, { id: 'custom', name: 'My mode', description: 'Local tools' }]
  assert.deepEqual(await listAgentPresets({ list: async () => ({ ok: true, value: { presets } }) }), presets)
  await assert.rejects(listAgentPresets({ list: async () => ({ ok: false, error: { message: 'Roster unavailable' } }) }), /Roster unavailable/)
})
test('mode selection targets exactly the supplied session and does not write defaults', async () => {
  const calls = []
  const remote = { select: async (...args) => { calls.push(args); return { ok: true, value: args[1] } } }
  assert.equal(await selectSessionAgentPreset(remote, 'session-a', 'ptc'), 'ptc')
  assert.equal(await selectSessionAgentPreset(remote, 'session-b', 'minimal'), 'minimal')
  assert.deepEqual(calls, [['session-a', 'ptc'], ['session-b', 'minimal']])
})
test('host refuses a locked mode without returning a false success', async () => {
  await assert.rejects(selectSessionAgentPreset({ select: async () => ({ ok: false, error: { message: 'Cannot switch', details: { reason: 'Session already has history' } } }) }, 'session-a', 'ptc'), /Session already has history/)
  await assert.rejects(selectSessionAgentPreset({ select: async () => ({ ok: false, error: { message: 'Mode was removed' } }) }, 'session-a', 'ptc'), /Mode was removed/)
})
test('missing session targets never reach the host and network failures propagate', async () => {
  let calls = 0
  const remote = { select: async () => { calls++; throw new Error('Offline') } }
  await assert.rejects(selectSessionAgentPreset(remote, '', 'ptc'))
  await assert.rejects(selectSessionAgentPreset(remote, 'session-a', ''))
  assert.equal(calls, 0)
  await assert.rejects(selectSessionAgentPreset(remote, 'session-a', 'ptc'), /Offline/)
})
