import { test, expect } from '@playwright/test';

// The shared footer grows with business types (including medical specialties).
// Opening/scanning it must not execute hundreds of dynamic pages on the server.
test('expanding the shared footer does not prefetch its area and specialty pages', async ({ page }) => {
  const prefetches: string[] = [];
  page.on('request', (request) => {
    const headers = request.headers();
    if (headers['next-router-prefetch'] || headers['next-router-segment-prefetch']) {
      prefetches.push(new URL(request.url()).pathname);
    }
  });

  await page.goto('/terms');
  const footer = page.getByRole('contentinfo');
  await footer.getByRole('button', { name: 'すべてのエリアを表示' }).click();
  await expect(footer.getByRole('heading', { name: '業種×エリアから探す' })).toBeVisible();
  expect(await footer.locator('a[href]').count()).toBeGreaterThan(1000);

  // Exercise links that enter the viewport after expansion, not just the
  // collapsed six-prefecture list. Measure before any intentional navigation.
  for (let step = 0; step < 4; step++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1500);
  await test.info().attach('navigation-budget', {
    body: JSON.stringify({ footerLinks: await footer.locator('a[href]').count(), prefetches }),
    contentType: 'application/json',
  });
  expect(prefetches, `Unrequested page renders: ${prefetches.slice(0, 12).join(', ')}`).toHaveLength(0);

  // Disabling speculation must preserve normal navigation.
  await footer.getByRole('link', { name: 'お問い合わせ', exact: true }).click();
  await expect(page).toHaveURL(/\/contact$/);
});

test('image negotiation uses WebP even when the browser prefers AVIF', async ({ request }) => {
  const response = await request.get('/_next/image?url=%2Fimages%2Fbanner-eyelash.webp&w=640&q=75', {
    headers: { Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('image/webp');
  const bytes = await response.body();
  expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
  expect(bytes.subarray(8, 12).toString()).toBe('WEBP');
});
