import assert from 'node:assert/strict';
import { isolatedStack } from './assert-local-stack.mjs';

// Only synthetic, loopback requests to the explicitly identified local stack.
isolatedStack();
const base = 'http://127.0.0.1:18744';
for (const path of ['/', '/register', '/search']) {
  const nonces = new Set();
  for (let iteration = 0; iteration < 3; iteration++) {
    const response = await fetch(base + path, { redirect: 'manual' });
    assert.equal(response.status, 200, `${path}: unexpected response`);
    assert.match(response.headers.get('cache-control') || '', /\bno-store\b/i, `${path}: missing no-store`);
    const nonce = (response.headers.get('content-security-policy') || '').match(/'nonce-([^']+)'/)?.[1];
    assert.ok(nonce, `${path}: missing CSP nonce`);
    assert.ok(!nonces.has(nonce), `${path}: repeated CSP nonce`);
    nonces.add(nonce);
    const html = await response.text();
    const inlineScripts = [...html.matchAll(/<script\b[^>]*>/gi)].map(match => match[0])
      .filter(tag => !/\bsrc\s*=/.test(tag) && !/\btype\s*=\s*["']application\/ld\+json["']/i.test(tag));
    assert.ok(inlineScripts.length > 0, `${path}: expected executable inline scripts`);
    assert.ok(inlineScripts.every(tag => tag.includes(`nonce="${nonce}"`)), `${path}: CSP/script nonce mismatch`);
  }
  console.log(`${path}: three fresh nonces, matching executable scripts, no-store`);
}
