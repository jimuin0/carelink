import { test, expect } from '@playwright/test';

test('fixed public assets opt into the CDN without retaining browser copies or cookies', async ({ request }) => {
  for (const path of ['/favicon.svg', '/manifest.json', '/images/hero-tiny.webp', '/icons/icon-192.png']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const headers = response.headers();
    // Vercel consumes this header at its edge; the standalone acceptance server
    // exposes it so the policy can be checked before deployment.
    expect(headers['vercel-cdn-cache-control'], path).toBe('public, s-maxage=3600');
    if (process.env.CARELINK_CI_WORKER === '1') {
      // Cloudflare's local assets binding adds must-revalidate. It remains
      // immediately stale in the browser; this does not assert edge caching.
      expect(headers['cache-control'].split(',').map(value => value.trim()).sort(), path)
        .toEqual(['max-age=0', 'must-revalidate', 'public']);
    } else {
      expect(headers['cache-control'], path).toBe('public, max-age=0');
    }
    expect(headers['set-cookie'], path).toBeUndefined();
    expect(headers['x-content-type-options'], path).toBe('nosniff');
  }
});

test('HTML, account pages, APIs and service workers never inherit the asset CDN policy', async ({ request }) => {
  for (const path of ['/privacy', '/auth/login', '/api/health', '/sw.js', '/sw-register.js', '/offline.html']) {
    const response = await request.get(path);
    const headers = response.headers();
    expect(headers['vercel-cdn-cache-control'], path).toBeUndefined();
    if (path === '/privacy' || path === '/auth/login') {
      expect(headers['cache-control'], path).toContain('no-store');
      expect(headers['content-security-policy'], path).toContain("'strict-dynamic'");
      expect(headers['content-security-policy'], path).toMatch(/'nonce-[^']+'/);
    }
  }
});
