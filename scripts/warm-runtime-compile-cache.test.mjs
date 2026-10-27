import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { warmRuntimeCompileCache } from './warm-runtime-compile-cache.mjs';

async function availablePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

async function fixture(body, run) {
  const cwd = await mkdtemp(join(tmpdir(), 'carelink-compile-cache-test-'));
  try {
    await writeFile(join(cwd, 'server.js'), `
      const fs = require('node:fs');
      fs.writeFileSync('child.pid', String(process.pid));
      ${body}
    `);
    await run(cwd, await availablePort());
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function assertStopped(cwd) {
  const pid = Number(await readFile(join(cwd, 'child.pid'), 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}

const httpServer = (status) => `
  const server = require('node:http').createServer((req, res) => {
    fs.appendFileSync('requests.jsonl', JSON.stringify({ method: req.method, path: req.url }) + '\\n');
    res.writeHead(req.method === 'GET' && req.url === '/privacy' ? ${status} : 404);
    res.end('public page');
  });
  server.listen(Number(process.env.PORT), process.env.HOSTNAME);
  process.on('SIGTERM', () => {
    server.close();
    server.closeAllConnections();
  });
`;

test('prepares bytecode with a read-only local page and shuts down the server', async () => {
  await fixture(httpServer(200), async (cwd, port) => {
    await warmRuntimeCompileCache({ cwd, port });
    await assertStopped(cwd);
    const requests = (await readFile(join(cwd, 'requests.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(requests.length > 0);
    assert.ok(requests.every(({ method, path }) => method === 'GET' && path === '/privacy'));
    const cache = await readdir(join(cwd, '.node-compile-cache'), { recursive: true });
    assert.ok(cache.length > 1, 'graceful shutdown must flush actual bytecode entries');
    assert.ok(!(await readdir(join(cwd, '.node-compile-cache'))).some(name => name.startsWith('.compile-cache-warmup-')));
  });
});

test('preloads only in the build launcher and preserves the deployed lazy configuration', async () => {
  await fixture(`
    const config = {"preloadEntriesOnStart":false};
    fs.writeFileSync('preload.json', JSON.stringify(config));
    fs.writeFileSync(require('node:path').join(__dirname, 'warmup-path.txt'), process.cwd());
    ${httpServer(200)}
  `, async (cwd, port) => {
    const original = await readFile(join(cwd, 'server.js'), 'utf8');
    await warmRuntimeCompileCache({ cwd, port });
    assert.deepEqual(JSON.parse(await readFile(join(cwd, 'preload.json'), 'utf8')), { preloadEntriesOnStart: true });
    assert.equal(await readFile(join(cwd, 'server.js'), 'utf8'), original);
    assert.equal(await readFile(join(cwd, 'warmup-path.txt'), 'utf8'), await realpath(cwd));
    assert.ok(!(await readdir(join(cwd, '.node-compile-cache'))).some(name => name.startsWith('.compile-cache-warmup-')));
  });
});

test('fails the build on an error response and still stops the child', async () => {
  await fixture(httpServer(500), async (cwd, port) => {
    await assert.rejects(warmRuntimeCompileCache({ cwd, port }), /did not return HTTP 200/);
    await assertStopped(cwd);
  });
});

test('retries a timed-out response body before declaring the image ready', async () => {
  await fixture(`
    let requests = 0;
    const server = require('node:http').createServer((req, res) => {
      requests++;
      fs.writeFileSync('request-count.txt', String(requests));
      res.writeHead(200); res.flushHeaders();
      if (requests > 1) res.end('public page');
    });
    server.listen(Number(process.env.PORT), process.env.HOSTNAME);
    process.on('SIGTERM', () => { server.close(); server.closeAllConnections(); });
  `, async (cwd, port) => {
    await warmRuntimeCompileCache({ cwd, port, timeoutMs: 5000 });
    assert.ok(Number(await readFile(join(cwd, 'request-count.txt'), 'utf8')) >= 2);
    await assertStopped(cwd);
    assert.ok(!(await readdir(join(cwd, '.node-compile-cache'))).some(name => name.startsWith('.compile-cache-warmup-')));
  });
});

test('a permanently stalled body still fails within the readiness budget', async () => {
  await fixture(`
    const server = require('node:http').createServer((req, res) => {
      res.writeHead(200); res.flushHeaders();
    });
    server.listen(Number(process.env.PORT), process.env.HOSTNAME);
    process.on('SIGTERM', () => { server.close(); server.closeAllConnections(); });
  `, async (cwd, port) => {
    await assert.rejects(warmRuntimeCompileCache({ cwd, port, timeoutMs: 1200 }), /readiness deadline/);
    await assertStopped(cwd);
    assert.ok(!(await readdir(join(cwd, '.node-compile-cache'))).some(name => name.startsWith('.compile-cache-warmup-')));
  });
});

test('detects startup failure without waiting for the full timeout', async () => {
  await fixture('process.exit(7);', async (cwd, port) => {
    await assert.rejects(warmRuntimeCompileCache({ cwd, port }), /exited before readiness/);
    await assertStopped(cwd);
  });
});

test('bounds readiness and force-stops a child that ignores graceful shutdown', async () => {
  await fixture("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);", async (cwd, port) => {
    await assert.rejects(warmRuntimeCompileCache({ cwd, port, timeoutMs: 1000, shutdownMs: 100 }), /readiness deadline/);
    await assertStopped(cwd);
  });
});
