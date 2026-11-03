import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get } from 'node:https';
import { spawnSync } from 'node:child_process';
import { createWorkerLocalCertificate } from './ci-local-ca.mjs';

test('disposable CA signs a localhost certificate trusted by the client', async () => {
  const { key, cert, ca } = createWorkerLocalCertificate();
  const server = createServer({ key, cert }, (_, response) => response.end('ok'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const body = await new Promise((resolve, reject) => {
      get({ hostname: '127.0.0.1', port: server.address().port, ca }, response => {
        let data = ''; response.on('data', chunk => { data += chunk; }); response.on('end', () => resolve(data));
      }).on('error', reject);
    });
    assert.equal(body, 'ok');
    await assert.rejects(new Promise((resolve, reject) => {
      get({ hostname: '127.0.0.1', port: server.address().port }, response => {
        response.resume(); response.on('end', resolve);
      }).on('error', reject);
    }), error => ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN'].includes(error.code));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('Worker server refuses to start outside the protected CI environment', () => {
  const env = { PATH: process.env.PATH };
  const child = spawnSync(process.execPath, ['tools/cloudflare/start-ci-worker-https.mjs'], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /environment refused/);
});

test('local workerd verifies the disposable CA for the loopback dependency', { timeout: 30000 }, async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createServer: createTcpServer } = await import('node:net');
  const { spawn } = await import('node:child_process');
  const directory = mkdtempSync(join(tmpdir(), 'carelink-worker-ca-test-'));
  const tls = createWorkerLocalCertificate();
  const dependency = createServer(tls, (_, response) => response.end('synthetic-ok'));
  let child;
  try {
    await new Promise(resolve => dependency.listen(0, 'localhost', resolve));
    const probe = createTcpServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const workerPort = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    const caPath = join(directory, 'ca.pem');
    writeFileSync(caPath, tls.ca, { mode: 0o600 });
    writeFileSync(join(directory, 'worker.mjs'), `export default {async fetch(){try{const response=await fetch('https://localhost:${dependency.address().port}/');return new Response(await response.text(),{status:response.status})}catch{return new Response('failed',{status:502})}}}`);
    writeFileSync(join(directory, 'wrangler.json'), JSON.stringify({ name: 'carelink-local-ca-test', main: 'worker.mjs', compatibility_date: '2026-10-26', workers_dev: false }));
    child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--ip', '127.0.0.1', '--port', String(workerPort), '--config', join(directory, 'wrangler.json'), '--log-level', 'error'], { env: { ...process.env, NODE_EXTRA_CA_CERTS: caPath }, stdio: 'ignore' });
    let response;
    for (let attempt = 0; attempt < 80 && !response; attempt++) {
      if (child.exitCode !== null) throw new Error('local workerd exited before ready');
      try { response = await fetch(`http://127.0.0.1:${workerPort}/`); }
      catch { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    assert.ok(response, 'local workerd did not become ready');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'synthetic-ok');
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
    }
    await new Promise(resolve => dependency.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
