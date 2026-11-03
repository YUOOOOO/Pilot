import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { DshHost, launchUrl, redact } from '../apps/desktop/src/host.mjs';
const lifecycle = fileURLToPath(new URL('../apps/desktop/src/lifecycle.mjs', import.meta.url));
test('only accepts loopback launch URLs and retains authentication', () => {
  assert.equal(launchUrl('dsh web: http://127.0.0.1:1234/?token=abc'), 'http://127.0.0.1:1234/?token=abc');
  assert.equal(launchUrl('dsh web: http://evil.example:1234/'), null);
  assert.equal(launchUrl('dsh web: http://user:pass@127.0.0.1:1234/'), null);
  assert.equal(redact('http://127.0.0.1:1234/?token=private'), 'http://127.0.0.1:1234/?token=[redacted]');
});
async function fixture(source, run) {
  const dir = await mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'pilot-host-'));
  const entry = path.join(dir, 'fixture.mjs');
  await writeFile(entry, source);
  const logs = [];
  // 3s budget: the assertions are about readiness detection, not spawn speed — a cold node
  // spawn on Windows can already take ~1s, which made the old 1s budget flaky under load.
  const host = new DshHost({ node: process.execPath, entry, lifecycle, home: dir, patch: path.join(dir, 'patch.yml'), cwd: dir, timeout: 3000, log: line => logs.push(line) });
  try { await run(host, logs); } finally { await host.stop(); await rm(dir, { recursive: true, force: true }); }
}
test('handles split stdout, readiness, redaction and graceful shutdown', async () => {
  await fixture(`import http from 'node:http';
const server=http.createServer((req,res)=>res.end('ok'));
process.on('SIGTERM',()=>{server.close(()=>process.exit(0));});
server.listen(0,'127.0.0.1',()=>{process.stdout.write('dsh we');setTimeout(()=>console.log('b: http://127.0.0.1:'+server.address().port+'/?token=private'),20);});`, async (host, logs) => {
    const url = await host.start();
    assert.equal(new URL(url).searchParams.get('token'), 'private');
    const pid = host.child.pid;
    let outcome;
    host.once('exit', event => { outcome = event; });
    await host.stop();
    assert.equal(outcome.code, 0);
    assert.equal(outcome.expected, true);
    assert.throws(() => process.kill(pid, 0));
    assert.ok(logs.every(line => !line.includes('token=private')));
  });
});
test('rejects early process exits', async () => {
  await fixture('process.exit(7)', async host => { await assert.rejects(host.start(), /7/); });
});
test('times out and stops a process that never reports readiness', async () => {
  await fixture("process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)", async host => {
    await assert.rejects(host.start(), /超时/);
    await host.stop();
    assert.equal(host.child, undefined);
  });
});
test('missing Node executable rejects cleanly without retaining a child', async () => {
  await fixture('', async host => {
    host.node = path.join(host.home, 'missing-node.exe');
    await assert.rejects(host.start(), /ENOENT/);
    assert.equal(host.child, undefined);
  });
});
