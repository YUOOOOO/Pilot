import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PERMISSION_DETAILS, PERMISSION_SECTION, settingsSurface, visibleSettingsRows } from '../src/client/pilot-settings-navigation.ts'
const rows = ['general', ...PERMISSION_DETAILS, PERMISSION_SECTION, 'nanomuse-help', 'nanomuse-legal', 'nanomuse-media', 'nanomuse-harness', 'agent-presets', 'plugins'].map(id => ({ id, label: id }))

test('permission details and removed pages do not appear in either navigation group', () => {
  assert.deepEqual(visibleSettingsRows(rows).map(row => row.id), ['general', PERMISSION_SECTION, 'agent-presets', 'plugins'])
  assert.equal(rows.length, 15)
})
test('direct links to each permission detail retain the permission page underneath', () => {
  for (const detail of PERMISSION_DETAILS) assert.deepEqual(settingsSurface(rows, detail), { active: PERMISSION_SECTION, detail })
  assert.deepEqual(settingsSurface(rows, PERMISSION_SECTION), { active: PERMISSION_SECTION, detail: undefined })
})
test('removed, unknown or missing destinations resolve to a visible page', () => {
  for (const id of ['nanomuse-help', 'nanomuse-legal', 'nanomuse-media', 'nanomuse-harness', 'missing', undefined]) assert.deepEqual(settingsSurface(rows, id), { active: 'general', detail: undefined })
  assert.deepEqual(settingsSurface([], 'nanomuse-files'), { active: undefined, detail: undefined })
  assert.deepEqual(settingsSurface(rows.filter(row => row.id !== PERMISSION_SECTION), 'nanomuse-files'), { active: 'general', detail: undefined })
})

test('legacy advanced models links resolve to the single models menu', () => {
  const models = [...rows, { id: 'models' }, { id: 'nanomuse-models' }]
  assert.equal(visibleSettingsRows(models).filter(row => row.id === 'models').length, 0)
  assert.equal(visibleSettingsRows(models).filter(row => row.id === 'nanomuse-models').length, 1)
  assert.deepEqual(settingsSurface(models, 'models'), { active: 'nanomuse-models', detail: undefined })
})

test('Harness stays hidden when settings registrations disappear and return', () => {
  for (const snapshot of [rows, rows.filter(row => row.id !== 'nanomuse-harness'), [...rows].reverse(), rows]) {
    assert.ok(!visibleSettingsRows(snapshot).some(row => row.id === 'nanomuse-harness'))
    assert.notEqual(settingsSurface(snapshot, 'nanomuse-harness').active, 'nanomuse-harness')
  }
})
