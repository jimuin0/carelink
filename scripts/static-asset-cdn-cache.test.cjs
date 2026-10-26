'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { attachStaticAssetCdnCache } = require('./static-asset-cdn-cache.cjs');

async function responseFor({ path = '/_next/static/chunks/abc123.js', method = 'GET',
  status = 200, type = 'application/javascript; charset=utf-8',
  policy = 'public, max-age=31536000, immutable', extra = {}, direct, message = false } = {}) {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', policy);
    for (const [key, value] of Object.entries(extra)) res.setHeader(key, value);
    if (message) res.writeHead(status, 'Synthetic', direct);
    else res.writeHead(status, direct);
    res.end('synthetic');
  });
  attachStaticAssetCdnCache(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method }, (res) => {
        res.resume(); res.once('end', () => resolve({ status: res.statusCode, headers: res.headers }));
      });
      req.once('error', reject); req.end();
    });
  } finally { server.close(); await once(server, 'close'); }
}

test('successful immutable JS, CSS and fonts opt into the CDN, preserving browser policy', async () => {
  for (const args of [{}, { method: 'HEAD' }, { type: 'text/javascript' },
    { type: 'text/css', path: '/_next/static/css/abc123.css?v=1' },
    { type: 'font/woff2', path: '/_next/static/media/abc123.woff2' },
    { message: true },
    { direct: { 'Content-Type': 'text/css', 'Cache-Control': 'public, max-age=31536000, immutable' } },
    { direct: ['Content-Type', 'text/css', 'Cache-Control', 'public, max-age=31536000, immutable'] }]) {
    const result = await responseFor(args);
    assert.equal(result.headers['vercel-cdn-cache-control'], 'public, s-maxage=31536000, immutable');
    assert.equal(result.status, 200);
    assert.ok(result.headers['cache-control'].includes('immutable'));
    assert.equal(result.headers['set-cookie'], undefined);
  }
});

test('HTML, missing files, private data, non-reads and uploaded images never gain CDN caching', async () => {
  for (const args of [{ status: 404 }, { status: 500 }, { status: 206 },
    { type: 'text/html' }, { type: 'application/json' }, { method: 'POST' },
    { path: '/' }, { path: '/auth/login' }, { path: '/api/health' },
    { path: '/_next/image?url=synthetic' }, { path: '/images/uploaded.js' },
    { policy: 'private, immutable' }, { policy: 'public, immutable, no-store' },
    { policy: 'public, immutable, no-cache' }, { policy: 'public, max-age=0' },
    { policy: 'public, max-age=31536000, immutable, private="Set-Cookie"' },
    { policy: 'public, max-age=31536000, immutable, no-cache="Authorization"' },
    { policy: 'public, max-age=60, immutable' },
    { extra: { 'Set-Cookie': 'synthetic=value' } },
    { extra: { 'Content-Security-Policy': "script-src 'nonce-synthetic'" } },
    { extra: { Vary: 'Accept-Encoding, Cookie' } }, { extra: { Vary: '*' } },
    { direct: { 'Cache-Control': 'private, no-store' } },
    { direct: ['Content-Type', 'text/html'] },
    { direct: { 'Cache-Control': 'public, immutable', 'cache-control': 'private' } },
    { direct: ['Cache-Control', 'public, immutable', 'cache-control', 'private'] },
    { direct: { 'Set-Cookie': 'synthetic=value' }, message: true }]) {
    assert.equal((await responseFor(args)).headers['vercel-cdn-cache-control'], undefined, JSON.stringify(args));
  }
});

test('explicit CDN policy has precedence and is never replaced', async () => {
  for (const args of [{ extra: { 'Vercel-CDN-Cache-Control': 'private, no-store' } },
    { direct: { 'Vercel-CDN-Cache-Control': 'private, no-store' } },
    { direct: ['Vercel-CDN-Cache-Control', 'private, no-store'] }]) {
    assert.equal((await responseFor(args)).headers['vercel-cdn-cache-control'], 'private, no-store');
  }
});
