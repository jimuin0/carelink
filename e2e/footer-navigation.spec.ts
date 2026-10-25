import { test, expect } from '@playwright/test';

test('SEO footer anchors remain crawlable and navigate without a document reload', async ({ page }) => {
  await page.goto('/search', { waitUntil: 'load' });
  const footer = page.getByRole('contentinfo');
  // Closed details retain their real anchor URLs in the initial document.
  expect(await footer.locator('a[href]').count()).toBeGreaterThan(1400);
  await expect(footer.locator('a[href="/tokyo/hair-salon"]')).toHaveCount(1);
  await expect(footer.locator('a[href="/osaka/acupuncture"]')).toHaveCount(1);

  // Choose essential cookies through the real UI before using links behind
  // the consent banner. Do not force clicks through this mobile overlay.
  const essentialOnly = page.getByRole('button', { name: '必須のみ', exact: true });
  await essentialOnly.click();
  await expect(essentialOnly).not.toBeVisible();

  await page.evaluate(() => document.documentElement.setAttribute('data-footer-navigation-marker', 'kept'));
  await footer.locator('details').first().locator('summary').click();
  await footer.locator('details').first().locator('a[href="/tokyo"]').click();
  await expect(page).toHaveURL(/\/tokyo$/);
  await expect(page.locator('html')).toHaveAttribute('data-footer-navigation-marker', 'kept');

  await footer.getByRole('link', { name: 'プライバシーポリシー', exact: true }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.locator('html')).toHaveAttribute('data-footer-navigation-marker', 'kept');

  // /privacy uses the other footer; both share one delegated router handler.
  await page.getByRole('contentinfo').locator('a[href="/osaka"]').click();
  await expect(page).toHaveURL(/\/osaka$/);
  await expect(page.locator('html')).toHaveAttribute('data-footer-navigation-marker', 'kept');
});
