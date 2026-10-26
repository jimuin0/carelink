import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStagingHandler } from './staging-handler.mjs';

test('hosted and malformed backends are refused before application execution', async () => {
  const handler = createStagingHandler({ fetch() { throw new Error('must not execute'); } });
  for (const url of ['https://production.invalid', 'not a URL', 'http://127.0.0.1:9999']) {
    assert.equal((await handler.fetch(new Request('https://staging.invalid/'), { NEXT_PUBLIC_SUPABASE_URL: url })).status, 503);
  }
});

test('synthetic staging blocks all writes before application execution', async () => {
  const handler = createStagingHandler({ fetch() { throw new Error('must not execute'); } });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal((await handler.fetch(new Request('https://staging.invalid/api/booking', { method }), {})).status, 503);
  }
});

test('robots cannot advertise staging routes', async () => {
  const handler = createStagingHandler({ fetch() { throw new Error('must not execute'); } });
  const response = await handler.fetch(new Request('https://staging.invalid/robots.txt'), {});
  assert.equal(await response.text(), 'User-agent: *\nDisallow: /\n');
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex');
});

test('responses preserve redirects, status and cookies while refusing indexing', async () => {
  const handler = createStagingHandler({ fetch(request, env, ctx) {
    assert.equal(ctx.marker, 'context');
    assert.equal(request.method, 'HEAD');
    return new Response(null, { status: 307, headers: { Location: '/auth/login', 'Set-Cookie': 'synthetic=value; Secure; HttpOnly' } });
  } });
  const response = await handler.fetch(new Request('https://staging.invalid/admin', { method: 'HEAD' }), {}, { marker: 'context' });
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('Location'), '/auth/login');
  assert.equal(response.headers.get('Set-Cookie'), 'synthetic=value; Secure; HttpOnly');
  assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
});

test('disposable local database permits real write verification', async () => {
  let called = false;
  const handler = createStagingHandler({ async fetch() { called = true; return new Response('synthetic result', { status: 201 }); } });
  const response = await handler.fetch(new Request('https://localhost:3000/api/booking', { method: 'POST' }),
    { NEXT_PUBLIC_SUPABASE_URL: 'https://localhost:54330' });
  assert.equal(response.status, 201);
  assert.equal(await response.text(), 'synthetic result');
  assert.equal(called, true);
});
