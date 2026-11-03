import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPilotHandler } from '../packages/dsh-pilot/src/host/routes.mjs';

/** 最小宿主文档替身：只保留路由用到的 snapshot/mutate。 */
function fakeStore(initial) {
  const doc = { version: 1, settings: { ...initial }, tasks: {}, updatedAt: 't0' };
  return {
    snapshot: () => doc,
    mutate: async (change) => {
      change(doc);
      doc.updatedAt = 't1';
      return doc;
    },
  };
}

async function withServer(store, run) {
  const server = http.createServer(createPilotHandler(store, () => ({ name: 'Pilot' })));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/pilot`;
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const putSettings = (base, body) => fetch(`${base}/settings`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}).then(response => response.json());

test('settings PUT merges a partial payload', async () => {
  const store = fakeStore({ defaultPage: 'workbench', compact: 'auto' });
  await withServer(store, async (base) => {
    const saved = await putSettings(base, { compact: 'always' });
    assert.equal(saved.settings.compact, 'always');
    assert.equal(saved.settings.defaultPage, 'workbench');
  });
});

test('settings PUT with an empty payload clears instead of no-op merging', async () => {
  const store = fakeStore({ compact: 'always', showKeys: false });
  await withServer(store, async (base) => {
    const saved = await putSettings(base, {});
    assert.deepEqual(saved.settings, {});
    assert.deepEqual(store.snapshot().settings, {});
  });
});

test('settings PUT drops unknown shapes and keeps primitives', async () => {
  const store = fakeStore({});
  await withServer(store, async (base) => {
    const saved = await putSettings(base, { motion: 'off', nested: { a: 1 }, 'bad key': 1, list: ['a', 2] });
    assert.deepEqual(saved.settings, { motion: 'off', list: ['a', 2] });
  });
});
