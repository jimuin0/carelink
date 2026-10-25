import { test, expect } from '@playwright/test';

// The wide viewport exposes many directory links at once. A page must not
// render their destinations speculatively just because the list is visible.
test.use({ viewport: { width: 1280, height: 800 } });

for (const path of ['/search', '/tokyo', '/osaka/hair-salon', '/osaka/toyonaka/nail-eyelash', '/search/area', '/search/area/toyonaka']) {
  test(`browse page ${path} keeps speculative page requests bounded`, async ({ page, baseURL }) => {
    expect(baseURL).toBeTruthy();
    const target = new URL(path, baseURL);
    const pagePrefetches: string[] = [];
    let requests = 0;
    page.on('request', (request) => {
      requests += 1;
      const url = new URL(request.url());
      if (url.origin !== target.origin || url.pathname.startsWith('/_next/static/')) return;
      if (request.headers()['rsc'] || url.searchParams.has('_rsc')) pagePrefetches.push(url.pathname);
    });
    const response = await page.goto(path, { waitUntil: 'load' });
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(target.toString());
    await expect(page.getByRole('main')).toBeVisible();
    expect(await page.locator('a[href]').count()).toBeGreaterThan(25);

    // A real React interaction proves this is not "zero prefetches because
    // hydration failed". Header browse links themselves also stay bounded.
    const menu = page.getByRole('button', { name: '業種から探す', exact: true });
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await page.waitForTimeout(3000); // Observe Next's scheduled viewport work.
    expect(requests).toBeGreaterThan(10);
    expect(pagePrefetches.length, `unexpected page work: ${pagePrefetches.slice(0, 8).join(', ')}`)
      .toBeLessThanOrEqual(8);
  });
}
