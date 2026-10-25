import { test, expect } from '@playwright/test';

test('collection crawls stop before SSR while policy and ordinary search-indexing reads stay available', async ({ request }) => {
  for (const agent of ['GoogleOther', 'Amazonbot/0.1', 'Reflectionbot/1.0']) {
    const response = await request.get('/search?type=hair-salon', { headers: { 'user-agent': agent } });
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({ error: 'Collection crawling is disabled.' });
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(response.headers()['content-security-policy']).toContain("default-src 'none'");
  }
  const robots = await request.get('/robots.txt', { headers: { 'user-agent': 'GoogleOther' } });
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain('User-Agent: GoogleOther');
  for (const agent of ['Googlebot/2.1', 'bingbot/2.0', 'Mozilla/5.0']) {
    expect((await request.get('/privacy', { headers: { 'user-agent': agent } })).status()).toBe(200);
  }
});
