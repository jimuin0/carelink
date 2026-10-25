'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { requestGroup, attachCpuSampler } = require('./runtime-cpu-sampler.cjs');

function fixture(every = 16) {
  const server = new EventEmitter();
  const records = [];
  let cpu = 0;
  let time = 0;
  attachCpuSampler(server, {
    every,
    cpuUsage: () => ({ user: (cpu += 1000), system: cpu / 2 }),
    uptime: () => 2,
    now: () => (time += 10),
    emit: (record) => records.push(record),
  });
  function start(url = '/search', method = 'GET') {
    const response = new EventEmitter();
    const request = { method, url };
    Object.defineProperty(request, 'headers', {
      get() { throw new Error('Headers must never be inspected'); },
    });
    server.emit('request', request, response);
    return response;
  }
  return { start, records };
}

test('only fixed route groups leave the sampler', () => {
  assert.deepEqual([
    requestGroup('GET', '/search?keyword=private'),
    requestGroup('HEAD', '/api/health'),
    requestGroup('GET', '/api/cron/private-job'),
    requestGroup('GET', '/api/users/private-id'),
    requestGroup('GET', '/_next/private-file'),
    requestGroup('GET', '/?private=value'),
    requestGroup('GET', '/facility/private-id'),
    requestGroup('GET', '/auth/private-id'),
    requestGroup('GET', undefined),
    requestGroup('POST', '/search'),
  ], ['search', 'health', 'cron', 'api', 'asset', 'home', 'facility', 'other', 'other', 'write']);
});

test('first request and every sixteenth request are sampled without reading secrets', () => {
  const f = fixture();
  for (let i = 0; i < 32; i += 1) {
    const r = f.start('/search?keyword=synthetic-secret');
    r.emit('finish');
    r.emit('close');
  }
  assert.equal(f.records.length, 3);
  assert.deepEqual(f.records.map((r) => r.requests_started), [1, 16, 32]);
  assert.deepEqual(f.records[0], {
    group: 'search', ended: 'finish', overlap: false, requests_started: 1,
    process_uptime_ms: 2000, wall_ms: 10, cpu_user_ms: 1,
    cpu_system_ms: 0.5, process_cpu_before_ms: 1.5, process_cpu_after_ms: 3,
  });
  assert.ok(!JSON.stringify(f.records).includes('synthetic-secret'));
});

test('overlapping requests are explicitly marked and never attributed as isolated CPU', () => {
  const f = fixture(1);
  const first = f.start();
  const concurrent = f.start('/api/health');
  first.emit('finish');
  concurrent.emit('finish');
  const later = f.start();
  later.emit('finish');
  assert.equal(f.records.length, 2);
  assert.deepEqual(f.records.map((r) => r.overlap), [true, false]);
  assert.deepEqual(f.records.map((r) => r.requests_started), [2, 3]);
});

test('aborted responses release accounting once and retain a distinct outcome', () => {
  const f = fixture(1);
  const aborted = f.start();
  aborted.emit('close');
  aborted.emit('finish');
  f.start().emit('finish');
  assert.deepEqual(f.records.map((r) => r.ended), ['close', 'finish']);
  assert.ok(f.records.every((r) => !r.overlap));
});

test('assets and writes contribute to overlap but do not create diagnostic records', () => {
  const f = fixture(1);
  f.start('/_next/static/test.js').emit('finish');
  f.start('/api/bookings', 'POST').emit('finish');
  const read = f.start();
  const write = f.start('/api/bookings', 'POST');
  write.emit('finish');
  read.emit('finish');
  assert.equal(f.records.length, 1);
  assert.equal(f.records[0].overlap, true);
  assert.equal(f.records[0].requests_started, 4);
});

test('preload preserves real HTTP responses and emits only the diagnostic schema', () => {
  const child = spawnSync(process.execPath, [
    '--require', path.join(__dirname, 'runtime-cpu-preload.cjs'), '-e', `
      const http = require('node:http');
      const assert = require('node:assert/strict');
      const server = http.createServer((req, res) => {
        res.setHeader('X-Sampler-Test', 'unchanged');
        res.end('expected-body');
      });
      server.listen(0, '127.0.0.1', async () => {
        try {
          for (let i = 0; i < 32; i++) {
            const response = await fetch('http://127.0.0.1:' + server.address().port +
              '/search?keyword=synthetic-private-query', {
                headers: { Cookie: 'synthetic-private-cookie', Authorization: 'synthetic-private-auth' },
              });
            assert.equal(response.status, 200);
            assert.equal(response.headers.get('x-sampler-test'), 'unchanged');
            assert.equal(await response.text(), 'expected-body');
          }
        } catch (error) { process.exitCode = 1; }
        finally { server.close(); }
      });
    `,
  ], { encoding: 'utf8', timeout: 30000 });
  assert.equal(child.status, 0, child.stderr);
  assert.ok(!/synthetic-private/.test(child.stdout));
  const lines = child.stdout.trim().split('\n');
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.ok(line.startsWith('[runtime-cpu-sample] '));
    const record = JSON.parse(line.slice('[runtime-cpu-sample] '.length));
    assert.deepEqual(Object.keys(record).sort(), [
      'group', 'ended', 'overlap', 'requests_started', 'process_uptime_ms',
      'wall_ms', 'cpu_user_ms', 'cpu_system_ms', 'process_cpu_before_ms', 'process_cpu_after_ms',
    ].sort());
    assert.equal(record.group, 'search');
    assert.equal(record.ended, 'finish');
    assert.ok(record.cpu_user_ms >= 0 && record.cpu_system_ms >= 0);
  }
});
