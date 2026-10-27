import { test, expect } from '@playwright/test';

function relatedSection(page: import('@playwright/test').Page) {
  return page.locator('section').filter({
    has: page.getByRole('heading', { name: '大阪府の他の業種', exact: true }),
  });
}

test('regional related links preserve client navigation and back history', async ({ page, baseURL }) => {
  await page.goto('/osaka/internal-medicine');
  const link = relatedSection(page).locator('a[href]').first();
  const href = await link.getAttribute('href');
  expect(href).toBeTruthy();
  await page.evaluate(() => { document.documentElement.dataset.relatedNavigationProbe = 'active'; });
  await link.click();
  await expect(page).toHaveURL(new URL(href!, baseURL).toString());
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-related-navigation-probe', 'active');
  await page.goBack();
  await expect(page).toHaveURL(/\/osaka\/internal-medicine$/);
  await expect(page.locator('html')).toHaveAttribute('data-related-navigation-probe', 'active');
});

test('regional related links retain native new-tab behavior', async ({ page, context, baseURL }) => {
  await page.goto('/osaka/internal-medicine');
  const link = relatedSection(page).locator('a[href]').first();
  const href = await link.getAttribute('href');
  expect(href).toBeTruthy();
  await link.evaluate((anchor) => anchor.setAttribute('target', '_blank'));
  const [opened] = await Promise.all([context.waitForEvent('page'), link.click()]);
  try {
    await expect(opened).toHaveURL(new URL(href!, baseURL).toString());
    await expect(opened.getByRole('main')).toBeVisible();
    await expect(page).toHaveURL(/\/osaka\/internal-medicine$/);
  } finally {
    await opened.close();
  }
});
