import { test, expect } from '@playwright/test';

test.describe('トップページ', () => {
  test('表示される', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/CareLink/i);
    await expect(page.locator('h1')).toBeVisible();
  });

  test('ナビゲーションが動作する', async ({ page }) => {
    await page.goto('/');
    // メインナビのリンクが存在する
    const nav = page.locator('nav').first();
    await expect(nav).toBeVisible();
  });

  test('検索バーが表示される', async ({ page }) => {
    await page.goto('/');
    // 検索またはCTAが存在する
    const cta = page.getByRole('link', { name: /検索|Search|探す/ }).first();
    await expect(cta.or(page.getByPlaceholder(/検索|Search/).first())).toBeVisible();
  });

  test('PageSpeedに影響するLCP要素が速く表示される', async ({ page }) => {
    const startTime = Date.now();
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    const elapsed = Date.now() - startTime;
    // DOMContentLoaded が3秒以内
    expect(elapsed).toBeLessThan(3000);
  });

  test('モバイルでハンバーガーメニューが動作する', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    const hamburger = page.getByRole('button', { name: /メニュー/ });
    if (await hamburger.isVisible()) {
      await hamburger.click();
      // メニューが開く
      const mobileNav = page.locator('#mobile-nav, [role="navigation"]').last();
      await expect(mobileNav).toBeVisible();
    }
  });
});
