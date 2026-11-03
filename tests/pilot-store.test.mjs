import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PilotStore, defaultDocument, DOCUMENT_VERSION } from '../packages/dsh-pilot/src/host/store.mjs';

async function tempFile() {
  const directory = await mkdtemp(join(tmpdir(), 'pilot-store-'));
  return join(directory, 'storages', 'dsh-pilot', 'pilot.json');
}

test('seeds a versioned document on first open and persists mutations', async () => {
  const file = await tempFile();
  const store = await new PilotStore(file).open();
  assert.equal(store.snapshot().version, DOCUMENT_VERSION);
  assert.deepEqual(store.snapshot().settings, {});

  await store.mutate(draft => {
    draft.settings.defaultPage = 'tools';
    draft.tasks['task-1'] = { id: 'task-1', title: '写存储层', status: 'doing', note: '', createdAt: 'x', updatedAt: 'x' };
  });
  await store.close();

  const reopened = await new PilotStore(file).open();
  const snapshot = reopened.snapshot();
  assert.equal(snapshot.settings.defaultPage, 'tools');
  assert.equal(snapshot.tasks['task-1'].title, '写存储层');
  assert.equal(snapshot.tasks['task-1'].status, 'doing');
  await reopened.close();

  const onDisk = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(onDisk.tasks['task-1'].title, '写存储层');
});

test('serializes concurrent mutations so no write is lost', async () => {
  const file = await tempFile();
  const store = await new PilotStore(file).open();
  await Promise.all(Array.from({ length: 12 }, (_, index) => store.mutate(draft => {
    draft.tasks[`task-${index}`] = { id: `task-${index}`, title: `T${index}`, status: 'todo', note: '', createdAt: 'x', updatedAt: 'x' };
  })));
  assert.equal(Object.keys(store.snapshot().tasks).length, 12);
  await store.close();
  const onDisk = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(Object.keys(onDisk.tasks).length, 12);
});

test('backs up a corrupt document and starts from the default shape', async () => {
  const file = await tempFile();
  const seeded = await new PilotStore(file).open();
  await seeded.close();
  await writeFile(file, '{ this is not json', 'utf8');

  const store = await new PilotStore(file).open();
  assert.ok(store.recoveredFrom, 'expected a corrupt backup path');
  assert.deepEqual(store.snapshot(), { ...defaultDocument(), updatedAt: store.snapshot().updatedAt });
  const files = await readdir(join(file, '..', '..', '..', 'storages', 'dsh-pilot'));
  assert.ok(files.some(name => name.includes('.corrupt-')), `expected a .corrupt-* backup, saw ${files.join(',')}`);
  const healthy = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(healthy.version, DOCUMENT_VERSION);
  await store.close();
});

test('normalizes unknown task fields instead of trusting the file', async () => {
  const file = await tempFile();
  const seeded = await new PilotStore(file).open();
  await seeded.close();
  await writeFile(file, JSON.stringify({ version: 99, settings: [], tasks: { a: { title: 42, status: 'weird', extra: 'x' }, b: null } }), 'utf8');

  const store = await new PilotStore(file).open();
  const snapshot = store.snapshot();
  assert.deepEqual(snapshot.settings, {});
  assert.deepEqual(Object.keys(snapshot.tasks), ['a']);
  assert.equal(snapshot.tasks.a.title, '');
  assert.equal(snapshot.tasks.a.status, 'todo');
  assert.equal('extra' in snapshot.tasks.a, false);
  await store.close();
});
