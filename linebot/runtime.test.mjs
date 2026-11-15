import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('real Express starts and preserves webhook signature boundaries without external access', { timeout: 20000 }, async () => {
  const secret = 'synthetic-line-signature-fixture';
  const child = spawn(process.execPath, ['--import', './test-fixtures/no-outbound.mjs', 'index.js'], {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    env: { PATH: process.env.PATH, PORT: '0', LINE_CHANNEL_SECRET: secret },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let outboundAttempts = 0;
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  child.on('message', message => { if (message.kind === 'outbound-attempt') outboundAttempts++; });
  try {
    const address = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Local fixture startup timed out')), 8000);
      child.once('error', reject);
      child.once('exit', code => { clearTimeout(timer); reject(new Error('Fixture exited: '+code)); });
      child.on('message', message => {
        if (message.kind === 'listening') { clearTimeout(timer); resolve(message.address); }
      });
    });
    assert.equal(address.address, '127.0.0.1');
    const base = `http://127.0.0.1:${address.port}`;
    const health = await fetch(base+'/');
    assert.equal(health.status, 200);
    assert.equal(await health.text(), 'CareLink LINE BOT is running');
    const raw = JSON.stringify({ events: [] });
    const signature = body => createHmac('sha256', secret).update(body).digest('base64');
    const post = (body, signed) => fetch(base+'/webhook', { method: 'POST', headers: {
      'content-type': 'application/json', ...(signed === undefined ? {} : { 'x-line-signature': signed }),
    }, body });
    assert.equal((await post(raw)).status, 401);
    assert.equal((await post(raw, 'bad')).status, 401);
    assert.equal((await post(raw, 'A'.repeat(44))).status, 401);
    assert.equal((await post(raw+' ', signature(raw))).status, 401);
    assert.equal((await post('{', signature('{'))).status, 400);
    const accepted = await post(raw, signature(raw));
    assert.equal(accepted.status, 200);
    assert.equal(await accepted.text(), 'OK');
    const ignored = JSON.stringify({ events: [{ type: 'message', message: { type: 'image' }, source: { userId: 'synthetic' } }] });
    assert.equal((await post(ignored, signature(ignored))).status, 200);
    assert.equal((await fetch(base+'/not-a-route')).status, 404);
    assert.equal(outboundAttempts, 0);
    assert.match(output, /Claude configured: false/);
    assert.match(output, /Supabase configured: false/);
    assert.match(output, /Slack configured: false/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
    }
  }
});
