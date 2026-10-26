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

test('localhost CI exercises the actual crawler policy without making it indexable', async () => {
  const handler = createStagingHandler({ fetch() { return new Response('User-Agent: GoogleOther\nDisallow: /'); } });
  const response = await handler.fetch(new Request('https://localhost:3000/robots.txt'),
    { NEXT_PUBLIC_SUPABASE_URL: 'https://localhost:54330' });
  assert.match(await response.text(), /User-Agent: GoogleOther/);
  assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
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

test('finite JSON mutations preserve bytes and advertise completion to the HTTP bridge', async () => {
  const json = JSON.stringify({ menu: { name: '合成メニュー' } });
  const handler = createStagingHandler({ fetch() { return new Response(json,
    { status: 201, headers: { 'Content-Type': 'application/json; charset=utf-8' } }); } });
  const response = await handler.fetch(new Request('https://localhost:3000/api/admin/menus', { method: 'POST' }),
    { NEXT_PUBLIC_SUPABASE_URL: 'https://localhost:54330' });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Content-Length'), String(new TextEncoder().encode(json).byteLength));
  assert.equal(await response.text(), json);
});

test('empty mutation responses retain their no-body status', async () => {
  const handler = createStagingHandler({ fetch() { return new Response(null,
    { status: 204, headers: { 'Content-Type': 'application/json' } }); } });
  const response = await handler.fetch(new Request('https://localhost:3000/api/admin/test', { method: 'DELETE' }),
    { NEXT_PUBLIC_SUPABASE_URL: 'https://localhost:54330' });
  assert.equal(response.status, 204);
  assert.equal(response.body, null);
  assert.equal(response.headers.get('Content-Length'), null);
});

test('image negotiation respects WebP-only configuration without changing unrelated headers', async () => {
  const handler = createStagingHandler({ fetch(request) {
    assert.equal(request.headers.get('X-Synthetic'), 'preserved');
    assert.doesNotMatch(request.headers.get('Accept'), /image\/avif/);
    return new Response('synthetic image');
  } });
  for (const path of ['/_next/image', '/_vinext/image/']) {
    for (const accept of ['image/avif,image/webp,image/*', 'image/webp', undefined]) {
      const headers = { 'X-Synthetic': 'preserved', ...(accept ? { Accept: accept } : {}) };
      await handler.fetch(new Request(`https://staging.invalid${path}?url=test`, { headers }), {});
    }
  }
});

test('fixed public assets retain browser revalidation and translate edge caching', async () => {
  const handler = createStagingHandler({ fetch() {
    return new Response('synthetic asset', { headers: { 'Vercel-CDN-Cache-Control': 'public, s-maxage=3600',
      'Cache-Control': 'public, max-age=0, must-revalidate' } });
  } });
  for (const method of ['GET', 'HEAD']) {
    const response = await handler.fetch(new Request('https://staging.invalid/favicon.svg', { method }), {});
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=0');
    assert.equal(response.headers.get('Cloudflare-CDN-Cache-Control'), 'public, max-age=3600');
  }
});

test('cookies, errors, writes and unmarked responses cannot acquire asset caching', async () => {
  for (const input of [
    { headers: { 'Set-Cookie': 'synthetic=value', 'Vercel-CDN-Cache-Control': 'public, s-maxage=3600' } },
    { status: 404, headers: { 'Vercel-CDN-Cache-Control': 'public, s-maxage=3600' } },
    { method: 'POST', headers: { 'Vercel-CDN-Cache-Control': 'public, s-maxage=3600' } },
    { headers: {} },
  ]) {
    const handler = createStagingHandler({ fetch() { return new Response('synthetic result', {
      status: input.status ?? 200, headers: { ...input.headers, 'Cache-Control': 'no-store' },
    }); } });
    const response = await handler.fetch(new Request('https://localhost:3000/api/test', { method: input.method ?? 'GET' }),
      { NEXT_PUBLIC_SUPABASE_URL: 'https://localhost:54330' });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Cloudflare-CDN-Cache-Control'), null);
  }
});
